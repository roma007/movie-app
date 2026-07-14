use tauri_plugin_http::init as init_http;
use tauri_plugin_sql::{Migration, MigrationKind};

/// 数据库 migrations：建表 SQL 与移动端 expo-sqlite 完全一致（两端共享 schema.ts）。
/// 注意：sqlx bundled SQLite 默认含 FTS5，media_fts 虚拟表可直接创建。
const SCHEMA_SQL: &str = r#"
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
  fingerprint TEXT UNIQUE,
  current_episodes INTEGER,
  total_episodes INTEGER,
  is_short_drama INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  favorite_count INTEGER DEFAULT 0,
  search_count INTEGER DEFAULT 0,
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
  last_check_at TEXT
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

CREATE VIRTUAL TABLE IF NOT EXISTS media_fts USING fts5(
  title, alias, original_title, director, cast,
  content='media',
  content_rowid='rowid'
);

-- FTS5 外部内容表同步触发器：media 行变化时同步 media_fts 索引行。
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
"#;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: SCHEMA_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_created_at_to_video_source",
            sql: "ALTER TABLE video_source ADD COLUMN created_at TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "create_system_config_table",
            sql: "CREATE TABLE IF NOT EXISTS system_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                value_type TEXT DEFAULT 'string',
                remark TEXT,
                created_at TEXT,
                updated_at TEXT
            );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add_play_source_fail_columns",
            sql: "ALTER TABLE play_source ADD COLUMN is_active INTEGER DEFAULT 1;
                  ALTER TABLE play_source ADD COLUMN fail_count INTEGER DEFAULT 0;
                  ALTER TABLE play_source ADD COLUMN last_fail_at TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "create_search_history_table",
            sql: "CREATE TABLE IF NOT EXISTS search_history (
                id TEXT PRIMARY KEY,
                keyword TEXT NOT NULL,
                count INTEGER DEFAULT 1,
                updated_at TEXT
            );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "add_video_source_stats_columns",
            sql: "ALTER TABLE video_source ADD COLUMN fail_count INTEGER DEFAULT 0;
                  ALTER TABLE video_source ADD COLUMN total_requests INTEGER DEFAULT 0;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "add_video_source_health_columns",
            sql: "ALTER TABLE video_source ADD COLUMN last_success_at TEXT;
                  ALTER TABLE video_source ADD COLUMN avg_response_time INTEGER;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "create_collect_task_table",
            sql: "CREATE TABLE IF NOT EXISTS collect_task (
                  id TEXT PRIMARY KEY,
                  task_id TEXT UNIQUE NOT NULL,
                  source_code TEXT NOT NULL,
                  source_name TEXT NOT NULL,
                  type TEXT NOT NULL,
                  status TEXT NOT NULL DEFAULT 'PENDING',
                  current_page INTEGER DEFAULT 0,
                  total_pages INTEGER DEFAULT 0,
                  collected_count INTEGER DEFAULT 0,
                  error_message TEXT,
                  created_at TEXT NOT NULL,
                  started_at TEXT,
                  completed_at TEXT
                  );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "add_failed_count_to_collect_task",
            sql: "ALTER TABLE collect_task ADD COLUMN failed_count INTEGER DEFAULT 0;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "add_duration_check_columns_to_media",
            sql: "ALTER TABLE media ADD COLUMN duration_check_status TEXT;
                  ALTER TABLE media ADD COLUMN duration_retry_at TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "add_foreign_key_cascade_to_favorite_watch_history",
            sql: "PRAGMA foreign_keys = ON;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "add_error_type_and_last_error_page_to_collect_task",
            sql: "ALTER TABLE collect_task ADD COLUMN error_type TEXT;
                  ALTER TABLE collect_task ADD COLUMN last_error_page INTEGER;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "add_failed_pages_to_collect_task",
            sql: "ALTER TABLE collect_task ADD COLUMN failed_pages TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "add_reprobe_fields_to_collect_task",
            sql: "ALTER TABLE collect_task ADD COLUMN probed_count INTEGER DEFAULT 0;
                  ALTER TABLE collect_task ADD COLUMN short_drama_count INTEGER DEFAULT 0;
                  ALTER TABLE collect_task ADD COLUMN long_drama_count INTEGER DEFAULT 0;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "add_episode_duration_to_media",
            sql: "ALTER TABLE media ADD COLUMN episode_duration INTEGER;",
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(init_http())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:movieapp.db", migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
