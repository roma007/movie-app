/**
 * 将含 BEGIN...END 触发器体的 SQL 源串拆分为单条语句。
 * naive split(';') 会把触发器体内的 INSERT 分号误判为语句边界，故按
 * BEGIN/END 嵌套深度分组：当深度回到 0 且该行以 ';' 结尾或以 END 收尾时切分。
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let buf = '';
  let depth = 0;
  for (const line of sql.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('--')) continue;
    buf += (buf ? '\n' : '') + line.trimEnd();
    const begins = (t.match(/\bBEGIN\b/g) || []).length;
    const ends = (t.match(/\bEND\b/g) || []).length;
    depth += begins - ends;
    if (depth <= 0 && (t.endsWith(';') || /^END\b/i.test(t))) {
      statements.push(buf.replace(/;\s*$/, ''));
      buf = '';
      depth = 0;
    }
  }
  if (buf.trim()) statements.push(buf.trim());
  return statements;
}

/**
 * 数据库建表 SQL（两端共享：移动端 expo-sqlite、桌面端 tauri-plugin-sql）
 * 注意：包含 PRAGMA 和所有表 + FTS5 虚拟表
 */
export const PRAGMA_SQL = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = NORMAL;
  PRAGMA cache_size = -20000;
`;

/**
 * 多设备同步：变更日志表。
 * data 列恒为 NULL（触发器只写元数据），payload 的 data 由 push 阶段现读组装（2.12/II-3）。
 */
export const CHANGE_LOG_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS change_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    device_id TEXT,
    timestamp INTEGER NOT NULL,
    synced INTEGER DEFAULT 0,
    data TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_change_log_synced ON change_log(synced);
  CREATE INDEX IF NOT EXISTS idx_change_log_table_record ON change_log(table_name, record_id);
`;

export interface SyncTriggerTableDef {
  table: string;
  /** record_id 拼接表达式，用 {prefix} 占位（NEW/OLD 由事件决定） */
  recordExpr: string;
  /** 触发器 WHEN 条件（同样支持 {prefix}），如 system_config 排除两键 */
  when?: string;
}

/**
 * 同步触发表（27 = 9 表 × 3 事件）。episode/play_source 不在其中：
 * 作为 media 子集快照随 media 变更传输（2026-09-02 决策，见 2.12 定案）。
 */
export const SYNC_TRIGGER_TABLES: SyncTriggerTableDef[] = [
  { table: 'favorite', recordExpr: '{prefix}.media_id' },
  { table: 'watch_history', recordExpr: '{prefix}.id' },
  { table: 'watch_line_progress', recordExpr: "{prefix}.media_id || ':' || {prefix}.episode_id || ':' || {prefix}.play_source_id" },
  { table: 'hidden_genre', recordExpr: '{prefix}.sub_type' },
  { table: 'dislike', recordExpr: '{prefix}.media_id' },
  { table: 'media', recordExpr: 'COALESCE({prefix}.fingerprint, {prefix}.id)' },
  { table: 'video_source', recordExpr: 'COALESCE({prefix}.code, {prefix}.id)' },
  {
    table: 'system_config',
    recordExpr: '{prefix}.key',
    when: "{prefix}.key != 'device_id' AND {prefix}.key != 'sync_config'",
  },
  { table: 'user_interest_tag', recordExpr: "{prefix}.tag || ':' || {prefix}.tag_type" },
];

/** 编程生成 27 个单一事件触发器（AFTER INSERT/UPDATE/DELETE）。 */
export function buildChangeLogTriggersSql(): string {
  const lines: string[] = [];
  for (const def of SYNC_TRIGGER_TABLES) {
    for (const evt of ['INSERT', 'UPDATE', 'DELETE'] as const) {
      const prefix = evt === 'DELETE' ? 'OLD' : 'NEW';
      const name = `${def.table}_change_log_${evt.toLowerCase()}`;
      const recordExpr = def.recordExpr.split('{prefix}').join(prefix);
      const when = def.when ? `WHEN ${def.when.split('{prefix}').join(prefix)} ` : '';
      lines.push(`CREATE TRIGGER IF NOT EXISTS ${name} AFTER ${evt} ON ${def.table} ${when}BEGIN
  INSERT INTO change_log (table_name, record_id, operation, device_id, timestamp)
  VALUES ('${def.table}', ${recordExpr}, '${evt}', (SELECT value FROM system_config WHERE key = 'device_id'), (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)));
END`);
    }
  }
  return lines.join('\n\n');
}

export function buildChangeLogTriggerDropSql(): string {
  return SYNC_TRIGGER_TABLES.flatMap((def) =>
    ['insert', 'update', 'delete'].map((e) => `DROP TRIGGER IF EXISTS ${def.table}_change_log_${e};`)
  ).join('\n');
}

export const CHANGE_LOG_TRIGGERS_SQL = buildChangeLogTriggersSql();
export const CHANGE_LOG_TRIGGER_DROP_SQL = buildChangeLogTriggerDropSql();
export const SYNC_TRIGGER_COUNT = SYNC_TRIGGER_TABLES.length * 3;

export interface SyncUpsertRule {
  /** 删除闭环业务键（deleteSyncRecord 依据） */
  recordKey: string;
  /** ON CONFLICT 目标（复合键含括号）；media→fingerprint、video_source→code，NULL 回退由 readSyncRecord/delete 兜底 */
  conflictTarget: string;
  /** 去重铁律：INSERT 前先 DELETE WHERE recordKey（如 favorite/dislike 每 media 恒一行） */
  dedupeBeforeInsert?: boolean;
}

/** 同步写入的冲突规则（两端 provider 复用，列名全部 snake_case）。 */
export const SYNC_UPSERT_RULES: Record<string, SyncUpsertRule> = {
  favorite: { recordKey: 'media_id', conflictTarget: 'id', dedupeBeforeInsert: true },
  dislike: { recordKey: 'media_id', conflictTarget: 'media_id', dedupeBeforeInsert: true },
  watch_history: { recordKey: 'id', conflictTarget: 'id' },
  watch_line_progress: { recordKey: 'media_id:episode_id:play_source_id', conflictTarget: '(media_id, episode_id, play_source_id)' },
  hidden_genre: { recordKey: 'sub_type', conflictTarget: 'sub_type' },
  user_interest_tag: { recordKey: 'tag:tag_type', conflictTarget: '(tag, tag_type)' },
  system_config: { recordKey: 'key', conflictTarget: 'key' },
  media: { recordKey: 'fingerprint', conflictTarget: 'fingerprint' },
  video_source: { recordKey: 'code', conflictTarget: 'code' },
};

/**
 * 同步写入列白名单（snake_case，远端行仅取白名单列，丢失列用建表默认值）。
 * media 排除 local 派生列 personal_score；video_source 排除本地派生列 last_collected_at（2.12 列级排除）。
 * episode/play_source 供 rebuildMediaSubtree 复用。
 */
export const SYNC_TABLE_COLUMNS: Record<string, string[]> = {
  favorite: ['id', 'media_id', 'created_at'],
  dislike: ['media_id', 'created_at'],
  watch_history: ['id', 'media_id', 'episode_id', 'progress', 'duration', 'source_id', 'play_source_id', 'updated_at'],
  watch_line_progress: ['media_id', 'episode_id', 'play_source_id', 'source_id', 'progress', 'duration', 'updated_at'],
  hidden_genre: ['sub_type', 'created_at'],
  user_interest_tag: ['tag', 'tag_type', 'strength', 'sample_count', 'updated_at'],
  system_config: ['key', 'value', 'value_type', 'remark', 'created_at', 'updated_at'],
  media: [
    'id', 'title', 'original_title', 'alias', 'type', 'year', 'area', 'genre', 'director', 'cast',
    'description', 'poster_url', 'backdrop_url', 'status', 'remarks', 'fingerprint',
    'current_episodes', 'total_episodes', 'is_short_drama', 'duration_check_status', 'episode_duration',
    'view_count', 'rating', 'rating_count', 'rating_source', 'rating_updated_at',
    'favorite_count', 'search_count', 'hidden', 'series_group', 'series_season',
    'created_at', 'updated_at',
  ],
  video_source: [
    'id', 'code', 'name', 'base_url', 'type', 'is_enabled', 'rate_limit', 'health_status',
    'last_check_at', 'last_success_at', 'avg_response_time', 'last_incremental_collected_at',
    'created_at', 'fail_count', 'total_requests',
  ],
  episode: ['id', 'media_id', 'season_number', 'episode_number', 'title', 'duration', 'source_id'],
  play_source: ['id', 'episode_id', 'source_id', 'source_name', 'url', 'quality', 'is_active', 'fail_count', 'last_fail_at'],
};

/** 按表取白名单列（按远端行内实际出现的列过滤，保持远端缺失列走表默认值）。 */
export function syncColumns(tableName: string, row: Record<string, unknown>): string[] {
  const whitelist = SYNC_TABLE_COLUMNS[tableName];
  if (!whitelist) return Object.keys(row);
  return whitelist.filter((c) => c in row);
}

/** 生成 INSERT ... ON CONFLICT (target) DO UPDATE SET（SET 自动排除冲突目标列，防止改写主键导致 FK 失效，如 media 的 DO UPDATE 绝不可 SET id）。conflictTarget 允许带或不带外层括号。 */
export function buildUpsertSql(table: string, cols: string[], conflictTarget: string): string {
  const inner = conflictTarget.trim().startsWith('(') ? conflictTarget.trim() : `(${conflictTarget.trim()})`;
  const excluded = inner.replace(/[()]/g, '').split(',').map((s) => s.trim());
  const setCols = cols.filter((c) => !excluded.includes(c));
  const values = cols.map(() => '?').join(', ');
  const setClause = setCols.map((c) => `${c} = excluded.${c}`).join(', ');
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${values}) ON CONFLICT ${inner} DO UPDATE SET ${setClause}`;
}

/** 生成纯 INSERT（去重铁律类：INSERT 前先 DELETE WHERE recordKey）。 */
export function buildInsertSql(table: string, cols: string[]): string {
  const values = cols.map(() => '?').join(', ');
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${values})`;
}

export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    original_title TEXT,
    alias TEXT,
    type TEXT NOT NULL,
    year INTEGER NOT NULL,
    area TEXT,
    genre TEXT,
    director TEXT,
    cast TEXT,
    description TEXT,
    poster_url TEXT,
    backdrop_url TEXT,
    status TEXT,
    remarks TEXT,
    fingerprint TEXT UNIQUE,
    current_episodes INTEGER,
    total_episodes INTEGER,
    is_short_drama INTEGER DEFAULT 0,
    duration_check_status TEXT,
    episode_duration INTEGER,
    view_count INTEGER DEFAULT 0,
    rating REAL,
    rating_count INTEGER,
    rating_source TEXT,
    rating_updated_at TEXT,
    favorite_count INTEGER DEFAULT 0,
    search_count INTEGER DEFAULT 0,
    hidden INTEGER DEFAULT 0,
    personal_score INTEGER DEFAULT 0,
    series_group TEXT,
    series_season INTEGER,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS impression (
    media_id TEXT PRIMARY KEY,
    shown_count INTEGER DEFAULT 1,
    first_shown_at TEXT,
    last_shown_at TEXT
  );

  CREATE TABLE IF NOT EXISTS episode (
    id TEXT PRIMARY KEY,
    media_id TEXT NOT NULL,
    season_number INTEGER DEFAULT 1,
    episode_number INTEGER NOT NULL,
    title TEXT,
    duration INTEGER,
    source_id TEXT,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS play_source (
    id TEXT PRIMARY KEY,
    episode_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_name TEXT,
    url TEXT NOT NULL,
    quality TEXT,
    is_active INTEGER DEFAULT 1,
    fail_count INTEGER DEFAULT 0,
    last_fail_at TEXT,
    FOREIGN KEY (episode_id) REFERENCES episode(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS video_source (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    type TEXT DEFAULT 'CMS',
    is_enabled INTEGER DEFAULT 1,
    rate_limit INTEGER DEFAULT 5,
    health_status TEXT,
    last_check_at TEXT,
    last_success_at TEXT,
    avg_response_time INTEGER,
    last_collected_at TEXT,
    last_incremental_collected_at TEXT,
    created_at TEXT,
    fail_count INTEGER DEFAULT 0,
    total_requests INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS favorite (
    id TEXT PRIMARY KEY,
    media_id TEXT NOT NULL,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS watch_history (
    id TEXT PRIMARY KEY,
    media_id TEXT NOT NULL,
    episode_id TEXT,
    progress INTEGER DEFAULT 0,
    duration INTEGER DEFAULT 0,
    source_id TEXT,
    play_source_id TEXT,
    updated_at TEXT
  );

  -- 按「媒体+剧集+线路（视频源）」独立记忆的播放进度，用于切换线路后续播。
  -- episode_id 采用与 watch_history 主键相同的 'movie' 哨兵约定（电影恒为 'movie'）。
  CREATE TABLE IF NOT EXISTS watch_line_progress (
    media_id TEXT NOT NULL,
    episode_id TEXT NOT NULL,
    play_source_id TEXT NOT NULL,
    source_id TEXT,
    progress INTEGER DEFAULT 0,
    duration INTEGER DEFAULT 0,
    updated_at TEXT,
    PRIMARY KEY (media_id, episode_id, play_source_id)
  );

  CREATE TABLE IF NOT EXISTS search_history (
    id TEXT PRIMARY KEY,
    keyword TEXT NOT NULL,
    count INTEGER DEFAULT 1,
    updated_at TEXT
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS media_fts USING fts5(
    title, alias, original_title, director, cast,
    content='media',
    content_rowid='rowid'
  );

  -- FTS5 外部内容表同步触发器：media 行变化时同步 media_fts 索引行。
  -- 缺失这些触发器会导致 searchMedia 的 MATCH 查询永远返回空。
  CREATE TRIGGER IF NOT EXISTS media_ai AFTER INSERT ON media BEGIN
    INSERT INTO media_fts(rowid, title, alias, original_title, director, cast)
    VALUES (new.rowid, new.title, new.alias, new.original_title, new.director, new.cast);
  END;

  CREATE TRIGGER IF NOT EXISTS media_ad AFTER DELETE ON media BEGIN
    INSERT INTO media_fts(media_fts, rowid, title, alias, original_title, director, cast)
    VALUES ('delete', old.rowid, old.title, old.alias, old.original_title, old.director, old.cast);
  END;

  -- 仅当 FTS 索引列（title/alias/original_title/director/cast）真正变化时才同步全文索引，
  -- 避免 hidden 等非索引列更新（如按子类型隐藏）触发全表 FTS 重建导致卡顿。
  CREATE TRIGGER IF NOT EXISTS media_au AFTER UPDATE ON media WHEN
    old.title IS NOT new.title OR old.alias IS NOT new.alias OR
    old.original_title IS NOT new.original_title OR
    old.director IS NOT new.director OR old.cast IS NOT new.cast
  BEGIN
    INSERT INTO media_fts(media_fts, rowid, title, alias, original_title, director, cast)
    VALUES ('delete', old.rowid, old.title, old.alias, old.original_title, old.director, old.cast);
    INSERT INTO media_fts(rowid, title, alias, original_title, director, cast)
    VALUES (new.rowid, new.title, new.alias, new.original_title, new.director, new.cast);
  END;

  CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    value_type TEXT DEFAULT 'string',
    remark TEXT,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS collection_log (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    task_id TEXT,
    source_code TEXT,
    source_name TEXT,
    details TEXT
  );

  CREATE TABLE IF NOT EXISTS hidden_genre (
    sub_type TEXT PRIMARY KEY,
    created_at TEXT
  );

  -- 「越看越懂你」用户兴趣标签画像（v2 抖音式推荐）
  CREATE TABLE IF NOT EXISTS user_interest_tag (
    tag TEXT NOT NULL,
    tag_type TEXT NOT NULL,
    strength REAL DEFAULT 0,
    sample_count INTEGER DEFAULT 0,
    updated_at TEXT,
    PRIMARY KEY (tag, tag_type)
  );

  -- 推荐快照：全量重排后的最终序（打散+探索后），列表按 position 分页
  CREATE TABLE IF NOT EXISTS recommend_snapshot (
    media_id TEXT PRIMARY KEY,
    position INTEGER,
    score INTEGER DEFAULT 0,
    genre_group TEXT
  );

  -- 用户「不感兴趣」反馈：屏蔽具体影片（打分 -10、推荐序剔除、标签画像负向）
  CREATE TABLE IF NOT EXISTS dislike (
    media_id TEXT PRIMARY KEY,
    created_at TEXT
  );

  -- 用户兴趣标签黑名单：屏蔽具体标签（genre/director/actor/keyword），画像与匹配均跳过
  CREATE TABLE IF NOT EXISTS interest_tag_blacklist (
    tag TEXT NOT NULL,
    tag_type TEXT NOT NULL,
    created_at TEXT,
    PRIMARY KEY (tag, tag_type)
  );

  CREATE INDEX IF NOT EXISTS idx_user_interest_tag_strength ON user_interest_tag(strength);
  CREATE INDEX IF NOT EXISTS idx_recommend_snapshot_position ON recommend_snapshot(position);

  CREATE INDEX IF NOT EXISTS idx_collection_log_ts ON collection_log(timestamp);
  CREATE INDEX IF NOT EXISTS idx_collection_log_task ON collection_log(task_id);

  CREATE INDEX IF NOT EXISTS idx_episode_media_id ON episode(media_id);
  CREATE INDEX IF NOT EXISTS idx_episode_source_id ON episode(source_id);
  CREATE INDEX IF NOT EXISTS idx_episode_media_season_source ON episode(media_id, season_number, source_id);
  CREATE INDEX IF NOT EXISTS idx_play_source_episode_id ON play_source(episode_id);
  CREATE INDEX IF NOT EXISTS idx_play_source_source_id_episode_id ON play_source(source_id, episode_id);
  CREATE INDEX IF NOT EXISTS idx_favorite_media_id ON favorite(media_id);
  CREATE INDEX IF NOT EXISTS idx_watch_history_media_id ON watch_history(media_id);
  CREATE INDEX IF NOT EXISTS idx_media_type ON media(type);
  CREATE INDEX IF NOT EXISTS idx_media_type_updated_at ON media(type, updated_at);
  CREATE INDEX IF NOT EXISTS idx_media_hidden ON media(hidden);
  CREATE INDEX IF NOT EXISTS idx_media_personal_score ON media(personal_score, updated_at);

  -- 推荐重算变化跟踪表：记录自上次重算以来变化的媒体ID
  CREATE TABLE IF NOT EXISTS media_change_log (
    media_id TEXT PRIMARY KEY,
    change_type TEXT NOT NULL,
    created_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_media_change_log_created_at ON media_change_log(created_at);

  -- 语音控制配置表
  CREATE TABLE IF NOT EXISTS voice_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    value_type TEXT DEFAULT 'string',
    created_at TEXT,
    updated_at TEXT
  );

  -- ============ 多设备同步（OneDrive）：change_log 表 + 27 个变更触发器 ============
  -- DROP 先于 CREATE：旧定义（WebDAV 期遗留）不会因 IF NOT EXISTS 而残留
  ${CHANGE_LOG_TRIGGER_DROP_SQL}

  ${CHANGE_LOG_TABLE_SQL}

  ${CHANGE_LOG_TRIGGERS_SQL}
`;

/**
 * 插入默认视频源（两端共享逻辑，调用方需自行执行 SQL）
 */
export const INSERT_DEFAULT_SOURCE_SQL = `INSERT INTO video_source (id, code, name, base_url, type, is_enabled, rate_limit, created_at) VALUES (?, ?, ?, ?, 'CMS', 1, ?, ?)`;
export const COUNT_VIDEO_SOURCE_SQL = 'SELECT COUNT(*) as count FROM video_source';
