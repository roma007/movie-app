import type { DatabaseProvider } from '../db/provider';

/**
 * 「越看越懂你」抖音式推荐服务（v5）。
 *
 * 原理：从应用自身数据（watch_history / favorite / impression / search_history）
 * 构建用户兴趣标签画像 user_interest_tag，然后**候选召回归一**：
 * 每轮重算只对「召回候选集」（行为相关 ∪ 画像命中 ∪ 探索最新，几千行）现算分并重排，
 * 生成全部候选序落 recommend_candidates（UI「推荐」数据源）。
 * **任何时刻都不对全库打分/物化**（v5 删除 personal_score 全表物化维护）。
 * 重算幂等：给定行为数据 + 候选集，结果确定；行为/画像/新采集变化才进入重算。
 *
 * v4 重构（修复「点开即退全判弃看」导致的类型负分爆炸 + 全量重排/写库性能问题）：
 *   - 完全移除弃看惩罚：进度 <30% 的「点开即退」不再算负向信号，只作为统计（overview）。
 *   - 移除子分类降权（penalized）：不再按子分类弃看率整部 -15。
 *   - genre 归一化：剧情片/剧情、喜剧片/喜剧、动作片/动作 等价标签统一，消除信号重复污染。
 *   - 搜索词噪声清洗：纯年份/语种/格式词不再进 keyword 画像。
 *   - 性能：打散仅在高分池 highScorePoolSize 内进行（避免全量 22 万级
 *     桶排序开销）、探索池限量 explorePoolLimit、启动增量状态从 user_interest_tag 读回
 *     （不再进程重启即全量）、新增 media 判据改用 media_change_log、算法版本号 forceFull 一次
 *     保证升级一致性。
 * v5（候选召回归一，去全表物化）：
 *   - 删除「全表计算 personal_score 并回写 media」链路：不再有增量 A 集/全表物化。
 *   - 重算 = 召回候选（行为/画像倒排/探索最新，SQL 限量）→ 对候选现算 → 落 recommend_candidates。
 *   - 冷启动/清空重学/算法升级均不再全表打分（升级只强制重建候选）。
 *   - 分类页「推荐」排序改由 recommend_candidates JOIN media 驱动（候选内筛选+翻页）。
 *
 * 完播定义（沿用）：作品完播 = 看完「用户实际使用主源」的当前最新一集。
 *   - 主源 = 该 media 观看记录中 episode 所属 source 记录数最多的源（源内集号自洽，规避跨源错位）
 *   - 目标集 = 主源内 max(season, episode_number)，title 含预告/花絮等噪声则降级到次大集
 *   - 连载剧：追到最新 = 完播；完结剧：看完结局 = 完播
 *   - 跨源观看（非主源记录）仅计「看过」，不参与目标集/完播判定
 *   - 追多集 = 主源内去重后的单集完播数（修复跨源同集重复计数）
 *
* 打分规则（抖音式多目标 × 时间衰减 × 置信度收缩）：
 *   直接信号：完播(按时长分档) / 追多集 +5 / 收藏 +20
 *   兴趣匹配：media 标签(genre/director/actor)命中用户兴趣强度累加，单部封顶 ±60，
 *             负向标签按 negMult 弱化；搜索关键词标签文本命中计入
 *   已看抑制：最近 recentWindowDays 天看过的正分 × recentFactor
 *   续季关联：已消费 series_group 的后续季 +seriesContinueBoost
 *   不感兴趣：dislike 影片 -10，画像负向（同类联动），推荐序/探索池剔除
 *   展示未点开/弃看：仅作统计（overview），不参与打分（v4 移除负向惩罚，杜绝负分爆炸）
 *   重排：排序(确定性抖动) → 同季去重(U6) → 高分池内贪心打散(genre/director/series) → 探索插槽 → 限量
 *
 * 用户可控（v4）：
 *   - 详情页「不感兴趣」→ dislike 表
 *   - 设置页「已屏蔽标签」→ interest_tag_blacklist 表（画像与匹配均跳过）
 */

export const LEARN_RESET_KEY = 'recommend.learnResetAt';
/** 算法版本号：评分/重排/召回规则变更时 +1，低于当前版本的库在下次重算时强制重建候选（升级一致性）。 */
export const RECOMMEND_ALGO_VERSION = '5';
export const ALGO_VERSION_KEY = 'recommend.algoVersion';

const UNKNOWN_GENRE = '未知';

/** 目标集噪声集：高集号的预告/花絮等不作为「最新一集」判定依据。 */
const COMPLETE_NOISE_RE = /预告|花絮|片花|SP|特辑|先行|剪辑|片段|彩蛋/i;

/** 确定性字符串散列（FNV-1a），用于排序抖动；同一 id 恒同值，保证重算可还原。 */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function jitter(id: number): number {
  return ((hashString(String(id)) % 100) / 100) * RECOMMEND_PARAMS.jitterStrength;
}

/** 完播分值按时长分档：短剧单集 +8、常规剧集/短电影 +10、长电影 +12。 */
function scoreForComplete(duration: number): number {
  if (duration < 45 * 60) return RECOMMEND_PARAMS.completeScoreShort;
  if (duration < 2 * 60 * 60) return RECOMMEND_PARAMS.completeScoreNormal;
  return RECOMMEND_PARAMS.completeScoreLong;
}

export const RECOMMEND_PARAMS = {
  completeThreshold: 0.9,
  /** 弃看阈值（progress/duration < 该值判为「点开即退」）——仅作统计展示，不参与打分。 */
  giveUpThreshold: 0.3,
  bingeEpisodeCount: 3,
  completeScoreShort: 8,
  completeScoreNormal: 10,
  completeScoreLong: 12,
  bingeScore: 5,
  favoriteScore: 20,
  /** 不感兴趣负向分（与弃看同级，但额外从推荐序/探索池剔除）。 */
  dislikeScore: -10,
  searchBonus: 3,
  /** 参与搜索命中匹配的关键词数量上限。 */
  maxSearchKeywords: 50,
  /** 兴趣标签衰减半衰期。 */
  halfLifeMs: 60 * 24 * 60 * 60 * 1000,
  /** 置信度收缩系数：strength × n/(n+shrinkK)。 */
  shrinkK: 3,
  /** 已看抑制窗口（天）。 */
  recentWindowDays: 7,
  /** 已看抑制系数：最近看过的正分乘以此值。 */
  recentFactor: 0.4,
  /** 已看剔除窗口（天）：最近 N 天内作品完播的从推荐序剔除。 */
  watchedExcludeWindowDays: 30,
  /** 续季关联加成：已消费 series_group 的后续季加分。 */
  seriesContinueBoost: 10,
  /** 兴趣匹配单部封顶。 */
  interestMatchCap: 60,
  /** 负向标签折算：不喜欢方向仅弱化。 */
  negMult: 0.5,
  /** 探索占比：每 1/exploreRatio 位插 1 个探索位。 */
  exploreRatio: 0.1,
  /** 打散：同类连续上限。 */
  dispersionMaxConsecutive: 3,
  /** 排序确定性抖动幅度（< 最小信号差，不翻转真实强弱）。 */
  jitterStrength: 1.5,
  /** 演员标签每部封顶数量。 */
  castTagMaxPerMedia: 10,
  /** 概览兴趣标签 abs(strength) 下限（过滤噪声）。 */
  overviewStrengthFloor: 0.5,
/** 候选推荐集限量（UI「推荐」数据源，越大筛选命中越多；写入/翻页成本随其线性增长）。 */
  candidateSize: 2000,
  /** 进入线性打散的高分候选池规模（远小于全量，控制打散成本）。 */
  highScorePoolSize: 1500,
  /** 探索候选池限量（未互动零分 media 中取 updated_at 最新的 N 条）。 */
  explorePoolLimit: 800,
  /** 画像命中最多携带的候选行数：genre 各标签回带的上限（召回近邻没起则漏，宁多勿漏）。 */
  recallHitGenreLimit: 800,
  recallHitDirectorLimit: 500,
  recallHitActorLimit: 300,
  recallHitKeywordLimit: 400,
  /** 画像命中倒排的扫描窗口：仅对可见行中 updated_at 最新的 N 行做 INSTR/LIKE 过滤。
   *  不加窗口时 keyword 匹配稀疏的行需全表反向扫描直至收集满（实测 title LIKE '%x%' 8.6s），
   *  加 updated_at>=窗口 谓词后部分索引区间扫描只 eval 最近 N 行（实测 5ms），
   *  语义上即「近邻且新鲜」：画像召回天然限定在热门/新鲜窗口内。 */
  recallWindow: 5000,
} as const;

/** 不感兴趣列表项（设置页展示）。 */
export interface DislikedMediaItem {
  mediaId: number;
  title: string;
  createdAt: string;
}

/** 兴趣标签黑名单项。 */
export interface TagBlacklistItem {
  tag: string;
  tagType: 'genre' | 'director' | 'actor' | 'keyword';
  createdAt: string;
}

export interface RecommendationOverview {
  completedCount: number;
  giveUpCount: number;
  penalizedSubtypes: string[];
  topInterestTags: { tag: string; type: string; strength: number }[];
  /** 当前推荐候选 top（为你推荐靠前，来自候选表）。 */
  topMedia: { id: number; title: string; score: number }[];
  searchKeywordCount: number;
  impressionMediaCount: number;
  /** 已标记不感兴趣的影片数。 */
  dislikedMediaCount: number;
  /** 已屏蔽的兴趣标签。 */
  blacklistedTags: TagBlacklistItem[];
}

interface GenreStats {
  samples: number;
  giveUps: number;
  completions: number;
}

interface MediaTags {
  genres: string[];
  directors: string[];
  actors: string[];
}

interface InterestTag {
  tag: string;
  type: 'genre' | 'director' | 'actor' | 'keyword';
  strength: number;
  n: number;
  updatedAt: string;
}

interface ScoreEntry {
  total: number;
  updatedAt: string;
  genreGroup: string;
  directorGroup: string;
  seriesGroup: string;
}

/** episode 集号视图（跨源：同一集在不同源是不同 episode_id，源内集号自洽）。 */
interface EpisodeView {
  sourceId: string;
  season: number;
  number: number;
  title: string;
  duration: number;
}

/** 观看信号聚合（v3 完播口径）。 */
interface WatchSignals {
  watchedMedia: Set<string>;
  /** 作品完播：看完主源当前最新一集（或无 episode 时任一记录完播）。 */
  completedMedia: Set<string>;
  /** 作品完播时的目标集时长（完播分档用）。 */
  completedDuration: Map<string, number>;
  giveUpMedia: Set<string>;
  /** 主源内去重后的单集完播数。 */
  bingeCount: Map<string, number>;
  latest: Map<string, { progress: number; duration: number; at: string }>;
}

/** 与 rowMappers.parseStringArray 一致的兜底：DB 列为 JSON 数组字符串，非 JSON（纯文本）按逗号拆分。 */
function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === 'string' && x.length > 0);
  } catch {
    return raw
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
}

/**
 * genre 等价标签归一：数据同时存在「剧情片/剧情」「喜剧片/喜剧」「动作片/动作」等
 * 等价写法，导致同一信号被重复打到多个标签、负分/正分污染翻倍。统一映射到一侧，并全链共用。
 */
const GENRE_NORMALIZE: Record<string, string> = {
  剧情片: '剧情',
  喜剧片: '喜剧',
  动作片: '动作',
  爱情片: '爱情',
  恐怖片: '恐怖',
  科幻片: '科幻',
  犯罪片: '犯罪',
  惊悚片: '惊悚',
  悬疑片: '悬疑',
  武侠片: '武侠',
  奇幻片: '奇幻',
  冒险片: '冒险',
  战争片: '战争',
  动画片: '动画',
  纪录片: '纪录片',
};

export function normalizeGenre(g: string): string {
  return GENRE_NORMALIZE[g] ?? g;
}

/** 语种/清晰度/格式类搜索噪声词（形如「国语」「粤语」「国语、」「国语版」「高清」「4k」「2026」）。 */
const SEARCH_NOISE_RE =
  /^(国语|粤语|英语|日语|韩语|法语|德语|俄语|泰语|普通话|双语)(版|、|，|,)*$|^(中字|字幕|无字|高清|超清|蓝光|原盘|4k|1080p|720p|收藏版|完整版|国语版|粤语版)(、|，|,)*$|^\d{4}$/;

/**
 * 搜索词清洗：剔除纯年份、语种、清晰度等不表达内容兴趣的词，避免污染 keyword 画像。
 * 保留内容词（叶玉卿/任达华/珠光宝气/大内密探零零发 等）。
 */
export function normalizeSearchKeyword(raw: string): string {
  const k = String(raw || '').trim();
  if (!k) return '';
  if (SEARCH_NOISE_RE.test(k)) return '';
  return k;
}

export class RecommendationService {
  constructor(private db: DatabaseProvider) {}

  // —— 增量重算状态（内存 + user_interest_tag 表持久化：重启后从表读回，避免启动全量） ——
  private lastWrittenInterest?: Map<string, InterestTag>;
  private lastResetAt?: string | null;

  /**
   * 对比新旧兴趣画像，返回发生变化的 tag。
   * - exact：genre/director/actor 类，复合 key（`type\u0000tag`），供 tagToMedia 倒排定位 media。
   * - keyword：搜索词类，匹配是 mediaText 子串语义（见 computeMediaScore），无法用倒排，需全量扫描。
   */
  private diffInterest(
    next: Map<string, InterestTag>,
    prev?: Map<string, InterestTag>
  ): { exact: Set<string>; keyword: Set<string> } {
    const exact = new Set<string>();
    const keyword = new Set<string>();
    if (!prev) return { exact, keyword }; // 调用方据此走全量 A
    const eps = 1e-4;
    const allKeys = new Set<string>([...next.keys(), ...prev.keys()]);
    for (const k of allKeys) {
      const a = next.get(k);
      const b = prev.get(k);
      const aS = a ? a.strength : 0;
      const bS = b ? b.strength : 0;
      if (Math.abs(aS - bS) > eps) {
        const type = (a || b)!.type;
        if (type === 'keyword') keyword.add((a || b)!.tag);
        else exact.add(k);
      }
    }
    return { exact, keyword };
  }

  private async getLearnResetAt(): Promise<string | null> {
    const row = await this.db.selectOne<{ value: string }>(
      'SELECT value FROM system_config WHERE key = ?',
      [LEARN_RESET_KEY]
    );
    return row?.value || null;
  }

  private async setLearnResetAt(at: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.execute(
      `INSERT INTO system_config (key, value, value_type, remark, created_at, updated_at)
       VALUES (?, ?, 'string', '推荐学习起始时间：早于该时间的观看/搜索信号被忽略', ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
      [LEARN_RESET_KEY, at, now, now]
    );
  }

  /** 读取算法版本（无则为 null，视为旧库需全量重算）。 */
  private async getAlgoVersion(): Promise<string | null> {
    const row = await this.db.selectOne<{ value: string }>(
      'SELECT value FROM system_config WHERE key = ?',
      [ALGO_VERSION_KEY]
    );
    return row?.value || null;
  }

  private async setAlgoVersion(v: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.execute(
      `INSERT INTO system_config (key, value, value_type, remark, created_at, updated_at)
       VALUES (?, ?, 'string', '推荐算法版本号：低于当前版本时下一次重算强制全量', ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
      [ALGO_VERSION_KEY, v, now, now]
    );
  }

  /** 从 user_interest_tag 表读回上次成功重算写入的兴趣画像，作为增量 diff 基准（进程重启后恢复增量）。 */
  private async loadPersistedInterest(): Promise<Map<string, InterestTag>> {
    try {
      const rows = await this.db.select<{ tag: string; tag_type: string; strength: number; sample_count: number; updated_at: string }>(
        `SELECT tag, tag_type, strength, sample_count, updated_at FROM user_interest_tag`
      );
      const m = new Map<string, InterestTag>();
      for (const r of rows) {
        if (!r.tag) continue;
        m.set(`${r.tag_type}\u0000${r.tag}`, {
          tag: r.tag,
          type: r.tag_type as InterestTag['type'],
          strength: r.strength ?? 0,
          n: r.sample_count ?? 0,
          updatedAt: r.updated_at || '',
        });
      }
      return m;
    } catch {
      // 旧版数据库可能缺 user_interest_tag 表，忽略
      return new Map();
    }
  }

  /** 读取重学时间点（无则为 null）。 */
  async getResetAt(): Promise<string | null> {
    return this.getLearnResetAt();
  }

  private scheduleTimer: ReturnType<typeof setTimeout> | null = null;
  private recomputeChain: Promise<number> = Promise.resolve(0);

  /**
   * 事件触发重算入口：合并 30 秒内的多次事件为一次全量重算，
   * 且与已执行中的重算串行，避免并发写冲突。空闲兜底按 60 秒执行。
   */
  scheduleRecompute(delayMs = 30000): void {
    // 已有窗口在跑则直接合并，避免高频信号（如持续翻页产生的曝光）不断重置
    // 计时导致重算永远不执行（饿死）。首触发起一个窗口，到点执行后清空，再有信号再起窗口。
    if (this.scheduleTimer) return;
    this.scheduleTimer = setTimeout(() => {
      this.scheduleTimer = null;
      this.recomputeChain = this.recomputeChain
        .then(() => this.recomputeAll())
        .catch((e) => {
          console.error('[RecommendationService] recompute failed', e);
          return 0;
        });
    }, delayMs);
  }

  /** 立即冲刷一次全量重算（用于启动初始化 / 清空重学后），并等待完成。 */
  async flushRecompute(): Promise<number> {
    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = null;
    }
    return (this.recomputeChain = this.recomputeChain
      .then(() => this.recomputeAll())
      .catch((e) => {
        console.error('[RecommendationService] recompute failed', e);
        return 0;
      }));
  }

  /** 启动期是否需要重建候选：存在变化日志，或推荐候选表尚不存在（冷启动需构建一次）。 */
  async needsStartupRecompute(): Promise<boolean> {
    if (await this.hasChangesSinceLastRecompute()) return true;
    try {
      const row = await this.db.selectOne<{ c: number }>('SELECT COUNT(*) as c FROM recommend_candidates');
      return (row?.c ?? 0) === 0;
    } catch {
      return true;
    }
  }

  /** 半衰期指数衰减：事件距今越远权重越低。 */
  private decay(at: string | null | undefined, now: number): number {
    if (!at) return 1;
    const t = new Date(at).getTime();
    if (isNaN(t)) return 1;
    const dt = now - t;
    if (dt <= 0) return 1;
    return Math.pow(0.5, dt / RECOMMEND_PARAMS.halfLifeMs);
  }

  private parseTags(row: any): MediaTags {
    const actors = parseStringArray(row.cast);
    return {
      genres: parseStringArray(row.genre).map(normalizeGenre),
      directors: parseStringArray(row.director),
      actors: actors.slice(0, RECOMMEND_PARAMS.castTagMaxPerMedia),
    };
  }

  private readonly HISTORY_JOIN_SQL = `
    SELECT wh.media_id, wh.episode_id, wh.progress AS progress, wh.duration AS duration, wh.updated_at,
           e.source_id, e.season_number, e.episode_number, e.title AS ep_title, e.duration AS ep_duration
    FROM watch_history wh LEFT JOIN episode e ON e.id = wh.episode_id`;

  /**
   * 检查是否有自上次重算以来的变化记录
   */
  private async hasChangesSinceLastRecompute(): Promise<boolean> {
    try {
      const row = await this.db.selectOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM media_change_log'
      );
      return (row?.count || 0) > 0;
    } catch {
      return false;
    }
  }

  /**
   * 清空变化日志（重算完成后）
   */
  private async clearChangeLog(): Promise<void> {
    try {
      await this.db.execute('DELETE FROM media_change_log', []);
    } catch {
      // 表可能尚不存在（旧版数据库），忽略
    }
  }

  /**
   * 记录媒体变化（供外部调用）
   */
  async recordMediaChange(mediaId: number, changeType: string): Promise<void> {
    try {
      await this.db.execute(
        `INSERT OR REPLACE INTO media_change_log (media_id, change_type, created_at)
         VALUES (?, ?, ?)`,
        [mediaId, changeType, new Date().toISOString()]
      );
    } catch {
      // 表可能尚不存在（旧版数据库），忽略
    }
  }

  /**
   * 全量重算：构建兴趣画像 → 全量打分 → 重排 → 落库快照/画像。
   * 返回本次发生变化的 media 数。幂等。
   */
  async recomputeAll(): Promise<number> {
    const resetAt = await this.getLearnResetAt();
    const algoVersion = await this.getAlgoVersion();
    // 算法版本升级 / 清学重置后强制重建候选；并清空内存画像基准（避免旧画像残留）。
    // v5 语义：升级只需按最新行为数据重召回+重排候选，不再触发任何全表打分。
    let forceFull = false;
    if (algoVersion !== RECOMMEND_ALGO_VERSION) {
      forceFull = true;
      this.lastWrittenInterest = undefined;
      this.lastResetAt = undefined;
    }
    // resetAt 为空（未设置）时统一归一化为 null：DB 查询返回 null，而内存初始为 undefined，
    // 直接 !== 比较会把「从未重置」误判成「重置过」，导致进程重启后首轮必然强制重建候选。
    if ((resetAt ?? null) !== (this.lastResetAt ?? null)) {
      forceFull = true;
      this.lastWrittenInterest = undefined;
    }
    const historyResetSql = resetAt ? ' WHERE wh.updated_at >= ?' : '';
    const searchResetSql = resetAt ? ' WHERE updated_at >= ?' : '';
    const resetParams = resetAt ? [resetAt] : [];
    // 收藏按收藏时间过滤：真重置时，重置前收藏同样不再参与学习
    const favoriteResetSql = resetAt ? ' WHERE created_at >= ?' : '';

    const [historyRows, favoriteRows, impressionRows, searchRows, dislikedRows, tagBlacklistRows] =
      await Promise.all([
        this.db.select<any>(`${this.HISTORY_JOIN_SQL}${historyResetSql}`, resetParams),
        this.db.select<{ media_id: string; created_at: string }>(
          `SELECT media_id, created_at FROM favorite${favoriteResetSql}`,
          resetParams
        ),
        this.db.select<{ media_id: string; shown_count: number; last_shown_at: string }>(
          'SELECT media_id, shown_count, last_shown_at FROM impression'
        ),
        this.db.select<any>(
          `SELECT keyword, count, updated_at FROM search_history${searchResetSql} ORDER BY updated_at DESC LIMIT ?`,
          [...resetParams, RECOMMEND_PARAMS.maxSearchKeywords]
        ),
        this.db.select<{ media_id: string; created_at: string }>(
          'SELECT media_id, created_at FROM dislike'
        ),
        this.db.select<{ tag: string; tag_type: string; created_at: string }>(
          'SELECT tag, tag_type, created_at FROM interest_tag_blacklist'
        ),
      ]);
    const disliked = new Set(dislikedRows.map((r) => r.media_id));
    const tagBlacklist = new Set<string>();
    for (const r of tagBlacklistRows) {
      if (r.tag) tagBlacklist.add(`${r.tag_type}\u0000${r.tag}`);
    }

    const now = Date.now();

    const favorites = new Set(favoriteRows.map((r) => r.media_id));
    const favoriteAt = new Map<string, string>();
    for (const r of favoriteRows) favoriteAt.set(r.media_id, r.created_at);
    const impressionAt = new Map<string, string>();
    for (const r of impressionRows) {
      if (r.last_shown_at) impressionAt.set(r.media_id, r.last_shown_at);
    }

    // —— 观看涉及的 media 的 episode 全集（按源分组，供主源目标集判定） ——
    const watchedMediaIds = Array.from(new Set(historyRows.map((r) => r.media_id)));
    const episodesByMediaAndSource = new Map<string, Map<string, EpisodeView[]>>();
    if (watchedMediaIds.length > 0) {
      const placeholders = watchedMediaIds.map(() => '?').join(',');
      const episodeRows = await this.db.select<any>(
        `SELECT media_id, source_id, season_number, episode_number, title, duration
         FROM episode WHERE media_id IN (${placeholders})`,
        watchedMediaIds
      );
      for (const r of episodeRows) {
        const src = r.source_id || '';
        let m = episodesByMediaAndSource.get(r.media_id);
        if (!m) {
          m = new Map();
          episodesByMediaAndSource.set(r.media_id, m);
        }
        let arr = m.get(src);
        if (!arr) {
          arr = [];
          m.set(src, arr);
        }
        arr.push({
          sourceId: src,
          season: r.season_number || 0,
          number: r.episode_number || 0,
          title: r.title || '',
          duration: r.duration || 0,
        });
      }
    }

    // —— 观看信号（主源内完播口径；v4 起弃看仅统计不参与打分，无坏源豁免） ——
    const signals = this.buildWatchSignals(historyRows, episodesByMediaAndSource, new Set(), now);
    const { watchedMedia, completedMedia, giveUpMedia, bingeCount, latest } = signals;

    // —— 已看剔除：最近 watchedExcludeWindowDays 天内作品完播的集合（单独构建，不复用 7 天 recentWatched） ——
    const excludedWindowMs = RECOMMEND_PARAMS.watchedExcludeWindowDays * 24 * 60 * 60 * 1000;
    const excludedCompleted = new Set<string>();
    for (const mediaId of completedMedia) {
      const l = latest.get(mediaId);
      if (l) {
        const t = new Date(l.at).getTime();
        if (!isNaN(t) && now - t <= excludedWindowMs) excludedCompleted.add(mediaId);
      }
    }

    // 已看抑制窗口：最近看过的 media 集合（与信号同一数据源）
    const recentWindowMs = RECOMMEND_PARAMS.recentWindowDays * 24 * 60 * 60 * 1000;
    const recentWatched = new Set<string>();
    for (const [mediaId, l] of latest) {
      const t = new Date(l.at).getTime();
      if (!isNaN(t) && now - t <= recentWindowMs) recentWatched.add(mediaId);
    }

    // —— 画像构建前置：只需「行为直接涉及的 media 子集」标签，避免短路前全量读 15 万行 ——
    const kidModeActive = await this.db.getKidModeActive();
    // v4：impression 仅统计不参与画像，子集只取 watched/favorite/disliked
    const signalIds = new Set<string>([...watchedMedia, ...favorites, ...disliked]);
    const subsetRows: any[] =
      signalIds.size > 0
        ? await this.db.select<any>(
            `SELECT id, genre, director, "cast"
             FROM media WHERE id IN (${Array.from(signalIds).map(() => '?').join(',')})`,
            Array.from(signalIds)
          )
        : [];
    const tagsOf = new Map<string, MediaTags>();
    for (const row of subsetRows) {
      tagsOf.set(row.id, this.parseTags(row));
    }

    // —— 构建用户兴趣画像（每次重建：interest 依赖行为数据，须与重算一致，不缓存） ——
    const interest = this.buildUserInterestTags({
      tagsOf,
      watchedMedia,
      completedMedia,
      completedDuration: signals.completedDuration,
      bingeCount,
      favorites,
      latest,
      favoriteAt,
      impressionAt,
      searchRows,
      disliked,
      tagBlacklist,
      now,
    });

    // 落库时 strength 舍入到 2 位小数（见 persistInterest）。为让「重启后读回的 diff 基准」与
    // 持久化值可空集短路，画像强度统一按相同舍入规整后再参与 diff/打分/落库，避免首轮误重建。
    for (const it of interest.values()) it.strength = Math.round(it.strength * 100) / 100;

    // —— 增量判定：变化集（v5 起仅作短路依据；非 forceFull 且无变化则跳过整次候选重建） ——
    // 重启后内存态丢失：从 user_interest_tag 表读回上次画像作为 diff 基准（forceFull 除外）
    if (!forceFull && this.lastWrittenInterest === undefined) {
      this.lastWrittenInterest = await this.loadPersistedInterest();
    }
    const changed = this.diffInterest(interest, this.lastWrittenInterest);
    const changedExact = changed.exact;
    const changedKeyword = changed.keyword;
    // 新增/更新 media（采集 UPSERT / STATUS_UPDATE 时写入 media_change_log）。
    let hasDelta = false;
    try {
      const cntRow = await this.db.selectOne<{ c: number }>('SELECT COUNT(*) as c FROM media_change_log');
      hasDelta = (cntRow?.c ?? 0) > 0;
    } catch {
      // 旧版数据库可能缺 media_change_log 表，忽略（退化到仅画像变化驱动）
    }
    // 候选表是否已就绪（幂等重跑判据）
    const candidatesReady = await (async () => {
      try {
        const row = await this.db.selectOne<{ c: number }>('SELECT COUNT(*) as c FROM recommend_candidates');
        return (row?.c ?? 0) > 0;
      } catch {
        return false;
      }
    })();
    // 零成本短路：画像无变化 且 无新增 media 且 候选表已就绪 且 非强制重建 → 直接返回
    if (!forceFull && changedExact.size === 0 && changedKeyword.size === 0 && !hasDelta && candidatesReady) {
      return 0;
    }

    // —— 续季关联：已消费（作品完播/追多集/收藏）series_group 的最大 season（只对消费集中的行查，不再发全库） ——
    const consumed = new Set<string>(completedMedia);
    for (const [mediaId, n] of bingeCount) {
      if (n >= RECOMMEND_PARAMS.bingeEpisodeCount) consumed.add(mediaId);
    }
    for (const id of favorites) consumed.add(id);
    const watchedSeriesMaxSeason = new Map<string, number>();
    if (consumed.size > 0) {
      const cRows = await this.db.select<{ series_group: string; series_season: number }>(
        `SELECT series_group, series_season FROM media
         WHERE id IN (${Array.from(consumed).map(() => '?').join(',')})`,
        Array.from(consumed)
      );
      for (const r of cRows) {
        if (!r.series_group) continue;
        const season = r.series_season ?? 0;
        const cur = watchedSeriesMaxSeason.get(r.series_group) ?? -1;
        if (season > cur) watchedSeriesMaxSeason.set(r.series_group, season);
      }
    }

    // —— 候选召回（v5 核心：只对召回候选现算分，任何时刻不对全库打分） ——
    const visibleSql = `(hidden IS NULL OR hidden = 0)${kidModeActive ? ' AND kid_safe = 1' : ''}`;
    // v5 候选召回的「近邻且新鲜」倒排全部走 updated_at 部分索引反向扫描早停：
    // 无该索引时优化器选 idx_media_hidden + 全表 TEMP 排序（实测 22.6 万行 9-11s/次），
    // INDEXED BY 后毫秒级。kid 模式开启时可见谓词含 kid_safe=1，与被索引 part 条件不等价，
    // 退化为无 INDEXED BY 的原查询（kid 库行数少，仍可接受）。
    const updatedAtIdx = kidModeActive ? '' : ' INDEXED BY idx_media_updated_at_visible';
    // 画像倒排扫描窗口截止值（可见行最新 recallWindow 行的 min(updated_at)，一次查 5ms 级）。
    // kid 模式（无 INDEXED BY 可走）退化为 null，召回不加窗口谓词（行数少可接受）。
    const recallWindowTs = kidModeActive
      ? null
      : (
          await this.db.select<{ ts: string | null }>(
            `SELECT min(updated_at) AS ts FROM (
               SELECT updated_at FROM media${updatedAtIdx}
               WHERE ${visibleSql} ORDER BY updated_at DESC LIMIT ?)`,
            [RECOMMEND_PARAMS.recallWindow]
          )
        )[0]?.ts ?? null;
    const candidates = new Set<string>();
    // a) 行为直接相关（看完/收藏/不感兴趣 必进候选，直接信号在该范围内加成）
    for (const id of watchedMedia) candidates.add(id);
    for (const id of favorites) candidates.add(id);
    for (const id of disliked) candidates.add(id);
    // b) 画像命中召回（对应双塔召回的用户向量近邻）：按型聚合所有显著标签为少量
    //    批量 INSTR/LIKE 倒排（避免「每标签一条 select」串行——桌面遗留 68 标签实测
    //    每条 250ms 串行成 17s+，合并后单批毫秒级），ORDER BY updated_at DESC 取「近邻且新鲜」，
    //    每型 LIMIT = 各标签限量之和再封顶（宁多勿漏，最终由 candidateSize 截断）。
    const interestBatch = { genre: [] as string[], director: [] as string[], actor: [] as string[], keyword: [] as string[] };
    const genreRawTabs = new Map<string, string[]>();
    for (const [raw, std] of Object.entries(GENRE_NORMALIZE)) {
      let arr = genreRawTabs.get(std);
      if (!arr) { arr = []; genreRawTabs.set(std, arr); }
      arr.push(raw);
    }
    for (const it of interest.values()) {
      if (Math.abs(it.strength) <= 1e-4) continue;
      const tag = it.tag;
      if (it.type === 'genre') {
        const raws = genreRawTabs.get(tag) || [];
        for (const t of [tag, ...raws]) {
          const p = t.replace(/"/g, '');
          if (p) interestBatch.genre.push(p);
        }
      } else if (it.type === 'director' || it.type === 'actor') {
        const p = tag.replace(/"/g, '');
        if (p) (it.type === 'director' ? interestBatch.director : interestBatch.actor).push(p);
      } else if (it.type === 'keyword') {
        const lower = tag.toLowerCase();
        if (!lower) continue;
        const escaped = lower.replace(/[%_\\]/g, (c) => '\\' + c);
        interestBatch.keyword.push(`%${escaped}%`);
      }
    }
    // 批量执行：每批变量数上限（SQLite 变量 999；keyword 每标签 6 个 LIKE 条件）
    const RECALL_VAR_LIMIT = 90;
    const RECALL_CAP = 2500;
    const flushRecall = async (conds: string[], params: string[], limit: number) => {
      const windowCond = recallWindowTs != null ? ' AND updated_at >= ?' : '';
      for (let i = 0; i < conds.length; i += RECALL_VAR_LIMIT) {
        const c = conds.slice(i, i + RECALL_VAR_LIMIT);
        const p = params.slice(i, i + RECALL_VAR_LIMIT);
        const rows = await this.db.select<{ id: string }>(
          `SELECT id FROM media${updatedAtIdx} WHERE ${visibleSql}${windowCond} AND (${c.join(' OR ')})
           ORDER BY updated_at DESC LIMIT ?`,
          recallWindowTs != null ? [recallWindowTs, ...p, limit] : [...p, limit]
        );
        for (const r of rows) candidates.add(r.id);
      }
    };
    if (interestBatch.genre.length) {
      await flushRecall(
        interestBatch.genre.map(() => 'instr(genre, ?) > 0'),
        interestBatch.genre,
        Math.min(interestBatch.genre.length * RECOMMEND_PARAMS.recallHitGenreLimit, RECALL_CAP)
      );
    }
    if (interestBatch.director.length) {
      await flushRecall(
        interestBatch.director.map(() => 'instr(director, ?) > 0'),
        interestBatch.director,
        Math.min(interestBatch.director.length * RECOMMEND_PARAMS.recallHitDirectorLimit, RECALL_CAP)
      );
    }
    if (interestBatch.actor.length) {
      await flushRecall(
        interestBatch.actor.map(() => 'instr("cast", ?) > 0'),
        interestBatch.actor,
        Math.min(interestBatch.actor.length * RECOMMEND_PARAMS.recallHitActorLimit, RECALL_CAP)
      );
    }
    if (interestBatch.keyword.length) {
      const kwConds: string[] = [];
      const kwParams: string[] = [];
      for (const like of interestBatch.keyword) {
        for (const col of ['title', 'original_title', 'alias', 'director', '"cast"', 'genre']) {
          kwConds.push(`${col} LIKE ? ESCAPE '\\'`);
          kwParams.push(like);
        }
      }
      await flushRecall(
        kwConds,
        kwParams,
        Math.min(interestBatch.keyword.length * RECOMMEND_PARAMS.recallHitKeywordLimit, RECALL_CAP)
      );
    }
    // c) 探索候选：可见范围内最新的一批（未互动由 reorder 内部按已看/不感兴趣剔除；explore 插槽取零分）
    const exploreRows = await this.db.select<{ id: string }>(
      `SELECT id FROM media${updatedAtIdx} WHERE ${visibleSql}
       ORDER BY updated_at DESC LIMIT ?`,
      [RECOMMEND_PARAMS.explorePoolLimit + 300]
    );
    for (const r of exploreRows) candidates.add(r.id);

    // —— 只对候选集取行并现算分（分批 IN 规避 SQLite 变量上限） ——
    const keywordStrengths = new Map<string, number>();
    for (const it of interest.values()) {
      if (it.type === 'keyword' && it.strength !== 0) keywordStrengths.set(it.tag, it.strength);
    }
    const candRows: any[] = [];
    const candIds = Array.from(candidates);
    const IN_BATCH = 400;
    for (let i = 0; i < candIds.length; i += IN_BATCH) {
      const chunk = candIds.slice(i, i + IN_BATCH);
      const rows = await this.db.select<any>(
        `SELECT id, title, original_title, alias, genre, director, "cast", hidden, updated_at,
                series_group, series_season
         FROM media WHERE id IN (${chunk.map(() => '?').join(',')})`,
        chunk
      );
      candRows.push(...rows);
    }
    const scores = new Map<string, ScoreEntry>();
    const YIELD_EVERY = 500;
    let processed = 0;
    for (const row of candRows) {
      const tags = this.parseTags(row);
      const total = this.computeMediaScore({
        row,
        tags,
        interest,
        keywordStrengths,
        watchedMedia,
        completedMedia,
        completedDuration: signals.completedDuration,
        bingeCount,
        favorites,
        watchedSeriesMaxSeason,
        disliked,
      });
      scores.set(row.id, {
        total,
        updatedAt: row.updated_at || '',
        genreGroup: tags.genres[0] || UNKNOWN_GENRE,
        directorGroup: tags.directors[0] || '',
        seriesGroup: row.series_group || '',
      });
      if (++processed % YIELD_EVERY === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    // —— 生成并落库推荐候选 / 精选快照 ——
    const hasSignal =
      Array.from(interest.values()).some((it) => Math.abs(it.strength) > 0.0001) ||
      Array.from(scores.values()).some((s) => s.total !== 0);
    const ordered = hasSignal
      ? this.reorder(scores, candRows, watchedMedia, favorites, recentWatched, excludedCompleted, disliked, RECOMMEND_PARAMS.candidateSize)
      : [];
    await this.db.replaceRecommendationCandidates(ordered.slice(0, RECOMMEND_PARAMS.candidateSize));

    // 重算完成后清空变化日志
    await this.clearChangeLog();

    // 记录本次成功重算的状态，供下次增量 diff
    this.lastWrittenInterest = interest;
    this.lastResetAt = resetAt || null;
    // 标记算法版本：下次启动 getAlgoVersion 命中即不再强制重建
    await this.setAlgoVersion(RECOMMEND_ALGO_VERSION);

    return ordered.length;
  }

  private buildWatchSignals(
    historyRows: any[],
    episodesByMediaAndSource: Map<string, Map<string, EpisodeView[]>>,
    exemptMedia: Set<string>,
    now: number
  ): WatchSignals {
    const watchedMedia = new Set<string>();
    const latest = new Map<string, { progress: number; duration: number; at: string }>();
    const giveUpMedia = new Set<string>();

    for (const h of historyRows) {
      const mediaId = h.media_id;
      watchedMedia.add(mediaId);
      const dur = h.duration || 0;
      const prog = h.progress || 0;
      const prev = latest.get(mediaId);
      if (!prev || h.updated_at > prev.at) {
        latest.set(mediaId, { progress: prog, duration: dur, at: h.updated_at });
      }
    }

    for (const mediaId of watchedMedia) {
      const l = latest.get(mediaId)!;
      if (
        l.duration > 0 &&
        l.progress < l.duration * RECOMMEND_PARAMS.giveUpThreshold &&
        !exemptMedia.has(mediaId)
      ) {
        giveUpMedia.add(mediaId);
      }
    }

    // —— 主源判定：观看记录数最多的 source（同数取 sourceId 字典序，确定性） ——
    const sourceCount = new Map<string, Map<string, number>>();
    for (const h of historyRows) {
      const src = h.source_id || '';
      if (!src) continue;
      let c = sourceCount.get(h.media_id);
      if (!c) {
        c = new Map();
        sourceCount.set(h.media_id, c);
      }
      c.set(src, (c.get(src) || 0) + 1);
    }
    const mainSource = new Map<string, string>();
    for (const [mediaId, counts] of sourceCount) {
      let best = '';
      let bestN = -1;
      for (const [src, n] of counts) {
        if (n > bestN || (n === bestN && src < best)) {
          best = src;
          bestN = n;
        }
      }
      mainSource.set(mediaId, best);
    }

    // —— 主源内观看去重：同一集号只保留进度比最大一条（跨源拼接观看取最好进度） ——
    const bestRatio = new Map<string, Map<string, number>>();
    for (const h of historyRows) {
      const ms = mainSource.get(h.media_id);
      if (!ms || h.source_id !== ms || h.episode_number == null) continue;
      const key = `${h.season_number || 0}:${h.episode_number}`;
      const dur = h.duration || 0;
      const ratio = dur > 0 ? (h.progress || 0) / dur : 0;
      let m = bestRatio.get(h.media_id);
      if (!m) {
        m = new Map();
        bestRatio.set(h.media_id, m);
      }
      if (ratio > (m.get(key) ?? -1)) m.set(key, ratio);
    }

    // —— 目标集：主源内 max(season, number)，噪声集降级到次大 ——
    const targetOf = new Map<string, EpisodeView | null>();
    for (const mediaId of watchedMedia) {
      const ms = mainSource.get(mediaId);
      const list = ms ? (episodesByMediaAndSource.get(mediaId)?.get(ms) || []) : [];
      if (list.length === 0) {
        targetOf.set(mediaId, null);
        continue;
      }
      const sorted = [...list].sort((a, b) => b.season - a.season || b.number - a.number);
      let target = sorted[0];
      if (sorted.length > 1 && COMPLETE_NOISE_RE.test(target.title)) target = sorted[1];
      targetOf.set(mediaId, target);
    }

    // —— 作品完播 + 追多集 ——
    const completedMedia = new Set<string>();
    const completedDuration = new Map<string, number>();
    const bingeCount = new Map<string, number>();
    for (const mediaId of watchedMedia) {
      const keys = bestRatio.get(mediaId);
      if (!keys) continue;
      let completedKeys = 0;
      for (const ratio of keys.values()) {
        if (ratio >= RECOMMEND_PARAMS.completeThreshold) completedKeys++;
      }
      bingeCount.set(mediaId, completedKeys);

      const target = targetOf.get(mediaId);
      const l = latest.get(mediaId)!;
      if (target) {
        const tkey = `${target.season}:${target.number}`;
        if ((keys.get(tkey) ?? 0) >= RECOMMEND_PARAMS.completeThreshold) {
          completedMedia.add(mediaId);
          completedDuration.set(mediaId, target.duration || l.duration || 0);
        }
      } else if (l.duration > 0 && l.progress >= l.duration * RECOMMEND_PARAMS.completeThreshold) {
        completedMedia.add(mediaId);
        completedDuration.set(mediaId, l.duration || 0);
      }
    }

    return { watchedMedia, completedMedia, completedDuration, giveUpMedia, bingeCount, latest };
  }

  private buildUserInterestTags(params: {
    tagsOf: Map<string, MediaTags>;
    watchedMedia: Set<string>;
    completedMedia: Set<string>;
    completedDuration: Map<string, number>;
    bingeCount: Map<string, number>;
    favorites: Set<string>;
    latest: Map<string, { progress: number; duration: number; at: string }>;
    favoriteAt: Map<string, string>;
    impressionAt: Map<string, string>;
    searchRows: any[];
    disliked: Set<string>;
    tagBlacklist: Set<string>;
    now: number;
  }): Map<string, InterestTag> {
    const {
      tagsOf, watchedMedia, completedMedia, completedDuration, bingeCount,
      favorites, latest, favoriteAt, impressionAt, searchRows, disliked,
      tagBlacklist, now,
    } = params;

    const interest = new Map<string, InterestTag>();
    const keyOf = (type: string, tag: string) => `${type}\u0000${tag}`;

    const addSignal = (tag: string, type: 'genre' | 'director' | 'actor', value: number, at: string) => {
      const k = keyOf(type, tag);
      if (tagBlacklist.has(k)) return;
      let it = interest.get(k);
      if (!it) {
        it = { tag, type, strength: 0, n: 0, updatedAt: at };
        interest.set(k, it);
      }
      it.strength += value;
      it.n += 1;
      if (at > it.updatedAt) it.updatedAt = at;
    };

    // media 级信号 → media 标签强度（每部 media 每标签只计一次 n）
    // v4：展示但未点开（impression）仅作统计，不参与打分（与弃看同批移除负向惩罚）
    const signalMedia = new Set<string>(watchedMedia);
    for (const id of favorites) signalMedia.add(id);
    for (const id of disliked) signalMedia.add(id);

    for (const mediaId of signalMedia) {
      const tags = tagsOf.get(mediaId);
      if (!tags) continue;
      let sig = 0;
      if (completedMedia.has(mediaId)) sig += scoreForComplete(completedDuration.get(mediaId) || 0);
      if ((bingeCount.get(mediaId) || 0) >= RECOMMEND_PARAMS.bingeEpisodeCount) {
        sig += RECOMMEND_PARAMS.bingeScore;
      }
      if (favorites.has(mediaId)) sig += RECOMMEND_PARAMS.favoriteScore;
      if (disliked.has(mediaId)) sig += RECOMMEND_PARAMS.dislikeScore;
      if (sig === 0) continue;
      let at = favoriteAt.get(mediaId) || impressionAt.get(mediaId) || '';
      if (!at) {
        const l = latest.get(mediaId);
        if (l) at = l.at;
      }
      const val = sig * this.decay(at, now);
      if (val === 0) continue;
      for (const g of tags.genres) addSignal(g, 'genre', val, at);
      for (const d of tags.directors) addSignal(d, 'director', val, at);
      for (const a of tags.actors) addSignal(a, 'actor', val, at);
    }

    // 搜索关键词 → keyword 标签（count 作置信度样本，不累加强度）；先清洗噪声词（年份/语种/格式）
    for (const r of searchRows) {
      const kw = normalizeSearchKeyword(String(r.keyword || '').trim());
      if (!kw) continue;
      const at = r.updated_at || '';
      if (tagBlacklist.has(keyOf('keyword', kw))) continue;
      const k = keyOf('keyword', kw);
      let it = interest.get(k);
      if (!it) {
        it = { tag: kw, type: 'keyword', strength: 0, n: 0, updatedAt: at };
        interest.set(k, it);
      }
      it.strength += RECOMMEND_PARAMS.searchBonus * this.decay(at, now);
      it.n = Math.max(it.n, r.count || 1);
      if (at > it.updatedAt) it.updatedAt = at;
    }

    // 置信度收缩
    const shrinkK = RECOMMEND_PARAMS.shrinkK;
    for (const it of interest.values()) {
      it.strength = Math.round(it.strength * (it.n / (it.n + shrinkK)) * 100) / 100;
    }

    return interest;
  }

  private computeMediaScore(params: {
    row: any;
    tags: MediaTags;
    interest: Map<string, InterestTag>;
    keywordStrengths: Map<string, number>;
    watchedMedia: Set<string>;
    completedMedia: Set<string>;
    completedDuration: Map<string, number>;
    bingeCount: Map<string, number>;
    favorites: Set<string>;
    watchedSeriesMaxSeason: Map<string, number>;
    disliked: Set<string>;
  }): number {
    const {
      row, tags, interest, keywordStrengths, watchedMedia,
      completedMedia, completedDuration, bingeCount, favorites,
      watchedSeriesMaxSeason, disliked,
    } = params;

    // —— 直接信号 ——
    let direct = 0;
    if (completedMedia.has(row.id)) direct += scoreForComplete(completedDuration.get(row.id) || 0);
    if ((bingeCount.get(row.id) || 0) >= RECOMMEND_PARAMS.bingeEpisodeCount) {
      direct += RECOMMEND_PARAMS.bingeScore;
    }
    if (favorites.has(row.id)) direct += RECOMMEND_PARAMS.favoriteScore;
    if (disliked.has(row.id)) direct += RECOMMEND_PARAMS.dislikeScore;
    // v4：展示但未点开（impression）仅作统计，不参与打分

    // —— 兴趣匹配（泛化核心：未看过的同类新片也能得分） ——
    const uOf = (type: 'genre' | 'director' | 'actor' | 'keyword', tag: string): number => {
      const it = interest.get(`${type}\u0000${tag}`);
      return it ? it.strength : 0;
    };
    const addMatch = (u: number, out: { v: number }) => {
      out.v += u < 0 ? u * RECOMMEND_PARAMS.negMult : u;
    };

    let match = 0;
    const acc = { v: 0 };
    for (const g of tags.genres) addMatch(uOf('genre', g), acc);
    for (const d of tags.directors) addMatch(uOf('director', d), acc);
    for (const a of tags.actors) addMatch(uOf('actor', a), acc);
    if (keywordStrengths.size > 0) {
      const text = this.mediaText(row).toLowerCase();
      for (const [kw, s] of keywordStrengths) {
        if (kw && text.includes(kw.toLowerCase())) addMatch(s, acc);
      }
    }
    match = acc.v;
    const cap = RECOMMEND_PARAMS.interestMatchCap;
    if (match > cap) match = cap;
    else if (match < -cap) match = -cap;

    // —— 合成：已看抑制（只压正分）→ 续季关联 ——
    let base = direct + match;
    // 已看抑制（recentFactor）已移至展示层 reorder，避免 personal_score 依赖当前时间
    let total = Math.round(base);
    if (row.series_group && watchedSeriesMaxSeason.has(row.series_group)) {
      const thisSeason = row.series_season ?? 0;
      if (thisSeason > (watchedSeriesMaxSeason.get(row.series_group) ?? 0)) {
        total += RECOMMEND_PARAMS.seriesContinueBoost;
      }
    }

    return total;
  }

  private mediaText(row: any): string {
    const genres = parseStringArray(row.genre).join(' ');
    return [row.title, row.alias, row.original_title, row.director, row.cast, genres].join(' ');
  }

  /**
   * 重排：已看/不感兴趣剔除 → 同季去重(U6) → 排序(确定性抖动) →
   * 三维打散(genre/director/series，U5) → 探索插槽（去重）→ 位置编号。
   * 纯函数、确定性：翻页/返回可稳定还原。
   */
  private reorder(
    scores: Map<string, ScoreEntry>,
    mediaRows: any[],
    watchedMedia: Set<string>,
    favorites: Set<string>,
    recentWatched: Set<string>,
    excludedCompleted: Set<string>,
    disliked: Set<string>,
    limit: number = RECOMMEND_PARAMS.candidateSize
  ): { mediaId: number; position: number; score: number; genreGroup: string }[] {
    interface Item {
      id: number;
      score: number;
      updatedAt: string;
      genreGroup: string;
      directorGroup: string;
      seriesKey: string;
    }
    const UNKNOWN = UNKNOWN_GENRE;

    // —— U6 同季去重：同 (series_group, series_season) 只保留最高分一条；同时剔除已看/不感兴趣 ——
    const seasonBest = new Map<string, any>();
    const dedupRows: any[] = [];
    for (const r of mediaRows) {
      if (excludedCompleted.has(r.id) || disliked.has(r.id)) continue;
      const group = r.series_group || '';
      if (group) {
        const key = `${group}\u0000${r.series_season ?? 0}`;
        const cur = seasonBest.get(key);
        const score = scores.get(r.id)?.total ?? 0;
        if (!cur) {
          seasonBest.set(key, r);
          dedupRows.push(r);
        } else if (score > (scores.get(cur.id)?.total ?? 0)) {
          seasonBest.set(key, r);
          dedupRows[dedupRows.indexOf(cur)] = r;
        }
      } else {
        dedupRows.push(r);
      }
    }

    const list: Item[] = dedupRows.map((r) => {
      const s = scores.get(r.id)!;
      const group = r.series_group || '';
      // 已看抑制：最近看过的正分 × recentFactor（展示层实时抑制，避免 personal_score 依赖当前时间）
      const raw = s.total;
      const score = raw > 0 && recentWatched.has(r.id) ? raw * RECOMMEND_PARAMS.recentFactor : raw;
      // 无系列 media 的 seriesKey 用 id 唯一化，避免「无系列」作品互相构成打散维度
      return {
        id: r.id,
        score,
        updatedAt: s.updatedAt,
        genreGroup: s.genreGroup || UNKNOWN,
        directorGroup: s.directorGroup || '',
        seriesKey: group || String(r.id),
      };
    });

    // 预排序：(total+jitter DESC, updated_at DESC, id ASC) —— 确定性（jitter 由 id 派生，恒定）
    list.sort(
      (a, b) =>
        b.score + jitter(b.id) - (a.score + jitter(a.id)) ||
        (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );

    // —— U5 三维贪心打散：每次取剩余数量最多的桶；任一维度(genre/director/series)连续达上限即换桶 ——
    // 打散只在高分池内进行（exploit 位），控制 O(池长×桶数) 开销
    const exploitList = list.slice(0, RECOMMEND_PARAMS.highScorePoolSize);
    const buckets = new Map<string, Item[]>();
    for (const m of exploitList) {
      let arr = buckets.get(m.genreGroup);
      if (!arr) {
        arr = [];
        buckets.set(m.genreGroup, arr);
      }
      arr.push(m);
    }
    const maxConsec = RECOMMEND_PARAMS.dispersionMaxConsecutive;
    const order: Item[] = [];
    let lastGenre: string | null = null;
    let genreCount = 0;
    let lastDirector: string | null = null;
    let directorCount = 0;
    let lastSeries: string | null = null;
    let seriesCount = 0;
    const conflicts = (g: string, d: string, s: string) =>
      (lastGenre !== null && g === lastGenre && genreCount >= maxConsec) ||
      (lastDirector !== null && d !== '' && d === lastDirector && directorCount >= maxConsec) ||
      (lastSeries !== null && s !== '' && s === lastSeries && seriesCount >= maxConsec);
    while (order.length < exploitList.length) {
      const cand = Array.from(buckets.entries()).filter(([, arr]) => arr.length > 0);
      cand.sort(
        (a, b) =>
          b[1].length - a[1].length ||
          b[1][0].score + jitter(b[1][0].id) - (a[1][0].score + jitter(a[1][0].id)) ||
          (a[1][0].id < b[1][0].id ? -1 : a[1][0].id > b[1][0].id ? 1 : 0)
      );
      let chosen = cand[0];
      for (const entry of cand) {
        const head = entry[1][0];
        if (!conflicts(entry[0], head.directorGroup, head.seriesKey)) {
          chosen = entry;
          break;
        }
      }
      const [g, arr] = chosen;
      const item = arr.shift()!;
      order.push(item);
      genreCount = g === lastGenre ? genreCount + 1 : 1;
      lastGenre = g;
      const d = item.directorGroup;
      directorCount = d === lastDirector ? directorCount + 1 : 1;
      lastDirector = d;
      const s = item.seriesKey;
      seriesCount = s === lastSeries ? seriesCount + 1 : 1;
      lastSeries = s;
    }

    // 探索池：未互动、未不感兴趣且 total==0，按 (updated_at DESC, id ASC) 取最新 explorePoolLimit 条
    // （U3：探索位优先新内容；限量避免全量排序打散环的开销）
    const explorePool = dedupRows
      .filter(
        (r) =>
          !watchedMedia.has(r.id) &&
          !favorites.has(r.id) &&
          !disliked.has(r.id) &&
          (scores.get(r.id)?.total ?? 0) === 0
      )
      .sort(
        (a, b) =>
          (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      )
      .slice(0, RECOMMEND_PARAMS.explorePoolLimit);

    // 探索插槽：每 exploreRatio 间隔插入一个未占用探索候选；占用过的 media 从 exploit 序中跳过（去重）
    const step = Math.max(2, Math.round(1 / RECOMMEND_PARAMS.exploreRatio));
    const placed = new Set<number>();
    const final: Item[] = [];
    let ep = 0;
    for (let i = 0; i < order.length; i++) {
      let inserted: Item | null = null;
      if (i > 0 && i % step === step - 1) {
        while (ep < explorePool.length && placed.has(explorePool[ep].id)) ep++;
        if (ep < explorePool.length) {
          const cand = explorePool[ep];
          ep++;
          const s = scores.get(cand.id)!;
          inserted = {
            id: cand.id,
            score: s.total,
            updatedAt: s.updatedAt,
            genreGroup: s.genreGroup || UNKNOWN,
            directorGroup: s.directorGroup || '',
            seriesKey: cand.series_group || String(cand.id),
          };
        }
      }
      if (inserted) {
        final.push(inserted);
        placed.add(inserted.id);
      }
      const item = order[i];
      if (item && !placed.has(item.id)) {
        final.push(item);
        placed.add(item.id);
      }
    }

    // 候选限量：仅保留前 limit 条（重排/翻页保持确定性）
    return final.slice(0, limit).map((m, idx) => ({
      mediaId: m.id,
      position: idx,
      score: m.score,
      genreGroup: m.genreGroup,
    }));
  }

  /** 清空重学：清 impression/画像/快照 + 全表 score 置 0 + 刷新学习起始时间，随后按新数据重算。 */
  async reset(): Promise<void> {
    await this.db.resetRecommendationData();
    await this.setLearnResetAt(new Date().toISOString());
    await this.flushRecompute();
  }

  /** 设置页「推荐偏好」概览（轻量聚合，不读全量 media）。 */
  async getOverview(): Promise<RecommendationOverview> {
    const resetAt = await this.getLearnResetAt();
    const historyResetSql = resetAt ? ' WHERE wh.updated_at >= ?' : '';
    const searchResetSql = resetAt ? ' WHERE updated_at >= ?' : '';
    const resetParams = resetAt ? [resetAt] : [];

    const [
      historyRows,
      searchCountRow,
      impressionCountRow,
      interestRows,
      topMediaRows,
      dislikedCountRow,
      blacklistRows,
    ] = await Promise.all([
      this.db.select<any>(`${this.HISTORY_JOIN_SQL}${historyResetSql}`, resetParams),
      this.db.selectOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM search_history${searchResetSql}`,
        resetParams
      ),
      this.db.selectOne<{ count: number }>('SELECT COUNT(*) as count FROM impression'),
      this.db.select<{ tag: string; type: string; strength: number }>(
        'SELECT tag, tag_type as type, strength FROM user_interest_tag WHERE abs(strength) >= ? ORDER BY strength DESC LIMIT 10',
        [RECOMMEND_PARAMS.overviewStrengthFloor]
      ),
      this.db.select<{ id: number; title: string; score: number }>(
        'SELECT c.media_id AS id, COALESCE(m.title, \'\') AS title, c.score FROM recommend_candidates c LEFT JOIN media m ON m.id = c.media_id WHERE c.position < 10 ORDER BY c.position LIMIT 10'
      ),
      this.db.selectOne<{ count: number }>('SELECT COUNT(*) as count FROM dislike'),
      this.db.select<{ tag: string; tag_type: string; created_at: string }>(
        `SELECT tag, tag_type, COALESCE(created_at, '') AS created_at FROM interest_tag_blacklist ORDER BY created_at DESC`
      ),
    ]);

    const watchedMediaIds = Array.from(new Set(historyRows.map((r) => r.media_id)));
    const episodesByMediaAndSource = new Map<string, Map<string, EpisodeView[]>>();
    if (watchedMediaIds.length > 0) {
      const placeholders = watchedMediaIds.map(() => '?').join(',');
      const episodeRows = await this.db.select<any>(
        `SELECT media_id, source_id, season_number, episode_number, title, duration
         FROM episode WHERE media_id IN (${placeholders})`,
        watchedMediaIds
      );
      for (const r of episodeRows) {
        const src = r.source_id || '';
        let m = episodesByMediaAndSource.get(r.media_id);
        if (!m) {
          m = new Map();
          episodesByMediaAndSource.set(r.media_id, m);
        }
        let arr = m.get(src);
        if (!arr) {
          arr = [];
          m.set(src, arr);
        }
        arr.push({
          sourceId: src,
          season: r.season_number || 0,
          number: r.episode_number || 0,
          title: r.title || '',
          duration: r.duration || 0,
        });
      }
    }

    const signals = this.buildWatchSignals(historyRows, episodesByMediaAndSource, new Set(), Date.now());
    const { watchedMedia, completedMedia, giveUpMedia } = signals;

    // 子分类弃看统计（仅展示，不再参与任何打分/降权）
    let penalizedSubtypes: string[] = [];
    if (watchedMedia.size > 0) {
      const placeholders = Array.from(watchedMedia).map(() => '?').join(',');
      const mediaRows = await this.db.select<any>(
        `SELECT id, genre FROM media WHERE id IN (${placeholders})`,
        Array.from(watchedMedia)
      );
      const genreOf = new Map<string, string[]>();
      for (const row of mediaRows) genreOf.set(row.id, parseStringArray(row.genre));
      const stats = this.aggregateGenreStats(genreOf, watchedMedia, giveUpMedia, completedMedia);
      // 展示阈值：固定统计口径（仅用于设置页信息展示，不影响推荐结果）
      penalizedSubtypes = Array.from(stats.entries())
        .filter(([, s]) =>
          s.samples >= 3 &&
          s.giveUps >= 2 &&
          s.giveUps + s.completions > 0 &&
          s.giveUps / (s.giveUps + s.completions) >= 0.5
        )
        .map(([g]) => g);
    }

    return {
      completedCount: completedMedia.size,
      giveUpCount: giveUpMedia.size,
      penalizedSubtypes,
      topInterestTags: interestRows.map((r) => ({ tag: r.tag, type: r.type, strength: r.strength })),
      topMedia: topMediaRows.map((r) => ({ id: r.id, title: r.title, score: r.score })),
      searchKeywordCount: searchCountRow?.count || 0,
      impressionMediaCount: impressionCountRow?.count || 0,
      dislikedMediaCount: dislikedCountRow?.count || 0,
      blacklistedTags: blacklistRows.map((r) => ({
        tag: r.tag,
        tagType: r.tag_type as TagBlacklistItem['tagType'],
        createdAt: r.created_at,
      })),
    };
  }

  /** 查询某 media 是否已标记不感兴趣。 */
  async isDisliked(mediaId: number): Promise<boolean> {
    const row = await this.db.selectOne<{ media_id: number }>('SELECT media_id FROM dislike WHERE media_id = ?', [mediaId]);
    return !!row;
  }

  /** 切换不感兴趣：写库 + 触发热重算，返回切换后的状态。 */
  async toggleDislike(mediaId: number): Promise<boolean> {
    const disliked = await this.isDisliked(mediaId);
    if (disliked) {
      await this.db.removeDislike(mediaId);
    } else {
      await this.db.addDislike(mediaId);
    }
    this.scheduleRecompute();
    return !disliked;
  }

  /** 不感兴趣列表详情（设置页展示）。 */
  async getDislikedMedia(): Promise<DislikedMediaItem[]> {
    return this.db.getDislikedMediaDetail();
  }

  /** 兴趣标签黑名单列表。 */
  async listInterestTagBlacklist(): Promise<TagBlacklistItem[]> {
    const rows = await this.db.getInterestTagBlacklist();
    return rows.map((r) => ({
      tag: r.tag,
      tagType: r.tagType as TagBlacklistItem['tagType'],
      createdAt: r.createdAt,
    }));
  }

  /** 切换兴趣标签黑名单（先查状态再增/删），返回切换后的状态。 */
  async toggleInterestTagBlacklist(tag: string, tagType: 'genre' | 'director' | 'actor' | 'keyword'): Promise<boolean> {
    const blacklisted = await this.db.selectOne<{ tag: string }>(
      'SELECT tag FROM interest_tag_blacklist WHERE tag = ? AND tag_type = ?',
      [tag, tagType]
    );
    if (blacklisted) {
      await this.db.removeInterestTagBlacklist(tag, tagType);
    } else {
      await this.db.addInterestTagBlacklist(tag, tagType);
    }
    this.scheduleRecompute();
    return !blacklisted;
  }

  private aggregateGenreStats(
    genreOf: Map<string, string[]>,
    watchedMedia: Set<string>,
    giveUpMedia: Set<string>,
    completedMedia: Set<string>
  ): Map<string, GenreStats> {
    const stats = new Map<string, GenreStats>();
    for (const mediaId of watchedMedia) {
      for (const g of genreOf.get(mediaId) || []) {
        const s = stats.get(g) || { samples: 0, giveUps: 0, completions: 0 };
        s.samples++;
        if (giveUpMedia.has(mediaId)) s.giveUps++;
        if (completedMedia.has(mediaId)) s.completions++;
        stats.set(g, s);
      }
    }
    return stats;
  }
}
