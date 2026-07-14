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
    favorite_count INTEGER DEFAULT 0,
    search_count INTEGER DEFAULT 0,
    hidden INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS episode (
    id TEXT PRIMARY KEY,
    media_id TEXT NOT NULL,
    season_number INTEGER DEFAULT 1,
    episode_number INTEGER NOT NULL,
    title TEXT,
    duration INTEGER,
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
    priority INTEGER DEFAULT 0,
    health_status TEXT,
    last_check_at TEXT,
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

  CREATE TRIGGER IF NOT EXISTS media_au AFTER UPDATE ON media BEGIN
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

  CREATE INDEX IF NOT EXISTS idx_episode_media_id ON episode(media_id);
  CREATE INDEX IF NOT EXISTS idx_play_source_episode_id ON play_source(episode_id);
  CREATE INDEX IF NOT EXISTS idx_favorite_media_id ON favorite(media_id);
  CREATE INDEX IF NOT EXISTS idx_watch_history_media_id ON watch_history(media_id);
`;

/**
 * 插入默认视频源（两端共享逻辑，调用方需自行执行 SQL）
 */
export const INSERT_DEFAULT_SOURCE_SQL = `INSERT INTO video_source (id, code, name, base_url, type, is_enabled, rate_limit, priority, created_at) VALUES (?, ?, ?, ?, 'CMS', 1, ?, ?, ?)`;
export const COUNT_VIDEO_SOURCE_SQL = 'SELECT COUNT(*) as count FROM video_source';
