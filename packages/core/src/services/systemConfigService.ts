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
  rateLimitPerSecond: number;
  retryTimes: number;
  pageSize: number;
  maxPages: number;
  incrementalMaxPages: number;
  maxIncrementalHours: number;
  concurrency: number;
  autoEnabled: boolean;
  autoIntervalHours: number;
  autoOnStartup: boolean;
  autoLastRunAt: string | null;
}

export interface PlaybackConfig {
  outroThresholdMinutes: number;
  showNextEpisodeOverlay: boolean;
  prefetchConcurrency: number;
  miniPlayerEnabled: boolean;
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
    '竖屏短剧', '竖屏剧', '短剧集', '竪屏短劇',
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
  rateLimitPerSecond: 2,
  retryTimes: 3,
  pageSize: 20,
  maxPages: 100,
  incrementalMaxPages: 100,
  maxIncrementalHours: 720,
  concurrency: 6,
  autoEnabled: false,
  autoIntervalHours: 24,
  autoOnStartup: false,
  autoLastRunAt: null,
};

const CONFIG_REMARKS: Record<string, string> = {
  'collect.minYear': '最小年份过滤（低于此年份的内容将被跳过）',
  'collect.rateLimitPerSecond': '采集请求速率限制（每秒请求数）',
  'collect.retryTimes': '采集失败重试次数',
  'collect.pageSize': '每页大小',
  'collect.maxPages': '全量采集最大页数',
  'collect.incrementalMaxPages': '增量采集最大页数',
  'collect.maxIncrementalHours': '增量最大追溯时间（小时）',
  'collect.concurrency': '并发处理数量',
  'collect.autoEnabled': '自动增量采集开关',
  'collect.autoIntervalHours': '自动增量采集间隔（小时）',
  'collect.autoOnStartup': '启动时自动增量采集',
  'collect.autoLastRunAt': '上次自动增量采集时间',
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
      rateLimitPerSecond: await this.getNumber('collect.rateLimitPerSecond', DEFAULT_COLLECT_CONFIG.rateLimitPerSecond),
      retryTimes: await this.getNumber('collect.retryTimes', DEFAULT_COLLECT_CONFIG.retryTimes),
      pageSize: await this.getNumber('collect.pageSize', DEFAULT_COLLECT_CONFIG.pageSize),
      maxPages: await this.getNumber('collect.maxPages', DEFAULT_COLLECT_CONFIG.maxPages),
      incrementalMaxPages: await this.getNumber('collect.incrementalMaxPages', DEFAULT_COLLECT_CONFIG.incrementalMaxPages),
      maxIncrementalHours: await this.getNumber('collect.maxIncrementalHours', DEFAULT_COLLECT_CONFIG.maxIncrementalHours),
      concurrency: await this.getNumber('collect.concurrency', DEFAULT_COLLECT_CONFIG.concurrency),
      autoEnabled: (await this.getNumber('collect.autoEnabled', DEFAULT_COLLECT_CONFIG.autoEnabled ? 1 : 0)) === 1,
      autoIntervalHours: await this.getNumber('collect.autoIntervalHours', DEFAULT_COLLECT_CONFIG.autoIntervalHours),
      autoOnStartup: (await this.getNumber('collect.autoOnStartup', DEFAULT_COLLECT_CONFIG.autoOnStartup ? 1 : 0)) === 1,
      autoLastRunAt: await this.getString('collect.autoLastRunAt', DEFAULT_COLLECT_CONFIG.autoLastRunAt || '') || null,
    };
  }

  async setCollectConfig(config: Partial<CollectConfig>): Promise<void> {
    for (const [key, value] of Object.entries(config)) {
      const fullKey = `collect.${key}`;
      if (key === 'autoEnabled' || key === 'autoOnStartup') {
        await this.setNumber(fullKey, value ? 1 : 0);
      } else if (key === 'autoLastRunAt') {
        await this.setString(fullKey, value ? String(value) : '');
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
      metaKeywords: [...new Set(stored.metaKeywords ?? DEFAULT_SHORT_DRAMA_CONFIG.metaKeywords)],
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

  async getPlaybackConfig(): Promise<PlaybackConfig> {
    return {
      outroThresholdMinutes: await this.getNumber('playback.outroThresholdMinutes', 10),
      showNextEpisodeOverlay: await this.getJSON<boolean>('playback.showNextEpisodeOverlay', true),
      prefetchConcurrency: await this.getNumber('playback.prefetchConcurrency', 3),
      miniPlayerEnabled: await this.getJSON<boolean>('playback.miniPlayerEnabled', true),
    };
  }

  async setPlaybackConfig(config: Partial<PlaybackConfig>): Promise<void> {
    if (config.outroThresholdMinutes !== undefined) {
      await this.setNumber('playback.outroThresholdMinutes', config.outroThresholdMinutes);
    }
    if (config.showNextEpisodeOverlay !== undefined) {
      await this.setJSON('playback.showNextEpisodeOverlay', config.showNextEpisodeOverlay);
    }
    if (config.prefetchConcurrency !== undefined) {
      await this.setNumber('playback.prefetchConcurrency', config.prefetchConcurrency);
    }
    if (config.miniPlayerEnabled !== undefined) {
      await this.setJSON('playback.miniPlayerEnabled', config.miniPlayerEnabled);
    }
  }

  async getGuideShown(): Promise<boolean> {
    return this.getJSON<boolean>('user.guideShown', false);
  }

  async setGuideShown(): Promise<void> {
    await this.setJSON('user.guideShown', true);
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
