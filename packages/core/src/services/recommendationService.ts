import type { DatabaseProvider } from '../db/provider';

/**
 * 「越看越懂你」抖音式推荐服务（v3）。
 *
 * 原理：从应用自身数据（watch_history / favorite / impression / search_history）
 * 全量重算用户兴趣标签画像 user_interest_tag，再对全量 media 按「直接信号 +
 * 兴趣匹配」打分，经「已看剔除 → 已看抑制 → 子分类降权 → 贪心打散 → 探索插槽」生成最终推荐序，
 * 原子落库到 recommend_snapshot，列表按快照 position 分页。
 * 重算幂等：任何时刻都能从原始数据恢复同一结果，可随时清空重学。
 *
 * 完播定义（v3 多源修订）：作品完播 = 看完「用户实际使用主源」的当前最新一集。
 *   - 主源 = 该 media 观看记录中 episode 所属 source 记录数最多的源（源内集号自洽，规避跨源错位）
 *   - 目标集 = 主源内 max(season, episode_number)，title 含预告/花絮等噪声则降级到次大集
 *   - 连载剧：追到最新 = 完播；完结剧：看完结局 = 完播
 *   - 跨源观看（非主源记录）仅计「看过」，不参与目标集/完播判定
 *   - 追多集 = 主源内去重后的单集完播数（修复跨源同集重复计数）
 *
 * 打分规则（抖音式多目标 × 时间衰减 × 置信度收缩）：
 *   直接信号：完播(按时长分档) / 追多集 +5 / 收藏 +20 / 弃看 -10 / 展示未点开 -5(封顶 -10)
 *   兴趣匹配：media 标签(genre/director/actor)命中用户兴趣强度累加，单部封顶 ±60，
 *             负向标签按 negMult 弱化；搜索关键词标签文本命中计入
 *   已看抑制：最近 recentWindowDays 天看过的正分 × recentFactor
 *   子分类降权：点开即弃率过高的子分类整部 -15
 *   续季关联：已消费 series_group 的后续季 +seriesContinueBoost
 *   重排：排序(确定性抖动) → 主 genre 贪心打散(连续≤dispersionMaxConsecutive) → 每 explore 比例插探索位
 */

export const LEARN_RESET_KEY = 'recommend.learnResetAt';

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

function jitter(id: string): number {
  return ((hashString(id) % 100) / 100) * RECOMMEND_PARAMS.jitterStrength;
}

/** 完播分值按时长分档：短剧单集 +8、常规剧集/短电影 +10、长电影 +12。 */
function scoreForComplete(duration: number): number {
  if (duration < 45 * 60) return RECOMMEND_PARAMS.completeScoreShort;
  if (duration < 2 * 60 * 60) return RECOMMEND_PARAMS.completeScoreNormal;
  return RECOMMEND_PARAMS.completeScoreLong;
}

export const RECOMMEND_PARAMS = {
  completeThreshold: 0.9,
  giveUpThreshold: 0.3,
  bingeEpisodeCount: 3,
  impressionThreshold: 3,
  impressionPenalty: -5,
  impressionPenaltyCap: 2,
  completeScoreShort: 8,
  completeScoreNormal: 10,
  completeScoreLong: 12,
  bingeScore: 5,
  favoriteScore: 20,
  giveUpScore: -10,
  searchBonus: 3,
  subtypePenalty: -15,
  subtypeMinSamples: 5,
  subtypeMinGiveUps: 2,
  subtypeGiveUpRate: 0.6,
  /** 坏源豁免窗口：last_fail_at 在窗口内即视为坏源，弃看样本豁免。 */
  badSourceWindowMs: 24 * 60 * 60 * 1000,
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
} as const;

export interface RecommendationOverview {
  completedCount: number;
  giveUpCount: number;
  penalizedSubtypes: string[];
  topInterestTags: { tag: string; type: string; strength: number }[];
  /** 当前 personal_score 最高的影片（为你推荐靠前）。 */
  topMedia: { id: string; title: string; score: number }[];
  searchKeywordCount: number;
  impressionMediaCount: number;
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

export class RecommendationService {
  constructor(private db: DatabaseProvider) {}

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

  /** 读取重学时间点（无则为 null）。 */
  async getResetAt(): Promise<string | null> {
    return this.getLearnResetAt();
  }

  private scheduleTimer: ReturnType<typeof setTimeout> | null = null;
  private recomputeChain: Promise<number> = Promise.resolve(0);

  /**
   * 事件触发重算入口：合并 10 秒内的多次事件为一次全量重算，
   * 且与已执行中的重算串行，避免并发写冲突。空闲兜底按 60 秒执行。
   */
  scheduleRecompute(delayMs = 10000): void {
    if (this.scheduleTimer) clearTimeout(this.scheduleTimer);
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
      genres: parseStringArray(row.genre),
      directors: parseStringArray(row.director),
      actors: actors.slice(0, RECOMMEND_PARAMS.castTagMaxPerMedia),
    };
  }

  private readonly HISTORY_JOIN_SQL = `
    SELECT wh.media_id, wh.episode_id, wh.progress AS progress, wh.duration AS duration, wh.updated_at,
           e.source_id, e.season_number, e.episode_number, e.title AS ep_title, e.duration AS ep_duration
    FROM watch_history wh LEFT JOIN episode e ON e.id = wh.episode_id`;

  /**
   * 全量重算：构建兴趣画像 → 全量打分 → 重排 → 落库快照/画像。
   * 返回本次发生变化的 media 数。幂等。
   */
  async recomputeAll(): Promise<number> {
    const resetAt = await this.getLearnResetAt();
    const historyResetSql = resetAt ? ' WHERE wh.updated_at >= ?' : '';
    const searchResetSql = resetAt ? ' WHERE updated_at >= ?' : '';
    const resetParams = resetAt ? [resetAt] : [];
    // 收藏按收藏时间过滤：真重置时，重置前收藏同样不再参与学习
    const favoriteResetSql = resetAt ? ' WHERE created_at >= ?' : '';

    const [historyRows, favoriteRows, impressionRows, searchRows, badSourceRows] = await Promise.all([
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
      this.db.select<any>(
        `SELECT e.media_id, ps.last_fail_at
         FROM play_source ps
         JOIN episode e ON e.id = ps.episode_id
         WHERE ps.fail_count > 0 AND ps.last_fail_at IS NOT NULL`
      ),
    ]);

    const now = Date.now();
    const exemptMedia = new Set<string>();
    for (const row of badSourceRows) {
      const t = new Date(row.last_fail_at).getTime();
      if (!isNaN(t) && now - t <= RECOMMEND_PARAMS.badSourceWindowMs) {
        exemptMedia.add(row.media_id);
      }
    }

    const favorites = new Set(favoriteRows.map((r) => r.media_id));
    const favoriteAt = new Map<string, string>();
    for (const r of favoriteRows) favoriteAt.set(r.media_id, r.created_at);
    const impressions = new Map<string, number>();
    const impressionAt = new Map<string, string>();
    for (const r of impressionRows) {
      impressions.set(r.media_id, r.shown_count || 0);
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

    // —— 观看信号（v3 主源内完播口径） ——
    const signals = this.buildWatchSignals(historyRows, episodesByMediaAndSource, exemptMedia, now);
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

    // —— 加载全量非隐藏 media ——
    const mediaRows = await this.db.select<any>(
      `SELECT id, title, original_title, alias, genre, director, "cast", hidden, updated_at, personal_score,
              series_group, series_season
       FROM media WHERE (hidden IS NULL OR hidden = 0)`
    );

    const tagsOf = new Map<string, MediaTags>();
    const genreOf = new Map<string, string[]>();
    for (const row of mediaRows) {
      const tags = this.parseTags(row);
      tagsOf.set(row.id, tags);
      genreOf.set(row.id, tags.genres);
    }

    // —— 子分类降权（类级负信号） ——
    const genreStats = this.aggregateGenreStats(genreOf, watchedMedia, giveUpMedia, completedMedia);
    const penalized = new Set<string>();
    for (const [g, s] of genreStats) {
      if (
        s.samples >= RECOMMEND_PARAMS.subtypeMinSamples &&
        s.giveUps >= RECOMMEND_PARAMS.subtypeMinGiveUps &&
        s.giveUps + s.completions > 0 &&
        s.giveUps / (s.giveUps + s.completions) >= RECOMMEND_PARAMS.subtypeGiveUpRate
      ) {
        penalized.add(g);
      }
    }

    // —— 续季关联：已消费（作品完播/追多集/收藏）series_group 的最大 season ——
    const consumed = new Set<string>(completedMedia);
    for (const [mediaId, n] of bingeCount) {
      if (n >= RECOMMEND_PARAMS.bingeEpisodeCount) consumed.add(mediaId);
    }
    for (const id of favorites) consumed.add(id);
    const watchedSeriesMaxSeason = new Map<string, number>();
    for (const row of mediaRows) {
      if (!row.series_group || !consumed.has(row.id)) continue;
      const season = row.series_season ?? 0;
      const cur = watchedSeriesMaxSeason.get(row.series_group) ?? -1;
      if (season > cur) watchedSeriesMaxSeason.set(row.series_group, season);
    }

    // —— 构建用户兴趣画像 ——
    const interest = this.buildUserInterestTags({
      tagsOf,
      watchedMedia,
      completedMedia,
      completedDuration: signals.completedDuration,
      bingeCount,
      giveUpMedia,
      favorites,
      impressions,
      latest,
      favoriteAt,
      impressionAt,
      searchRows,
      now,
    });

    // —— 全量打分 ——
    const keywordStrengths = new Map<string, number>();
    for (const it of interest.values()) {
      if (it.type === 'keyword' && it.strength !== 0) keywordStrengths.set(it.tag, it.strength);
    }

    const scores = new Map<string, ScoreEntry>();
    const updates: { id: string; score: number }[] = [];
    for (const row of mediaRows) {
      const tags = tagsOf.get(row.id)!;
      const total = this.computeMediaScore({
        row,
        tags,
        interest,
        keywordStrengths,
        penalized,
        watchedMedia,
        completedMedia,
        completedDuration: signals.completedDuration,
        bingeCount,
        giveUpMedia,
        favorites,
        impressions,
        recentWatched,
        watchedSeriesMaxSeason,
      });
      scores.set(row.id, {
        total,
        updatedAt: row.updated_at || '',
        genreGroup: tags.genres[0] || UNKNOWN_GENRE,
      });
      const old = row.personal_score ?? 0;
      if (old !== total) updates.push({ id: row.id, score: total });
    }

    // 批量回写 personal_score：每 200 条拼一条 UPDATE（内联值，避免逐条 IPC 与参数上限）
    const BATCH = 200;
    for (let i = 0; i < updates.length; i += BATCH) {
      const chunk = updates.slice(i, i + BATCH);
      const esc = (s: string) => s.replace(/'/g, "''");
      const caseSql = chunk.map((u) => `WHEN id = '${esc(u.id)}' THEN ${u.score}`).join(' ');
      const idsSql = chunk.map((u) => `'${esc(u.id)}'`).join(', ');
      await this.db.execute(
        `UPDATE media SET personal_score = CASE ${caseSql} ELSE personal_score END WHERE id IN (${idsSql})`,
        []
      );
    }

    // —— 落库兴趣画像 ——
    const interestRows = Array.from(interest.values())
      .filter((it) => Math.abs(it.strength) > 0.0001)
      .map((it) => ({
        tag: it.tag,
        tagType: it.type,
        strength: Math.round(it.strength * 100) / 100,
        sampleCount: it.n,
        updatedAt: it.updatedAt,
      }));
    await this.db.replaceUserInterestTags(interestRows);

    // —— 生成并落库推荐快照 ——
    const hasSignal =
      Array.from(interest.values()).some((it) => Math.abs(it.strength) > 0.0001) ||
      Array.from(scores.values()).some((s) => s.total !== 0);
    if (hasSignal) {
      const snapshotRows = this.reorder(scores, mediaRows, watchedMedia, favorites, excludedCompleted);
      await this.db.replaceRecommendationSnapshot(snapshotRows);
    } else {
      await this.db.replaceRecommendationSnapshot([]);
    }

    return updates.length;
  }

  /**
   * v3 完播口径：主源内对齐。
   * 主源 = 观看记录中 episode 所属 source 记录数最多的源；目标集 = 主源内 max(season, number)（噪声降级）。
   * 作品完播 = 目标集进度比 ≥ completeThreshold；无 episode（电影）兜底任一记录完播。
   */
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
    giveUpMedia: Set<string>;
    favorites: Set<string>;
    impressions: Map<string, number>;
    latest: Map<string, { progress: number; duration: number; at: string }>;
    favoriteAt: Map<string, string>;
    impressionAt: Map<string, string>;
    searchRows: any[];
    now: number;
  }): Map<string, InterestTag> {
    const {
      tagsOf, watchedMedia, completedMedia, completedDuration, bingeCount, giveUpMedia,
      favorites, impressions, latest, favoriteAt, impressionAt, searchRows, now,
    } = params;

    const interest = new Map<string, InterestTag>();
    const keyOf = (type: string, tag: string) => `${type}\u0000${tag}`;

    const addSignal = (tag: string, type: 'genre' | 'director' | 'actor', value: number, at: string) => {
      const k = keyOf(type, tag);
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
    const signalMedia = new Set<string>(watchedMedia);
    for (const id of favorites) signalMedia.add(id);
    for (const [id, shown] of impressions) {
      if (shown >= RECOMMEND_PARAMS.impressionThreshold && !watchedMedia.has(id)) signalMedia.add(id);
    }

    for (const mediaId of signalMedia) {
      const tags = tagsOf.get(mediaId);
      if (!tags) continue;
      let sig = 0;
      if (completedMedia.has(mediaId)) sig += scoreForComplete(completedDuration.get(mediaId) || 0);
      if ((bingeCount.get(mediaId) || 0) >= RECOMMEND_PARAMS.bingeEpisodeCount) {
        sig += RECOMMEND_PARAMS.bingeScore;
      }
      if (favorites.has(mediaId)) sig += RECOMMEND_PARAMS.favoriteScore;
      if (giveUpMedia.has(mediaId)) sig += RECOMMEND_PARAMS.giveUpScore;
      const shown = impressions.get(mediaId) || 0;
      if (shown >= RECOMMEND_PARAMS.impressionThreshold && !watchedMedia.has(mediaId)) {
        sig +=
          RECOMMEND_PARAMS.impressionPenalty *
          Math.min(RECOMMEND_PARAMS.impressionPenaltyCap, Math.floor(shown / RECOMMEND_PARAMS.impressionThreshold));
      }
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

    // 搜索关键词 → keyword 标签（count 作置信度样本，不累加强度）
    for (const r of searchRows) {
      const kw = String(r.keyword || '').trim();
      if (!kw) continue;
      const at = r.updated_at || '';
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
    penalized: Set<string>;
    watchedMedia: Set<string>;
    completedMedia: Set<string>;
    completedDuration: Map<string, number>;
    bingeCount: Map<string, number>;
    giveUpMedia: Set<string>;
    favorites: Set<string>;
    impressions: Map<string, number>;
    recentWatched: Set<string>;
    watchedSeriesMaxSeason: Map<string, number>;
  }): number {
    const {
      row, tags, interest, keywordStrengths, penalized, watchedMedia,
      completedMedia, completedDuration, bingeCount, giveUpMedia, favorites, impressions,
      recentWatched, watchedSeriesMaxSeason,
    } = params;

    // —— 直接信号 ——
    let direct = 0;
    if (completedMedia.has(row.id)) direct += scoreForComplete(completedDuration.get(row.id) || 0);
    if ((bingeCount.get(row.id) || 0) >= RECOMMEND_PARAMS.bingeEpisodeCount) {
      direct += RECOMMEND_PARAMS.bingeScore;
    }
    if (favorites.has(row.id)) direct += RECOMMEND_PARAMS.favoriteScore;
    if (giveUpMedia.has(row.id)) direct += RECOMMEND_PARAMS.giveUpScore;
    const shown = impressions.get(row.id) || 0;
    if (shown >= RECOMMEND_PARAMS.impressionThreshold && !watchedMedia.has(row.id)) {
      direct +=
        RECOMMEND_PARAMS.impressionPenalty *
        Math.min(RECOMMEND_PARAMS.impressionPenaltyCap, Math.floor(shown / RECOMMEND_PARAMS.impressionThreshold));
    }

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

    // —— 合成：已看抑制（只压正分）→ 子分类降权 → 续季关联 ——
    let base = direct + match;
    if (base > 0 && recentWatched.has(row.id)) base *= RECOMMEND_PARAMS.recentFactor;
    let total = Math.round(base);
    if (tags.genres.some((g) => penalized.has(g))) total += RECOMMEND_PARAMS.subtypePenalty;
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
   * 重排：已看剔除 → 排序(确定性抖动) → 主 genre 贪心打散 → 探索插槽（去重）→ 位置编号。
   * 纯函数、确定性：翻页/返回可稳定还原。
   */
  private reorder(
    scores: Map<string, ScoreEntry>,
    mediaRows: any[],
    watchedMedia: Set<string>,
    favorites: Set<string>,
    excludedCompleted: Set<string>
  ): { mediaId: string; position: number; score: number; genreGroup: string }[] {
    interface Item {
      id: string;
      score: number;
      updatedAt: string;
      genreGroup: string;
    }
    const UNKNOWN = UNKNOWN_GENRE;

    const list: Item[] = mediaRows
      .filter((r) => !excludedCompleted.has(r.id))
      .map((r) => {
        const s = scores.get(r.id)!;
        return { id: r.id, score: s.total, updatedAt: s.updatedAt, genreGroup: s.genreGroup || UNKNOWN };
      });

    // 预排序：(total+jitter DESC, updated_at DESC, id ASC) —— 确定性（jitter 由 id 派生，恒定）
    list.sort(
      (a, b) =>
        b.score + jitter(b.id) - (a.score + jitter(a.id)) ||
        (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );

    // 贪心打散：每次取剩余数量最多的桶，同类连续达上限则排除该桶
    const buckets = new Map<string, Item[]>();
    for (const m of list) {
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
    let lastCount = 0;
    while (order.length < list.length) {
      const cand = Array.from(buckets.entries()).filter(([, arr]) => arr.length > 0);
      let usable = cand;
      if (lastGenre !== null && lastCount >= maxConsec) {
        const rest = cand.filter(([g]) => g !== lastGenre);
        if (rest.length > 0) usable = rest;
      }
      usable.sort(
        (a, b) =>
          b[1].length - a[1].length ||
          b[1][0].score + jitter(b[1][0].id) - (a[1][0].score + jitter(a[1][0].id)) ||
          (a[1][0].id < b[1][0].id ? -1 : a[1][0].id > b[1][0].id ? 1 : 0)
      );
      const [g, arr] = usable[0];
      const item = arr.shift()!;
      order.push(item);
      if (g === lastGenre) lastCount++;
      else {
        lastGenre = g;
        lastCount = 1;
      }
    }

    // 探索池：未互动且 total==0，按 (updated_at DESC, id ASC) —— 新片天然在池头（U3 整合：探索位优先新内容）
    const explorePool = mediaRows
      .filter((r) => !watchedMedia.has(r.id) && !favorites.has(r.id) && (scores.get(r.id)?.total ?? 0) === 0)
      .sort(
        (a, b) =>
          (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      );

    // 探索插槽：每 exploreRatio 间隔插入一个未占用探索候选；占用过的 media 从 exploit 序中跳过（去重）
    const step = Math.max(2, Math.round(1 / RECOMMEND_PARAMS.exploreRatio));
    const placed = new Set<string>();
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
          inserted = { id: cand.id, score: s.total, updatedAt: s.updatedAt, genreGroup: s.genreGroup || UNKNOWN };
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

    return final.map((m, idx) => ({ mediaId: m.id, position: idx, score: m.score, genreGroup: m.genreGroup }));
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

    const [historyRows, searchCountRow, impressionCountRow, interestRows, topMediaRows] = await Promise.all([
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
      this.db.select<{ id: string; title: string; personal_score: number }>(
        'SELECT id, title, personal_score FROM media WHERE personal_score > 0 AND (hidden IS NULL OR hidden = 0) ORDER BY personal_score DESC, updated_at DESC LIMIT 10'
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
      penalizedSubtypes = Array.from(stats.entries())
        .filter(([, s]) =>
          s.samples >= RECOMMEND_PARAMS.subtypeMinSamples &&
          s.giveUps >= RECOMMEND_PARAMS.subtypeMinGiveUps &&
          s.giveUps + s.completions > 0 &&
          s.giveUps / (s.giveUps + s.completions) >= RECOMMEND_PARAMS.subtypeGiveUpRate
        )
        .map(([g]) => g);
    }

    return {
      completedCount: completedMedia.size,
      giveUpCount: giveUpMedia.size,
      penalizedSubtypes,
      topInterestTags: interestRows.map((r) => ({ tag: r.tag, type: r.type, strength: r.strength })),
      topMedia: topMediaRows.map((r) => ({ id: r.id, title: r.title, score: r.personal_score })),
      searchKeywordCount: searchCountRow?.count || 0,
      impressionMediaCount: impressionCountRow?.count || 0,
    };
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
