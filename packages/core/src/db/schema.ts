/**
 * 将含 BEGIN...END 触发器体的 SQL 源串拆分为单条语句。
 * naive split(';') 会把触发器体内的 INSERT 分号误判为语句边界，故按
 * BEGIN/END 嵌套深度分组：仅当深度回到 0 且该行以 ';' 结尾时切分。
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
    if (depth <= 0 && t.endsWith(';')) {
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
`;

/**
 * 插入默认视频源（两端共享逻辑，调用方需自行执行 SQL）
 */
export const INSERT_DEFAULT_SOURCE_SQL = `INSERT INTO video_source (id, code, name, base_url, type, is_enabled, rate_limit, created_at) VALUES (?, ?, ?, ?, 'CMS', 1, ?, ?)`;
export const COUNT_VIDEO_SOURCE_SQL = 'SELECT COUNT(*) as count FROM video_source';
