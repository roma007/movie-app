import type { DatabaseProvider } from '../db/provider';
import type { UserUsageType } from '../types';

export interface SystemConfig {
  key: string;
  value: string;
  valueType: 'string' | 'number' | 'json';
  remark?: string;
}

export interface CollectConfig {
  minYear: number;
  blacklistKeywords: string[];
  rateLimitPerSecond: number;
  retryTimes: number;
  pageSize: number;
  maxPages: number;
  incrementalMaxPages: number;
  concurrency: number;
}

export interface ShortDramaConfig {
  summaryPatterns: string[];
  durationThresholdMinutes: number;
  metaKeywords: string[];
  probeEpisodeCount: number;
}

const DEFAULT_SHORT_DRAMA_CONFIG: ShortDramaConfig = {
  summaryPatterns: [
    '{N}分钟',
    '{N}min',
    '{N}-{N}分钟',
  ],
  durationThresholdMinutes: 30,
  metaKeywords: [
    '短剧', '微短剧', '竖屏', '短劇', '微短劇', '竪屏',
    '竖屏短剧', '竖屏剧', '短剧集', '竪屏短劇', '微短劇',
    '系统', '重生', '穿越', '仙帝', '神级', '全服', '全民',
    '末世', '诡异', '觉醒', '转职', '签到', '无敌', '最强',
    '大佬', '逆袭', '赘婿', '神医', '战神', '兵王', '仙尊',
    '魔尊', '妖尊', '奶爸', '弃少', '狂婿', '龙婿', '医神',
    '药王', '厨神', '仙医', '毒医', '透视', '鉴宝', '赌石',
    '风水', '盗墓', '探险', '寻宝', '秘境', '禁地', '深渊',
    '位面', '化龙', '成神', '成圣', '成魔', '逆天', '绝世',
    '万古', '不朽', '永恒', '至尊', '诸天', '万界', '太古',
    '洪荒', '穿越时空', '穿越成', '回到', '重生之', '重生后',
    '重生为', '末世之', '全球', '玄幻', '修仙', '开局', '终结',
  ],
  probeEpisodeCount: 8,
};

const DEFAULT_COLLECT_CONFIG: CollectConfig = {
  minYear: 2025,
  blacklistKeywords: [
    // 体育类
    '足球', '篮球', '排球', '网球', '羽毛球', '乒乓球', '橄榄球', '棒球',
    '高尔夫', '斯诺克', '台球', '体育', '运动', '赛事', '比赛', '决赛',
    '半决赛', '世界杯', '联赛', '锦标赛', '奥运', '奥运会',
    // 预告/花絮类
    '预告片', '预告', '先行预告', '前瞻', '幕后花絮', '花絮',
    '特辑', '纪录片预告', '预告版', '预告篇',
    // 成人内容
    '里番', '里番动漫', '伦理片', '情色', '成人',
  ],
  rateLimitPerSecond: 2,
  retryTimes: 3,
  pageSize: 20,
  maxPages: 100,
  incrementalMaxPages: 100,
  concurrency: 6,
};

const CONFIG_REMARKS: Record<string, string> = {
  'collect.minYear': '最小年份过滤（低于此年份的内容将被跳过）',
  'collect.blacklistKeywords': '黑名单关键词（采集时会过滤包含这些关键词的内容）',
  'collect.rateLimitPerSecond': '采集请求速率限制（每秒请求数）',
  'collect.retryTimes': '采集失败重试次数',
  'collect.pageSize': '每页大小',
  'collect.maxPages': '全量采集最大页数',
  'collect.incrementalMaxPages': '增量采集最大页数',
  'collect.concurrency': '并发处理数量',
};

export class SystemConfigService {
  constructor(private db: DatabaseProvider) {}

  async getNumber(key: string, defaultValue: number): Promise<number> {
    const row = await this.db.selectOne<{ value: string }>(
      'SELECT value FROM system_config WHERE key = ?',
      [key]
    );
    if (row) {
      const num = parseFloat(row.value);
      return isNaN(num) ? defaultValue : num;
    }
    return defaultValue;
  }

  async getString(key: string, defaultValue: string): Promise<string> {
    const row = await this.db.selectOne<{ value: string }>(
      'SELECT value FROM system_config WHERE key = ?',
      [key]
    );
    return row?.value || defaultValue;
  }

  async getJSON<T>(key: string, defaultValue: T): Promise<T> {
    const row = await this.db.selectOne<{ value: string }>(
      'SELECT value FROM system_config WHERE key = ?',
      [key]
    );
    if (row) {
      try {
        return JSON.parse(row.value) as T;
      } catch {
        return defaultValue;
      }
    }
    return defaultValue;
  }

  async setNumber(key: string, value: number): Promise<void> {
    const now = new Date().toISOString();
    await this.db.execute(
      `INSERT INTO system_config (key, value, value_type, remark, created_at, updated_at)
       VALUES (?, ?, 'number', ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
      [key, String(value), CONFIG_REMARKS[key], now, now]
    );
  }

  async setString(key: string, value: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.execute(
      `INSERT INTO system_config (key, value, value_type, remark, created_at, updated_at)
       VALUES (?, ?, 'string', ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
      [key, value, CONFIG_REMARKS[key], now, now]
    );
  }

  async setJSON(key: string, value: any): Promise<void> {
    const now = new Date().toISOString();
    await this.db.execute(
      `INSERT INTO system_config (key, value, value_type, remark, created_at, updated_at)
       VALUES (?, ?, 'json', ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
      [key, JSON.stringify(value), CONFIG_REMARKS[key], now, now]
    );
  }

  async getCollectConfig(): Promise<CollectConfig> {
    return {
      minYear: await this.getNumber('collect.minYear', DEFAULT_COLLECT_CONFIG.minYear),
      blacklistKeywords: await this.getJSON<string[]>('collect.blacklistKeywords', DEFAULT_COLLECT_CONFIG.blacklistKeywords),
      rateLimitPerSecond: await this.getNumber('collect.rateLimitPerSecond', DEFAULT_COLLECT_CONFIG.rateLimitPerSecond),
      retryTimes: await this.getNumber('collect.retryTimes', DEFAULT_COLLECT_CONFIG.retryTimes),
      pageSize: await this.getNumber('collect.pageSize', DEFAULT_COLLECT_CONFIG.pageSize),
      maxPages: await this.getNumber('collect.maxPages', DEFAULT_COLLECT_CONFIG.maxPages),
      incrementalMaxPages: await this.getNumber('collect.incrementalMaxPages', DEFAULT_COLLECT_CONFIG.incrementalMaxPages),
      concurrency: await this.getNumber('collect.concurrency', DEFAULT_COLLECT_CONFIG.concurrency),
    };
  }

  async setCollectConfig(config: Partial<CollectConfig>): Promise<void> {
    for (const [key, value] of Object.entries(config)) {
      const fullKey = `collect.${key}`;
      if (key === 'blacklistKeywords') {
        await this.setJSON(fullKey, value);
      } else {
        await this.setNumber(fullKey, value as number);
      }
    }
  }

  async getAllConfigs(): Promise<SystemConfig[]> {
    const rows = await this.db.select<SystemConfig>(
      'SELECT key, value, value_type as valueType, remark FROM system_config ORDER BY key'
    );
    return rows;
  }

  async deleteConfig(key: string): Promise<void> {
    await this.db.execute('DELETE FROM system_config WHERE key = ?', [key]);
  }

  async getShortDramaConfig(): Promise<ShortDramaConfig> {
    const stored = await this.getJSON<Partial<ShortDramaConfig>>('shortDrama.config', {});
    return {
      summaryPatterns: stored.summaryPatterns ?? DEFAULT_SHORT_DRAMA_CONFIG.summaryPatterns,
      durationThresholdMinutes: stored.durationThresholdMinutes ?? DEFAULT_SHORT_DRAMA_CONFIG.durationThresholdMinutes,
      metaKeywords: stored.metaKeywords ?? DEFAULT_SHORT_DRAMA_CONFIG.metaKeywords,
      probeEpisodeCount: stored.probeEpisodeCount ?? DEFAULT_SHORT_DRAMA_CONFIG.probeEpisodeCount,
    };
  }

  async setShortDramaConfig(config: Partial<ShortDramaConfig>): Promise<void> {
    const current = await this.getShortDramaConfig();
    const merged = { ...current, ...config };
    await this.setJSON('shortDrama.config', merged);
  }

  static getDefaultShortDramaConfig(): ShortDramaConfig {
    return { ...DEFAULT_SHORT_DRAMA_CONFIG };
  }

  async getUserUsageTypes(): Promise<UserUsageType[]> {
    const stored = await this.getJSON<UserUsageType[]>('user.usageType', []);
    if (Array.isArray(stored) && stored.length > 0) {
      return stored.filter((t) => t === 'SEARCH_FIRST' || t === 'NEW_MOVIES' || t === 'TV_SERIES');
    }
    return ['SEARCH_FIRST'];
  }

  async setUserUsageTypes(types: UserUsageType[]): Promise<void> {
    const valid = types.filter((t) => t === 'SEARCH_FIRST' || t === 'NEW_MOVIES' || t === 'TV_SERIES');
    await this.setJSON('user.usageType', valid.length > 0 ? valid : ['SEARCH_FIRST']);
  }
}
