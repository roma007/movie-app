import * as SQLite from 'expo-sqlite';
import { File, Paths } from 'expo-file-system';
import {
  PRAGMA_SQL,
  SCHEMA_SQL,
  DROP_SYNC_REMNANTS_SQL,
  FAVORITE_UNIQUE_MIGRATE_SQL,
  INSERT_DEFAULT_SOURCE_SQL,
  COUNT_VIDEO_SOURCE_SQL,
  defaultSources,
  splitSqlStatements,
  MEDIA_FILE_EXTENSIONS,
  UNCATEGORIZED_GENRE,
  mediaMatchesFilters,
  rowToMedia,
  rowToEpisode,
  rowToPlaySource,
  rowToVideoSource,
  rowToFavorite,
  rowToWatchHistory,
  rowToCollectTask,
  expandSubTypes,
  extractFirstSubtypes,
} from '@movie-app/core';
import type { DatabaseProvider } from '@movie-app/core';
import type {
  Media,
  Episode,
  PlaySource,
  VideoSource,
  Favorite,
  WatchHistory,
  PaginatedResponse,
  ListParams,
  CollectTask,
} from '@movie-app/core';

interface Migration {
  version: number;
  description: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'create_initial_tables',
    sql: SCHEMA_SQL,
  },
  {
    version: 2,
    description: 'add_play_source_fail_columns',
    sql: `ALTER TABLE play_source ADD COLUMN is_active INTEGER DEFAULT 1;
          ALTER TABLE play_source ADD COLUMN fail_count INTEGER DEFAULT 0;
          ALTER TABLE play_source ADD COLUMN last_fail_at TEXT;`,
  },
  {
    version: 3,
    description: 'create_search_history_table',
    sql: `CREATE TABLE IF NOT EXISTS search_history (
            id TEXT PRIMARY KEY,
            keyword TEXT NOT NULL,
            count INTEGER DEFAULT 1,
            updated_at TEXT
          );`,
  },
  {
    version: 4,
    description: 'add_video_source_stats_columns',
    sql: `ALTER TABLE video_source ADD COLUMN fail_count INTEGER DEFAULT 0;
          ALTER TABLE video_source ADD COLUMN total_requests INTEGER DEFAULT 0;`,
  },
  {
    version: 5,
    description: 'add_video_source_health_columns',
    sql: `ALTER TABLE video_source ADD COLUMN last_success_at TEXT;
          ALTER TABLE video_source ADD COLUMN avg_response_time INTEGER;`,
  },
  {
    version: 6,
    description: 'create_collect_task_table',
    sql: `CREATE TABLE IF NOT EXISTS collect_task (
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
          );`,
  },
  {
    version: 7,
    description: 'add_failed_count_to_collect_task',
    sql: `ALTER TABLE collect_task ADD COLUMN failed_count INTEGER DEFAULT 0;`,
  },
  {
    version: 8,
    description: 'add_duration_check_columns_to_media',
    sql: `ALTER TABLE media ADD COLUMN duration_check_status TEXT;
          ALTER TABLE media ADD COLUMN duration_retry_at TEXT;`,
  },
  {
    version: 9,
    description: 'add_foreign_key_cascade_to_favorite_watch_history',
    sql: `PRAGMA foreign_keys = ON;`,
  },
  {
    version: 10,
    description: 'add_error_type_and_last_error_page_to_collect_task',
    sql: `ALTER TABLE collect_task ADD COLUMN error_type TEXT;
          ALTER TABLE collect_task ADD COLUMN last_error_page INTEGER;`,
  },
  {
    version: 11,
    description: 'add_hidden_column_to_media',
    sql: `ALTER TABLE media ADD COLUMN hidden INTEGER DEFAULT 0;`,
  },
  {
    version: 12,
    description: 'add_reprobe_fields_to_collect_task',
    sql: `ALTER TABLE collect_task ADD COLUMN probed_count INTEGER DEFAULT 0;
          ALTER TABLE collect_task ADD COLUMN short_drama_count INTEGER DEFAULT 0;
          ALTER TABLE collect_task ADD COLUMN long_drama_count INTEGER DEFAULT 0;`,
  },
  {
    version: 13,
    description: 'add_episode_duration_to_media',
    sql: `ALTER TABLE media ADD COLUMN episode_duration INTEGER;`,
  },
  {
    version: 14,
    description: 'add_last_collected_at_to_video_source',
    sql: `ALTER TABLE video_source ADD COLUMN last_collected_at TEXT;`,
  },
  {
    version: 15,
    description: 'add_source_id_to_episode',
    sql: `ALTER TABLE episode ADD COLUMN source_id TEXT;`,
  },
  {
    version: 16,
    description: 'add_series_group_to_media',
    sql: `ALTER TABLE media ADD COLUMN series_group TEXT;
          ALTER TABLE media ADD COLUMN series_season INTEGER;`,
  },
  {
    version: 17,
    description: 'fix_genres_with_comma_in_first_element',
    sql: `SELECT 1;`,
  },
  {
    version: 18,
    description: 'create_hidden_genre_table',
    sql: `CREATE TABLE IF NOT EXISTS hidden_genre (
            sub_type TEXT PRIMARY KEY,
            created_at TEXT
          );
          INSERT OR IGNORE INTO hidden_genre (sub_type, created_at)
          SELECT DISTINCT json_each.value, datetime('now')
          FROM media, json_each(media.genre)
          WHERE media.hidden = 1 AND json_valid(media.genre)
            AND json_each.value IS NOT NULL AND json_each.value != '';`,
  },
  {
    version: 19,
    description: 'create_collection_log_table',
    sql: `CREATE TABLE IF NOT EXISTS collection_log (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            level TEXT NOT NULL,
            message TEXT NOT NULL,
            task_id TEXT,
            source_code TEXT,
            source_name TEXT,
            details TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_collection_log_ts ON collection_log(timestamp);
          CREATE INDEX IF NOT EXISTS idx_collection_log_task ON collection_log(task_id);`,
  },
  {
    version: 20,
    description: 'add_last_incremental_collected_at_to_video_source',
    sql: `ALTER TABLE video_source ADD COLUMN last_incremental_collected_at TEXT;`,
  },
  {
    version: 21,
    description: 'add_episode_media_season_source_index',
    sql: `CREATE INDEX IF NOT EXISTS idx_episode_media_season_source ON episode(media_id, season_number, source_id);`,
  },
  {
    version: 22,
    description: 'guard_media_au_trigger_to_skip_non_fts_updates',
    sql: `DROP TRIGGER IF EXISTS media_au;
          CREATE TRIGGER media_au AFTER UPDATE ON media WHEN
            old.title IS NOT new.title OR old.alias IS NOT new.alias OR
            old.original_title IS NOT new.original_title OR
            old.director IS NOT new.director OR old.cast IS NOT new.cast
          BEGIN
            INSERT INTO media_fts(media_fts, rowid, title, alias, original_title, director, cast)
            VALUES ('delete', old.rowid, old.title, old.alias, old.original_title, old.director, old.cast);
            INSERT INTO media_fts(rowid, title, alias, original_title, director, cast)
            VALUES (new.rowid, new.title, new.alias, new.original_title, new.director, new.cast);
          END;`,
  },
  {
    version: 23,
    description: 'add_rating_columns_to_media',
    sql: `ALTER TABLE media ADD COLUMN rating REAL;
          ALTER TABLE media ADD COLUMN rating_count INTEGER;
          ALTER TABLE media ADD COLUMN rating_source TEXT;
          ALTER TABLE media ADD COLUMN rating_updated_at TEXT;`,
  },
  {
    version: 24,
    description: 'clear_cms_rating_fallback',
    sql: `UPDATE media SET rating = NULL, rating_count = NULL, rating_source = NULL, rating_updated_at = NULL WHERE rating_source = 'CMS';`,
  },
  {
    version: 25,
    description: 'add_personal_score_to_media',
    sql: `ALTER TABLE media ADD COLUMN personal_score INTEGER DEFAULT 0;`,
  },
  {
    version: 26,
    description: 'create_impression_table',
    sql: `CREATE TABLE IF NOT EXISTS impression (
      media_id TEXT PRIMARY KEY,
      shown_count INTEGER DEFAULT 1,
      first_shown_at TEXT,
      last_shown_at TEXT
    );`,
  },
  {
    version: 27,
    description: 'create_user_interest_tag_table',
    sql: `CREATE TABLE IF NOT EXISTS user_interest_tag (
            tag TEXT NOT NULL,
            tag_type TEXT NOT NULL,
            strength REAL DEFAULT 0,
            sample_count INTEGER DEFAULT 0,
            updated_at TEXT,
            PRIMARY KEY (tag, tag_type)
          );
          CREATE INDEX IF NOT EXISTS idx_user_interest_tag_strength ON user_interest_tag(strength);`,
  },
  {
    version: 28,
    description: 'create_recommend_snapshot_table',
    sql: `CREATE TABLE IF NOT EXISTS recommend_snapshot (
            media_id TEXT PRIMARY KEY,
            position INTEGER,
            score INTEGER DEFAULT 0,
            genre_group TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_recommend_snapshot_position ON recommend_snapshot(position);`,
  },
  {
    version: 29,
    description: 'create_media_personal_score_index',
    sql: `CREATE INDEX IF NOT EXISTS idx_media_personal_score ON media(personal_score, updated_at);`,
  },
  {
    version: 30,
    description: 'create_dislike_and_interest_tag_blacklist_tables',
    sql: `CREATE TABLE IF NOT EXISTS dislike (
      media_id TEXT PRIMARY KEY,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS interest_tag_blacklist (
      tag TEXT NOT NULL,
      tag_type TEXT NOT NULL,
      created_at TEXT,
      PRIMARY KEY (tag, tag_type)
    );`,
  },
  {
    version: 31,
    description: 'add_watch_history_source_and_play_source_columns',
    sql: `ALTER TABLE watch_history ADD COLUMN source_id TEXT;
          ALTER TABLE watch_history ADD COLUMN play_source_id TEXT;`,
  },
  {
    version: 32,
    description: 'create_media_change_log_table',
    sql: `CREATE TABLE IF NOT EXISTS media_change_log (
      media_id TEXT PRIMARY KEY,
      change_type TEXT NOT NULL,
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_media_change_log_created_at ON media_change_log(created_at);`,
  },
  {
    version: 33,
    description: 'create_watch_line_progress_table',
    sql: `CREATE TABLE IF NOT EXISTS watch_line_progress (
      media_id TEXT NOT NULL,
      episode_id TEXT NOT NULL,
      play_source_id TEXT NOT NULL,
      source_id TEXT,
      progress INTEGER DEFAULT 0,
      duration INTEGER DEFAULT 0,
      updated_at TEXT,
      PRIMARY KEY (media_id, episode_id, play_source_id)
    );`,
  },
  {
    version: 37,
    description: 'drop_sync_change_log_remnants',
    sql: `DROP TRIGGER IF EXISTS favorite_change_log_insert;
          DROP TRIGGER IF EXISTS favorite_change_log_update;
          DROP TRIGGER IF EXISTS favorite_change_log_delete;
          DROP TRIGGER IF EXISTS watch_history_change_log_insert;
          DROP TRIGGER IF EXISTS watch_history_change_log_update;
          DROP TRIGGER IF EXISTS watch_history_change_log_delete;
          DROP TRIGGER IF EXISTS watch_line_progress_change_log_insert;
          DROP TRIGGER IF EXISTS watch_line_progress_change_log_update;
          DROP TRIGGER IF EXISTS watch_line_progress_change_log_delete;
          DROP TRIGGER IF EXISTS search_history_change_log_insert;
          DROP TRIGGER IF EXISTS search_history_change_log_update;
          DROP TRIGGER IF EXISTS search_history_change_log_delete;
          DROP TRIGGER IF EXISTS hidden_genre_change_log_insert;
          DROP TRIGGER IF EXISTS hidden_genre_change_log_update;
          DROP TRIGGER IF EXISTS hidden_genre_change_log_delete;
          DROP TRIGGER IF EXISTS dislike_change_log_insert;
          DROP TRIGGER IF EXISTS dislike_change_log_update;
          DROP TRIGGER IF EXISTS dislike_change_log_delete;
          DROP TRIGGER IF EXISTS system_config_change_log_insert;
          DROP TRIGGER IF EXISTS system_config_change_log_update;
          DROP TRIGGER IF EXISTS system_config_change_log_delete;
          DROP TRIGGER IF EXISTS user_interest_tag_change_log_insert;
          DROP TRIGGER IF EXISTS user_interest_tag_change_log_update;
          DROP TRIGGER IF EXISTS user_interest_tag_change_log_delete;
          DROP INDEX IF EXISTS idx_change_log_synced;
          DROP INDEX IF EXISTS idx_change_log_timestamp;
          DROP INDEX IF EXISTS idx_change_log_table_record;
          DROP TABLE IF EXISTS change_log;
          DELETE FROM migrations WHERE version IN (34, 35, 36);`,
  },
  {
    // 版本号取 39（> 曾被同步功能占用的 38），确保已执行过迁移 38 的库也会重跑本清理。
    version: 39,
    description: 'drop_sync_remnants_after_revert',
    sql: DROP_SYNC_REMNANTS_SQL,
  },
  {
    version: 40,
    description: 'drop_rate_limit_column_from_video_source',
    sql: `
      PRAGMA foreign_keys=OFF;
      CREATE TABLE video_source_new (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        type TEXT DEFAULT 'CMS',
        is_enabled INTEGER DEFAULT 1,
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
      INSERT INTO video_source_new (id, code, name, base_url, type, is_enabled, health_status, last_check_at, last_success_at, avg_response_time, last_collected_at, last_incremental_collected_at, created_at, fail_count, total_requests)
        SELECT id, code, name, base_url, type, is_enabled, health_status, last_check_at, last_success_at, avg_response_time, last_collected_at, last_incremental_collected_at, created_at, fail_count, total_requests FROM video_source;
      DROP TABLE video_source;
      ALTER TABLE video_source_new RENAME TO video_source;
      PRAGMA foreign_keys=ON;
    `,
  },
  {
    version: 41,
    description: 'add_failed_items_to_collect_task',
    sql: `ALTER TABLE collect_task ADD COLUMN failed_items TEXT;`,
  },
  {
    version: 42,
    description: 'add_source_updated_at_to_media',
    sql: `ALTER TABLE media ADD COLUMN source_updated_at TEXT;`,
  },
  {
    version: 43,
    description: 'add_vod_id_to_media',
    sql: `ALTER TABLE media ADD COLUMN vod_id TEXT;`,
  },
  {
    version: 44,
    description: 'add_media_filter_covering_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_media_type_year ON media(type, year);
          CREATE INDEX IF NOT EXISTS idx_media_type_area ON media(type, area);
          CREATE INDEX IF NOT EXISTS idx_media_type_genre ON media(type, genre);`,
  },
  {
    version: 45,
    description: 'add_media_fingerprint_vod_id_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_media_fingerprint ON media(fingerprint);
          CREATE INDEX IF NOT EXISTS idx_media_vod_id ON media(vod_id);`,
  },
  {
    version: 46,
    description: 'add_failed_pages_to_collect_task',
    sql: `ALTER TABLE collect_task ADD COLUMN failed_pages TEXT;`,
  },
  {
    version: 47,
    description: 'drop_redundant_episode_play_source_indexes',
    sql: `DROP INDEX IF EXISTS idx_episode_media_id;
          DROP INDEX IF EXISTS idx_episode_source_id;
          DROP INDEX IF EXISTS idx_play_source_source_id_episode_id;`,
  },
  {
    version: 48,
    description: 'add_episode_source_id_media_id_covering_index',
    sql: `CREATE INDEX IF NOT EXISTS idx_episode_source_id_media_id ON episode(source_id, media_id);`,
  },
  {
    version: 49,
    description: 'add_play_source_language_column',
    sql: `ALTER TABLE play_source ADD COLUMN language TEXT;`,
  },
  {
    version: 50,
    description: 'rebuild_media_fts_with_trigram_tokenizer',
    sql: `DROP TRIGGER IF EXISTS media_ai;
          DROP TRIGGER IF EXISTS media_ad;
          DROP TRIGGER IF EXISTS media_au;
          DROP TABLE IF EXISTS media_fts_data;
          DROP TABLE IF EXISTS media_fts_idx;
          DROP TABLE IF EXISTS media_fts_content;
          DROP TABLE IF EXISTS media_fts_docsize;
          DROP TABLE IF EXISTS media_fts;
          CREATE VIRTUAL TABLE media_fts USING fts5(
            title, alias, original_title, director, cast,
            content='media',
            content_rowid='rowid',
            tokenize='trigram'
          );
          CREATE TRIGGER media_ai AFTER INSERT ON media BEGIN
            INSERT INTO media_fts(rowid, title, alias, original_title, director, cast)
            VALUES (new.rowid, new.title, new.alias, new.original_title, new.director, new.cast);
          END;
          CREATE TRIGGER media_ad AFTER DELETE ON media BEGIN
            INSERT INTO media_fts(media_fts, rowid, title, alias, original_title, director, cast)
            VALUES ('delete', old.rowid, old.title, old.alias, old.original_title, old.director, old.cast);
          END;
          CREATE TRIGGER media_au AFTER UPDATE ON media WHEN
            old.title IS NOT new.title OR old.alias IS NOT new.alias OR
            old.original_title IS NOT new.original_title OR
            old.director IS NOT new.director OR old.cast IS NOT new.cast
          BEGIN
            INSERT INTO media_fts(media_fts, rowid, title, alias, original_title, director, cast)
            VALUES ('delete', old.rowid, old.title, old.alias, old.original_title, old.director, old.cast);
            INSERT INTO media_fts(rowid, title, alias, original_title, director, cast)
            VALUES (new.rowid, new.title, new.alias, new.original_title, new.director, new.cast);
          END;
          INSERT INTO media_fts(media_fts) VALUES('rebuild');`,
  },
  {
    version: 51,
    description: 'add_media_type_updated_at_visible_partial_index',
    sql: `CREATE INDEX IF NOT EXISTS idx_media_type_updated_at_visible ON media(type, updated_at)
          WHERE (hidden IS NULL OR hidden = 0);`,
  },
  {
    version: 52,
    description: 'add_media_filter_visible_partial_covering_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_media_type_year_visible ON media(type, year)
          WHERE (hidden IS NULL OR hidden = 0);
          CREATE INDEX IF NOT EXISTS idx_media_type_area_visible ON media(type, area)
          WHERE (hidden IS NULL OR hidden = 0);
          CREATE INDEX IF NOT EXISTS idx_media_type_genre_visible ON media(type, genre)
          WHERE (hidden IS NULL OR hidden = 0);
          CREATE INDEX IF NOT EXISTS idx_media_is_short_drama_visible ON media(type, is_short_drama)
          WHERE (hidden IS NULL OR hidden = 0);`,
  },
  {
    version: 53,
    description: 'add_media_kid_safe_column_and_index',
    sql: `ALTER TABLE media ADD COLUMN kid_safe INTEGER;
          CREATE INDEX IF NOT EXISTS idx_media_kid_safe ON media(kid_safe);`,
  },
  {
    version: 54,
    description: 'add_recommend_sort_personal_score_visible_partial_indexes',
    sql: `CREATE INDEX IF NOT EXISTS idx_media_type_personal_score_visible
          ON media(type, personal_score DESC, updated_at DESC)
          WHERE (hidden IS NULL OR hidden = 0);
          CREATE INDEX IF NOT EXISTS idx_media_personal_score_visible
          ON media(personal_score DESC, updated_at DESC)
          WHERE (hidden IS NULL OR hidden = 0);`,
  },
  {
    version: 55,
    description: 'create_recommend_candidates_table',
    sql: `CREATE TABLE IF NOT EXISTS recommend_candidates (
            media_id TEXT PRIMARY KEY,
            position INTEGER,
            score INTEGER DEFAULT 0,
            genre_group TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_recommend_candidates_position ON recommend_candidates(position);`,
  },
  {
    version: 56,
    description: 'add_media_updated_at_visible_partial_index',
    sql: `CREATE INDEX IF NOT EXISTS idx_media_updated_at_visible ON media(updated_at)
          WHERE (hidden IS NULL OR hidden = 0);`,
  },
  {
    version: 57,
    description: 'deduplicate_favorite_rows_and_make_media_unique',
    sql: FAVORITE_UNIQUE_MIGRATE_SQL,
  },
  {
    version: 58,
    description: 'drop_reanimated_plain_favorite_index',
    sql: `DROP INDEX IF EXISTS idx_favorite_media_id;`,
  },
  {
    version: 59,
    description: 'drop_collection_log_table',
    sql: `DROP TABLE IF EXISTS collection_log;`,
  },
  {
    version: 60,
    description: 'drop_recommend_snapshot_table',
    sql: `DROP TABLE IF EXISTS recommend_snapshot;`,
  },
  {
    version: 61,
    description: 'pk_integer_refactor',
    // 实际迁移为多语句重建流程（590 万行级、需回读校验），由 init() 在 runMigrations 之后
    // 调用 migratePkToInteger() 以代码执行（检测 episode.id 类型驱动、幂等可重入）。
    // v61 仅作为结构升级已发生的版本标记；未升级老库即使当前版本>=60 也会由 JS 检测补齐。
    sql: `SELECT 1;`,
  },
];

/**
 * DatabaseProvider 的 expo-sqlite 实现（移动端）。
 * SQL 语句与桌面端 TauriSqlProvider 完全一致，仅底层 API 不同。
 */
export class ExpoSqliteProvider implements DatabaseProvider {
  private db: SQLite.SQLiteDatabase | null = null;
  private readDb: SQLite.SQLiteDatabase | null = null;

  /** 儿童模式开关缓存（启动时由 system_config 初始化，setKidModeActive 同步更新）。 */
  private kidModeActive = false;

  /** 推荐排序「候选∩筛选」视图缓存：同筛选键 120s 内复用，翻页只需对有序候选切片（毫秒级）。 */
  private recommendViewCache: { key: string; view: number[]; at: number } | null = null;

  /** 事务互斥队列：expo 单连接下多个 withTransactionAsync 交错会导致
   *  「cannot start a transaction within a transaction」；FIFO 串行保证 BEGIN/COMMIT 成对。 */
  private txQueue: Promise<void> = Promise.resolve();

  private wrapWithRetry(db: any): any {
    const isLockError = (error: any): boolean => {
      const msg = (error?.message || String(error)).toLowerCase();
      return msg.includes('database is locked') || msg.includes('code 5') || msg.includes('busy') || msg.includes('locked');
    };

    const createRetryFn = (originalFn: any) => {
      return async (...args: any[]) => {
        let lastError: Error | null = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            return await originalFn.apply(db, args);
          } catch (error: any) {
            lastError = error;
            if (isLockError(error) && attempt < 4) {
              const delay = Math.min(100 * Math.pow(2, attempt), 1500);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
            throw error;
          }
        }
        throw lastError;
      };
    };

    const execAsync = createRetryFn(db.execAsync.bind(db));
    const runAsync = createRetryFn(db.runAsync.bind(db));
    const getFirstAsync = createRetryFn(db.getFirstAsync.bind(db));
    const getAllAsync = createRetryFn(db.getAllAsync.bind(db));

    return new Proxy(db, {
      get(target, prop) {
        if (prop === 'execAsync') return execAsync;
        if (prop === 'runAsync') return runAsync;
        if (prop === 'getFirstAsync') return getFirstAsync;
        if (prop === 'getAllAsync') return getAllAsync;
        return (target as any)[prop];
      },
    });
  }

  async init(): Promise<void> {
    if (this.db) return;
    const timing: Record<string, number> = {};
    let stepStart = Date.now();
    const mark = (label: string) => { timing[label] = Date.now() - stepStart; stepStart = Date.now(); };

    const rawDb = await SQLite.openDatabaseAsync('movieapp.db');
    const wrappedDb = this.wrapWithRetry(rawDb);
    this.db = wrappedDb;
    mark('open_write_db');

    // 执行 PRAGMA（PRAGMA 语句无触发器体，可简单按 ; 拆分）
    const pragmas = PRAGMA_SQL.split(';').map((s: string) => s.trim()).filter(Boolean);
    for (const stmt of pragmas) {
      await wrappedDb.execAsync(stmt);
    }
    mark('pragmas');

    await this.runMigrations();
    mark('migrations');

    // 主键 INTEGER 化迁移：老库字符串主键 → 自增整数主键。置 runMigrations 之后执行，
    // 以便 v61 版本标记生效；实际由 episode.id 列类型驱动，幂等可重入。
    await this.migratePkToInteger();
    mark('pk_integer');

    // 初始化儿童模式开关缓存（启动时读一次，作为查询层过滤的唯一依据）
    const kidModeRow = (await wrappedDb.getFirstAsync(
      "SELECT value FROM system_config WHERE key = 'parental.kidMode'"
    )) as { value: string } | null;
    this.kidModeActive = kidModeRow?.value === '1';
    mark('kid_mode');

    await this.insertDefaultSources();
    mark('insert_default_sources');

    // 独立读连接：WAL 下与写连接并发，采集大量写库时 UI 查询不再排队阻塞。
    // 读连接必须在前台就绪，否则读方法拿到 null。
    this.readDb = this.wrapWithRetry(await SQLite.openDatabaseAsync('movieapp.db'));
    for (const stmt of pragmas) {
      await this.readDb!.execAsync(stmt);
    }
    mark('open_read_db');

    // 首屏必需步骤已就绪即返回；重活（索引/数据修复/WAL收束等）全部移后台执行
    timing.total_front = Date.now() - stepStart;
    void this.postInitMaintenance(timing);
  }

  private async postInitMaintenance(frontTiming: Record<string, number>): Promise<void> {
    try {
      const timing: Record<string, number> = {};
      const t0 = Date.now();

      // fixGenre 历史数据修复：一次性（done 标记）且仅在存在坏数据时才跑。
      const doneFile = new File(Paths.document, 'genre_fix.done');
      if (!doneFile.exists) {
        const tFix = Date.now();
        const needFix = await this.db!.getFirstAsync<{ id: string; genre: string }>(
          "SELECT id, genre FROM media WHERE genre IS NOT NULL AND genre LIKE '%[\"%' AND genre LIKE '%,%' LIMIT 1"
        );
        if (needFix) {
          await this.fixGenreData();
        }
        doneFile.write('1');
        timing.post_fixGenre = Date.now() - tFix;
      } else {
        timing.post_fixGenre = 0;
      }

      const tIdx = Date.now();
      await this.db!.execAsync('CREATE INDEX IF NOT EXISTS idx_episode_source_id_media_id ON episode(source_id, media_id);');
      await this.db!.execAsync('CREATE INDEX IF NOT EXISTS idx_play_source_episode_id ON play_source(episode_id);');
      // favorite 不再建普通索引 idx_favorite_media_id（v57 起改由 UNIQUE 索引 uq_favorite_media_id 承担）
      await this.db!.execAsync('CREATE INDEX IF NOT EXISTS idx_watch_history_media_id ON watch_history(media_id);');
      timing.post_indexes = Date.now() - tIdx;

      const tSync = Date.now();
      await this.syncHiddenByGenres();
      timing.post_syncHidden = Date.now() - tSync;

      const tHttps = Date.now();
      await this.upgradeSourceUrlsToHttps();
      timing.post_upgradeHttps = Date.now() - tHttps;

      const tPrune = Date.now();
      await this.handlePruneOversizedFailedItems();
      timing.post_prune = Date.now() - tPrune;

      const tWal = Date.now();
      try {
        await this.db!.execAsync('PRAGMA wal_checkpoint(TRUNCATE)');
      } catch (err) {
        console.error('[DB] WAL checkpoint 失败:', err);
      }
      timing.post_walCheckpoint = Date.now() - tWal;
      timing.post_total = Date.now() - t0;

      const fullTiming = Object.assign({}, frontTiming, timing);
      try {
        const f = new File(Paths.document, 'init_timings.json');
        f.write(JSON.stringify(fullTiming));
      } catch (e) {
        console.error('[DB] init_timings 写入失败:', e);
      }
    } catch (err) {
      console.error('[DB] postInitMaintenance 失败:', err);
    }
  }

  private async handlePruneOversizedFailedItems(): Promise<void> {
    try {
      // 仅清理已结束状态（COMPLETED/FAILED/ABANDONED）的超大失败明细，
      // 绝不动 RUNNING/PENDING 等未完成任务（其续采依赖 currentPage/failed_items 等）。
      await this.db!.runAsync(
        "UPDATE collect_task SET failed_items = NULL WHERE status IN ('COMPLETED','FAILED','ABANDONED') AND failed_items IS NOT NULL AND length(failed_items) > 131072"
      );
    } catch (err) {
      console.error('[DB] 清理超大 failed_items 失败:', err);
    }
  }

  private async runMigrations(): Promise<void> {
    await this.db!.execAsync(`
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        description TEXT,
        applied_at TEXT
      );
    `);

    const result = await this.db!.getFirstAsync<{ version: number }>(
      'SELECT MAX(version) as version FROM migrations'
    );
    const currentVersion = result?.version || 0;

    for (const migration of MIGRATIONS) {
      if (migration.version > currentVersion) {
        for (const stmt of splitSqlStatements(migration.sql)) {
          try {
            await this.db!.execAsync(stmt);
          } catch (e) {
            console.warn(`Migration ${migration.version} statement failed:`, stmt, e);
          }
        }
        const now = new Date().toISOString();
        await this.db!.runAsync(
          'INSERT INTO migrations (version, description, applied_at) VALUES (?, ?, ?)',
          [migration.version, migration.description, now]
        );
      }
    }
  }

  /**
   * 主键 INTEGER 化迁移（移动端）：逻辑与桌面 tauriSqlProvider.migratePkToInteger 完全一致，
   * 仅底层 API 不同（execAsync/runAsync/getAllAsync）。详见该方法的注释：
   * 触发条件、合并去重键、孤儿落 0 哨兵、FTS 先拆后建、可重入等语义全一致。
   */
  private async migratePkToInteger(): Promise<void> {
    const cols = (await this.db!.getAllAsync<{ name: string; type: string }>('PRAGMA table_info(episode)')) || [];
    if (cols.length === 0) return;
    const idCol = cols.find((c) => c.name === 'id');
    if (idCol && idCol.type.toUpperCase() === 'INTEGER') return; // 已迁移或全新库

    console.warn('[DB] 检测到旧字符串主键库，开始主键 INTEGER 迁移（590 万行级，可能耗时，允许中断重试）...');
    const exec = (sql: string) => this.db!.execAsync(sql);

    // 可重入：清上一轮残留的临时表
    for (const t of [
      'media_pkv2', 'episode_pkv2', 'play_source_pkv2',
      'favorite_pkv2', 'impression_pkv2', 'recommend_candidates_pkv2',
      'dislike_pkv2', 'media_change_log_pkv2', 'watch_history_pkv2', 'watch_line_progress_pkv2',
      'm_map', 'ep_map', 'ps_map',
    ]) {
      await exec(`DROP TABLE IF EXISTS ${t}`);
    }
    await exec('DROP TRIGGER IF EXISTS media_ai');
    await exec('DROP TRIGGER IF EXISTS media_au');
    await exec('DROP TRIGGER IF EXISTS media_ad');
    await exec('DROP TABLE IF EXISTS media_fts');

    await exec(`CREATE TABLE media_pkv2 (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, original_title TEXT, alias TEXT, type TEXT NOT NULL,
      year INTEGER NOT NULL, area TEXT, genre TEXT, director TEXT, cast TEXT, description TEXT,
      poster_url TEXT, backdrop_url TEXT, status TEXT, remarks TEXT, fingerprint TEXT UNIQUE,
      current_episodes INTEGER, total_episodes INTEGER, is_short_drama INTEGER DEFAULT 0,
      duration_check_status TEXT, episode_duration INTEGER, view_count INTEGER DEFAULT 0,
      rating REAL, rating_count INTEGER, rating_source TEXT, rating_updated_at TEXT,
      hidden INTEGER DEFAULT 0, kid_safe INTEGER, personal_score INTEGER DEFAULT 0,
      series_group TEXT, series_season INTEGER, source_updated_at TEXT, vod_id TEXT, created_at TEXT, updated_at TEXT
    )`);
    await exec(`INSERT INTO media_pkv2 (
        title, original_title, alias, type, year, area, genre, director, "cast", description,
        poster_url, backdrop_url, status, remarks, fingerprint, current_episodes, total_episodes,
        is_short_drama, duration_check_status, episode_duration, view_count, rating, rating_count,
        rating_source, rating_updated_at, hidden, kid_safe, personal_score, series_group,
        series_season, source_updated_at, vod_id, created_at, updated_at
      ) SELECT
        title, original_title, alias, type, year, area, genre, director, "cast", description,
        poster_url, backdrop_url, status, remarks, fingerprint, current_episodes, total_episodes,
        is_short_drama, duration_check_status, episode_duration, view_count, rating, rating_count,
        rating_source, rating_updated_at, hidden, kid_safe, personal_score, series_group,
        series_season, source_updated_at, vod_id, created_at, updated_at
      FROM media ORDER BY rowid`);
    await exec('CREATE TABLE m_map (old TEXT PRIMARY KEY, new INTEGER)');
    await exec(
      'INSERT INTO m_map SELECT oldm.id, newm.id FROM media oldm JOIN media_pkv2 newm ON oldm.rowid = newm.rowid'
    );

    await exec(`CREATE TABLE episode_pkv2 (
      id INTEGER PRIMARY KEY, media_id INTEGER NOT NULL, season_number INTEGER DEFAULT 1,
      episode_number INTEGER NOT NULL, title TEXT, duration INTEGER, source_id TEXT
    )`);
    await exec(`INSERT INTO episode_pkv2 (media_id, season_number, episode_number, title, duration, source_id)
      SELECT m.new, e.season_number, e.episode_number, e.title, e.duration, e.source_id
      FROM episode e JOIN m_map m ON e.media_id = m.old
      GROUP BY e.media_id, e.season_number, e.episode_number, e.source_id`);
    await exec('CREATE TABLE ep_map (old TEXT PRIMARY KEY, new INTEGER)');
    await exec(`INSERT INTO ep_map
      SELECT e.id, n.id
      FROM episode e
      JOIN m_map m ON e.media_id = m.old
      JOIN episode_pkv2 n
        ON m.new = n.media_id AND e.season_number = n.season_number
       AND e.episode_number = n.episode_number AND COALESCE(e.source_id, '') = COALESCE(n.source_id, '')`);

    await exec(`CREATE TABLE play_source_pkv2 (
      id INTEGER PRIMARY KEY, episode_id INTEGER NOT NULL, source_id TEXT NOT NULL, source_name TEXT,
      url TEXT NOT NULL, quality TEXT, language TEXT, is_active INTEGER DEFAULT 1,
      fail_count INTEGER DEFAULT 0, last_fail_at TEXT
    )`);
    await exec(`INSERT INTO play_source_pkv2 (episode_id, source_id, source_name, url, quality, language, is_active, fail_count, last_fail_at)
      SELECT enew, source_id, source_name, url, quality, language, is_active, fail_count, last_fail_at
      FROM (SELECT ep_map.new AS enew, ps.source_id, ps.source_name, ps.url, ps.quality,
                   ps.language, ps.is_active, ps.fail_count, ps.last_fail_at
            FROM play_source ps JOIN ep_map ON ps.episode_id = ep_map.old)
      GROUP BY enew, url`);
    await exec('CREATE TABLE ps_map (old TEXT PRIMARY KEY, new INTEGER)');
    await exec(`INSERT INTO ps_map
      SELECT ps.id, n.id
      FROM play_source ps
      JOIN ep_map e ON ps.episode_id = e.old
      JOIN play_source_pkv2 n ON ps.url = n.url AND n.episode_id = e.new`);

    await exec('CREATE TABLE favorite_pkv2 (id TEXT PRIMARY KEY, media_id INTEGER NOT NULL, created_at TEXT)');
    await exec(`INSERT INTO favorite_pkv2 (id, media_id, created_at)
      SELECT f.id, COALESCE(m.new, 0), f.created_at FROM favorite f LEFT JOIN m_map m ON f.media_id = m.old`);

    await exec('CREATE TABLE impression_pkv2 (media_id INTEGER PRIMARY KEY, shown_count INTEGER DEFAULT 1, last_shown_at TEXT)');
    await exec(`INSERT INTO impression_pkv2 (media_id, shown_count, last_shown_at)
      SELECT COALESCE(m.new, 0), SUM(i.shown_count), MAX(i.last_shown_at)
      FROM impression i LEFT JOIN m_map m ON i.media_id = m.old
      GROUP BY COALESCE(m.new, 0)`);

    await exec('CREATE TABLE recommend_candidates_pkv2 (media_id INTEGER PRIMARY KEY, position INTEGER, score INTEGER DEFAULT 0, genre_group TEXT)');
    await exec(`INSERT INTO recommend_candidates_pkv2 (media_id, position, score, genre_group)
      SELECT COALESCE(m.new, 0), MAX(c.position), MAX(c.score), MAX(c.genre_group)
      FROM recommend_candidates c LEFT JOIN m_map m ON c.media_id = m.old
      GROUP BY COALESCE(m.new, 0)`);

    await exec('CREATE TABLE dislike_pkv2 (media_id INTEGER PRIMARY KEY, created_at TEXT)');
    await exec(`INSERT INTO dislike_pkv2 (media_id, created_at)
      SELECT COALESCE(m.new, 0), MAX(d.created_at)
      FROM dislike d LEFT JOIN m_map m ON d.media_id = m.old
      GROUP BY COALESCE(m.new, 0)`);

    await exec('CREATE TABLE media_change_log_pkv2 (media_id INTEGER PRIMARY KEY, change_type TEXT NOT NULL, created_at TEXT)');
    await exec(`INSERT INTO media_change_log_pkv2 (media_id, change_type, created_at)
      SELECT COALESCE(m.new, 0), MAX(ch.change_type), MAX(ch.created_at)
      FROM media_change_log ch LEFT JOIN m_map m ON ch.media_id = m.old
      GROUP BY COALESCE(m.new, 0)`);

    await exec(`CREATE TABLE watch_history_pkv2 (
      id TEXT PRIMARY KEY, media_id INTEGER NOT NULL, episode_id INTEGER, progress INTEGER DEFAULT 0,
      duration INTEGER DEFAULT 0, source_id TEXT, play_source_id INTEGER, updated_at TEXT
    )`);
    await exec(`INSERT OR REPLACE INTO watch_history_pkv2 (id, media_id, episode_id, progress, duration, source_id, play_source_id, updated_at)
      SELECT 'wh_' || COALESCE(m.new, 0) || '_' || COALESCE(e.new, 0),
             COALESCE(m.new, 0), COALESCE(e.new, 0), w.progress, w.duration, w.source_id,
             COALESCE(p.new, 0), w.updated_at
      FROM watch_history w
      LEFT JOIN m_map m ON w.media_id = m.old
      LEFT JOIN ep_map e ON w.episode_id = e.old
      LEFT JOIN ps_map p ON w.play_source_id = p.old`);

    await exec(`CREATE TABLE watch_line_progress_pkv2 (
      media_id INTEGER NOT NULL, episode_id INTEGER, play_source_id INTEGER, source_id TEXT,
      progress INTEGER DEFAULT 0, duration INTEGER DEFAULT 0, updated_at TEXT,
      PRIMARY KEY (media_id, episode_id, play_source_id)
    )`);
    await exec(`INSERT OR REPLACE INTO watch_line_progress_pkv2 (media_id, episode_id, play_source_id, source_id, progress, duration, updated_at)
      SELECT COALESCE(m.new, 0), COALESCE(e.new, 0), COALESCE(p.new, 0), w.source_id, w.progress, w.duration, w.updated_at
      FROM watch_line_progress w
      LEFT JOIN m_map m ON w.media_id = m.old
      LEFT JOIN ep_map e ON w.episode_id = e.old
      LEFT JOIN ps_map p ON w.play_source_id = p.old`);

    await exec('DROP TABLE play_source');
    await exec('ALTER TABLE play_source_pkv2 RENAME TO play_source');
    await exec('DROP TABLE episode');
    await exec('ALTER TABLE episode_pkv2 RENAME TO episode');
    await exec('DROP TABLE media');
    await exec('ALTER TABLE media_pkv2 RENAME TO media');
    await exec('DROP TABLE favorite');
    await exec('ALTER TABLE favorite_pkv2 RENAME TO favorite');
    await exec('DROP TABLE impression');
    await exec('ALTER TABLE impression_pkv2 RENAME TO impression');
    await exec('DROP TABLE recommend_candidates');
    await exec('ALTER TABLE recommend_candidates_pkv2 RENAME TO recommend_candidates');
    await exec('DROP TABLE dislike');
    await exec('ALTER TABLE dislike_pkv2 RENAME TO dislike');
    await exec('DROP TABLE media_change_log');
    await exec('ALTER TABLE media_change_log_pkv2 RENAME TO media_change_log');
    await exec('DROP TABLE watch_history');
    await exec('ALTER TABLE watch_history_pkv2 RENAME TO watch_history');
    await exec('DROP TABLE watch_line_progress');
    await exec('ALTER TABLE watch_line_progress_pkv2 RENAME TO watch_line_progress');
    await exec('DROP TABLE m_map');
    await exec('DROP TABLE ep_map');
    await exec('DROP TABLE ps_map');

    // 回收 DROP 旧表产生的空页，避免升级后库文件膨胀（失败仅损失缩库收益，不阻断）
    try {
      await exec('VACUUM');
    } catch (e) {
      console.warn('[DB] VACUUM 失败（缩库跳过）:', e);
    }

    console.warn('[DB] 主键 INTEGER 迁移完成（索引与 FTS 由 SCHEMA_SQL/postInit 重建）');
  }

  private async fixGenreData(): Promise<void> {
    const rows = await this.db!.getAllAsync<{ id: string; genre: string }>(
      "SELECT id, genre FROM media WHERE genre IS NOT NULL AND genre LIKE '%[\"%' AND genre LIKE '%,%'"
    );
    let fixed = 0;
    for (const row of rows) {
      try {
        const genres = JSON.parse(row.genre);
        if (!Array.isArray(genres) || genres.length === 0) continue;
        const first = genres[0];
        if (typeof first === 'string' && first.includes(',')) {
          const split = first.split(/[,，]/).filter(Boolean);
          const newGenres = [...new Set([...split, ...genres.slice(1)])];
          await this.db!.runAsync('UPDATE media SET genre = ? WHERE id = ?', [JSON.stringify(newGenres), row.id]);
          fixed++;
        }
      } catch { /* skip invalid JSON */ }
    }
    if (fixed > 0) {
      console.log(`Fixed ${fixed} media records with comma-separated genre in first element`);
    }
  }

  private async insertDefaultSources(): Promise<void> {
    const result = await this.db!.getFirstAsync<{ count: number }>(COUNT_VIDEO_SOURCE_SQL);
    if (result && result.count === 0) {
      const now = new Date().toISOString();
      for (const source of defaultSources) {
        await this.db!.runAsync(INSERT_DEFAULT_SOURCE_SQL, [
          `source_${source.code}`,
          source.code,
          source.name,
          source.baseUrl,
          now,
        ]);
      }
    }
  }

  /**
   * 将历史内置的 HTTP 视频源地址升级为 HTTPS。
   * 仅当 code 命中且 base_url 恰好等于旧的 http:// 值时才更新，避免误改用户自定义地址。
   * iOS 端 ATS（NSAllowsArbitraryLoads=false）会拦截明文 http 请求，导致连接检查失败。
   */
  private async upgradeSourceUrlsToHttps(): Promise<void> {
    const upgrades: Array<[string, string]> = [
      ['dianyingtiantang', 'https://caiji.dyttzyapi.com/api.php/provide/vod'],
      ['liangziziyuan', 'https://cj.lziapi.com/api.php/provide/vod'],
    ];
    for (const [code, httpsUrl] of upgrades) {
      const httpUrl = 'http://' + httpsUrl.slice('https://'.length);
      await this.db!.runAsync(
        'UPDATE video_source SET base_url = ? WHERE code = ? AND base_url = ?',
        [httpsUrl, code, httpUrl]
      );
    }
  }

  // —— Media DAO ——
  async getKidModeActive(): Promise<boolean> {
    return this.kidModeActive;
  }

  async setKidModeActive(on: boolean): Promise<void> {
    const now = new Date().toISOString();
    await this.db!.runAsync(
      `INSERT INTO system_config (key, value, value_type, created_at, updated_at)
       VALUES ('parental.kidMode', ?, 'string', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [on ? '1' : '0', now, now]
    );
    this.kidModeActive = on;
  }

  async getMediaById(id: number): Promise<Media | null> {
    const row = await this.db!.getFirstAsync<any>('SELECT * FROM media WHERE id = ?', [id]);
    if (!row) return null;
    // 儿童模式下隐藏非适龄内容，保证收藏/历史等经单条直查的入口同样生效
    if (this.kidModeActive && row.kid_safe !== 1) return null;
    return rowToMedia(row);
  }

  async getMediaByFingerprint(fingerprint: string): Promise<Media | null> {
    const row = await this.db!.getFirstAsync<any>('SELECT * FROM media WHERE fingerprint = ?', [fingerprint]);
    return row ? rowToMedia(row) : null;
  }

  async getMediaBySeriesGroup(groupKey: string): Promise<Media[]> {
    const rows = await this.db!.getAllAsync<any>('SELECT * FROM media WHERE series_group = ? ORDER BY series_season ASC', [groupKey]);
    return rows.map(rowToMedia);
  }

  async listMedia(params: ListParams = {}): Promise<PaginatedResponse<Media>> {
    const page = params.page || 1;
    const pageSize = params.pageSize || 20;
    const offset = (page - 1) * pageSize;

    // 构建过滤条件（支持表别名前缀，推荐快照 join 场景需要）
    const buildWhere = (alias: string) => {
      const col = (name: string) => (alias ? `${alias}.${name}` : name);
      const conditions: string[] = [`(${col('hidden')} IS NULL OR ${col('hidden')} = 0)`];
      if (this.kidModeActive) {
        conditions.push(`${col('kid_safe')} = 1`);
      }
      const qp: any[] = [];
      if (params.type) {
        conditions.push(`${col('type')} = ?`);
        qp.push(params.type);
      }
      if (params.year) {
        conditions.push(`${col('year')} = ?`);
        qp.push(params.year);
      }
      if (params.area) {
        conditions.push(`${col('area')} = ?`);
        qp.push(params.area);
      }
      if (params.genre) {
        conditions.push(`${col('genre')} LIKE ?`);
        qp.push(`%${params.genre}%`);
      }
      if (params.subType) {
        conditions.push(`${col('genre')} LIKE ?`);
        qp.push(`%${params.subType}%`);
      }
      if (params.isShortDrama !== undefined) {
        conditions.push(`${col('is_short_drama')} = ?`);
        qp.push(params.isShortDrama ? 1 : 0);
      }
      return { where: ` WHERE ${conditions.join(' AND ')}`, qp, conds: conditions };
    };

// 「为你推荐」（候选召回归一）+「全量可翻」：
        // 列表 = 候选段（recommend_candidates，几千行按 position 推荐序）在前 +
        //        候选外全量段（media 中不在候选表内的行，按 updated_at DESC 兜底）在后。
        // 用「推荐排序」必须能翻出所有符合筛选条件的视频，候选表只决定头部的个性化顺序；
        // 推荐外内容以新度承接，任何页/深翻都不会漏片。
        // 实现：候选表（~3k 行）全取后分批 PK 拉全列，再由 mediaMatchesFilters 在 JS 侧等价筛选
        // 并保持 position 序（带筛选条件的 IN/JOIN 被优化器转 media 大表驱动会成 s 级慢查询）。
        if (params.sort === 'recommend') {
          const { where, qp } = buildWhere('');
          const { where: whereM, qp: qpM } = buildWhere('m');
          // 全部符合筛选条件的 media 总数（推荐/最新/其它排序一致）
          let total: number;
          if (params.knownTotal !== undefined) {
            total = params.knownTotal;
          } else {
            const countRow = await this.db!.getFirstAsync<{ count: number }>(
              `SELECT COUNT(*) as count FROM media${where}`,
              qp
            );
            total = countRow?.count || 0;
          }
          const totalPages = Math.ceil(total / pageSize);
          // 候选∩筛选：保持候选表 position 序，JS 侧等价筛选（避免优化器转大表扫描）。
          // 同筛选键 120s 内复用有序候选视图，翻页只对 view 切片，无需重复全量过滤。
          const cacheKey = `${this.kidModeActive ? 'k1' : 'k0'}|${params.type ?? ''}|${params.year ?? ''}|${params.area ?? ''}|${params.genre ?? ''}|${params.subType ?? ''}|${params.isShortDrama !== undefined ? (params.isShortDrama ? 's1' : 's0') : ''}`;
          let view = this.recommendViewCache && this.recommendViewCache.key === cacheKey && Date.now() - this.recommendViewCache.at < 120000
            ? this.recommendViewCache.view
            : null;
          if (!view) {
            const candAll = await this.db!.getAllAsync<{ media_id: number }>(
              `SELECT media_id FROM recommend_candidates ORDER BY position`
            );
            const candRows = new Map<number, any>();
            const PK_BATCH = 400;
            for (let i = 0; i < candAll.length; i += PK_BATCH) {
              const chunk = candAll.slice(i, i + PK_BATCH).map((r) => r.media_id);
              const hit = await this.db!.getAllAsync<any>(
                `SELECT id, type, year, area, genre, is_short_drama, hidden, kid_safe
                 FROM media WHERE id IN (${chunk.map(() => '?').join(',')})`,
                chunk
              );
              for (const r of hit) candRows.set(r.id, r);
            }
            view = candAll
              .map((r) => r.media_id)
              .filter((id) => {
                const row = candRows.get(id);
                return !!row && mediaMatchesFilters(row, params, this.kidModeActive);
              });
            this.recommendViewCache = { key: cacheKey, view, at: Date.now() };
          }
          const candCnt = view.length;
          const slice = view.slice(offset, offset + pageSize);
          let rows: any[] = [];
          if (slice.length > 0) {
            const hitRows = await this.db!.getAllAsync<any>(
              `SELECT * FROM media WHERE id IN (${slice.map(() => '?').join(',')})`,
              slice
            );
            const byId = new Map(hitRows.map((r) => [r.id, r]));
            rows = slice.map((id) => byId.get(id)).filter(Boolean) as any[];
          }
          // 候选段不足一页时，以候选外全量按 updated_at 兜底补齐（保证每页可翻满）
          if (rows.length < pageSize) {
            const tailRows = await this.db!.getAllAsync<any>(
              `SELECT * FROM media m${whereM} AND NOT EXISTS (SELECT 1 FROM recommend_candidates rc WHERE rc.media_id = m.id)
               ORDER BY m.updated_at DESC LIMIT ? OFFSET ?`,
              [...qpM, pageSize - rows.length, Math.max(0, offset - candCnt)]
            );
            rows = rows.concat(tailRows);
          }
          return { items: rows.map(rowToMedia), meta: { page, pageSize, total, totalPages } };
        }

    const { where, qp } = buildWhere('');
    if (params.sort === 'random') {
      const excluded = params.excludeId
        ? `${where}${where ? ' AND' : ' WHERE'} id != ?`
        : where;
      const randomQp = params.excludeId ? [...qp, params.excludeId] : qp;
      const rows = await this.db!.getAllAsync<any>(
        `SELECT * FROM media${excluded} ORDER BY RANDOM() LIMIT ? OFFSET ?`,
        [...randomQp, pageSize, offset]
      );
      return { items: rows.map(rowToMedia), meta: { page, pageSize, total: 1, totalPages: 1 } };
    }
    let orderBy: string;
    switch (params.sort) {
      case 'hot':
        orderBy = 'view_count DESC, updated_at DESC';
        break;
      case 'rating':
        orderBy = 'rating DESC, rating_count DESC, view_count DESC';
        break;
      case 'year':
        orderBy = 'year DESC, updated_at DESC';
        break;
      case 'latest':
      default:
        orderBy = 'updated_at DESC';
        break;
    }

    let total: number;
    if (params.knownTotal !== undefined) {
      total = params.knownTotal;
    } else {
      const countResult = await this.db!.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM media${where}`,
        qp
      );
      total = countResult?.count || 0;
    }
    const totalPages = Math.ceil(total / pageSize);

    const rows = await this.db!.getAllAsync<any>(
      `SELECT * FROM media${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...qp, pageSize, offset]
    );

    return { items: rows.map(rowToMedia), meta: { page, pageSize, total, totalPages } };
  }

  async upsertMedia(media: Media): Promise<void> {
    const now = new Date().toISOString();
    await this.db!.runAsync(
      `INSERT INTO media (
        title, original_title, alias, type, year, area, genre, director, "cast",
        description, poster_url, backdrop_url, status, remarks, fingerprint,
        current_episodes, total_episodes, is_short_drama, duration_check_status, episode_duration,
        view_count, rating, rating_count, rating_source, rating_updated_at,
        hidden, kid_safe, series_group, series_season,
        source_updated_at, vod_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        title = excluded.title,
        original_title = excluded.original_title,
        alias = excluded.alias,
        area = excluded.area,
        genre = excluded.genre,
        director = excluded.director,
        cast = excluded.cast,
        description = excluded.description,
        poster_url = excluded.poster_url,
        backdrop_url = excluded.backdrop_url,
        status = excluded.status,
        remarks = excluded.remarks,
        current_episodes = excluded.current_episodes,
        total_episodes = excluded.total_episodes,
        is_short_drama = excluded.is_short_drama,
        duration_check_status = excluded.duration_check_status,
        episode_duration = excluded.episode_duration,
        series_group = excluded.series_group,
        series_season = excluded.series_season,
        source_updated_at = excluded.source_updated_at,
        vod_id = excluded.vod_id,
        updated_at = excluded.updated_at`,
      [
        media.title, media.originalTitle || null, media.alias || null,
        media.type, media.year, media.area || null,
        JSON.stringify(media.genres), JSON.stringify(media.directors), JSON.stringify(media.actors),
        media.description || null, media.posterUrl || null, media.backdropUrl || null,
        media.status || null, media.remarks || null, media.fingerprint,
        media.currentEpisodes || null, media.totalEpisodes || null,
        media.isShortDrama ? 1 : 0, media.durationCheckStatus || null, media.episodeDuration || null,
        media.viewCount || 0,
        media.rating ?? null, media.ratingCount ?? null, media.ratingSource || null, media.ratingUpdatedAt || null,
        media.hidden ? 1 : 0,
        media.kidSafe === undefined ? null : (media.kidSafe ? 1 : 0),
        media.seriesGroup || null, media.seriesSeason ?? null,
        media.sourceUpdatedAt || null,
        media.vodId || null,
        media.createdAt || now, now,
      ]
    );
  }

  async updateMediaStatusAndEpisodes(
    mediaId: number,
    status: string,
    currentEpisodes: number | null,
    totalEpisodes: number | null,
    updatedAt: string
  ): Promise<void> {
    await this.db!.runAsync(
      `UPDATE media SET status = ?, current_episodes = ?, total_episodes = ?, updated_at = ? WHERE id = ?`,
      [status, currentEpisodes, totalEpisodes, updatedAt, mediaId]
    );
  }

  async updateSourceSync(mediaId: number, sourceUpdatedAt: string | null, vodId: string | null): Promise<void> {
    await this.db!.runAsync(`UPDATE media SET source_updated_at = ?, vod_id = ? WHERE id = ?`, [sourceUpdatedAt, vodId, mediaId]);
  }

  async getMediaByVodId(vodId: string): Promise<Media | null> {
    const rows = await this.db!.getAllAsync<any[]>('SELECT * FROM media WHERE vod_id = ? LIMIT 1', [vodId]);
    return rows[0] ? rowToMedia(rows[0]) : null;
  }

  async updateMediaPoster(mediaId: number, posterUrl: string | null, updatedAt: string): Promise<void> {
    await this.db!.runAsync(
      `UPDATE media SET poster_url = ?, updated_at = ? WHERE id = ?`,
      [posterUrl, updatedAt, mediaId]
    );
  }

  async updateMediaRating(
    mediaId: number,
    data: { rating: number | null; ratingCount: number | null; source: 'DOUBAN'; updatedAt: string }
  ): Promise<void> {
    await this.db!.runAsync(
      `UPDATE media SET rating = ?, rating_count = ?, rating_source = ?, rating_updated_at = ? WHERE id = ?`,
      [data.rating, data.ratingCount, data.source, data.updatedAt, mediaId]
    );
  }

  async incrementViewCount(id: number): Promise<void> {
    await this.db!.runAsync('UPDATE media SET view_count = view_count + 1 WHERE id = ?', [id]);
  }

  async searchMedia(
    keyword: string,
    params: {
      page?: number;
      pageSize?: number;
      type?: string;
      year?: number;
      area?: string;
      genre?: string;
    } = {}
  ): Promise<PaginatedResponse<Media>> {
    const page = params.page || 1;
    const pageSize = params.pageSize || 20;
    const offset = (page - 1) * pageSize;

    const trimmed = keyword.trim();
    // ≥3 字符且不含内部空格才走 trigram FTS 子串索引（JOIN 形态保证 FTS 驱动，避免本就慢的全表扫）；
    // 含空格/单双字关键词 trigram 不建索引或分词与 LIKE 不一致，退回原 LIKE 语义，结果与旧版一致。
    const useFts = trimmed.length >= 3 && !/\s/.test(trimmed);

    let whereClause: string;
    let queryParams: any[];
    if (useFts) {
      // 短语查询：命中任一索引列中出现的子串；引号内双写转义。
      const ftsQuery = `"${trimmed.replace(/"/g, '""')}"`;
      whereClause = ' WHERE media_fts MATCH ? AND (m.hidden IS NULL OR m.hidden = 0)';
      queryParams = [ftsQuery];
    } else {
      const like = `%${trimmed}%`;
      whereClause = ' WHERE (m.hidden IS NULL OR m.hidden = 0) AND (m.title LIKE ? OR m.alias LIKE ? OR m.original_title LIKE ? OR m.director LIKE ? OR m.cast LIKE ?)';
      queryParams = [like, like, like, like, like];
    }

    if (this.kidModeActive) {
      whereClause += ' AND m.kid_safe = 1';
    }

    if (params.type) {
      whereClause += ' AND m.type = ?';
      queryParams.push(params.type);
    }
    if (params.year) {
      whereClause += ' AND m.year = ?';
      queryParams.push(params.year);
    }
    if (params.area) {
      whereClause += ' AND m.area = ?';
      queryParams.push(params.area);
    }
    if (params.genre) {
      whereClause += ' AND m.genre LIKE ?';
      queryParams.push(`%${params.genre}%`);
    }

    if (useFts) {
      const countResult = await this.db!.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM media_fts f JOIN media m ON m.rowid = f.rowid${whereClause}`,
        queryParams
      );
      const total = countResult?.count || 0;
      const totalPages = Math.ceil(total / pageSize);

      const rows = await this.db!.getAllAsync<any>(
        `SELECT m.* FROM media_fts f JOIN media m ON m.rowid = f.rowid
         ${whereClause}
         ORDER BY m.updated_at DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, pageSize, offset]
      );
      return { items: rows.map(rowToMedia), meta: { page, pageSize, total, totalPages } };
    }

    const countResult = await this.db!.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM media m${whereClause}`,
      queryParams
    );
    const total = countResult?.count || 0;
    const totalPages = Math.ceil(total / pageSize);

    const rows = await this.db!.getAllAsync<any>(
      `SELECT m.* FROM media m
       ${whereClause}
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`,
      [...queryParams, pageSize, offset]
    );

    return { items: rows.map(rowToMedia), meta: { page, pageSize, total, totalPages } };
  }

  async getGenresByType(type?: string): Promise<string[]> {
    let whereClause = 'WHERE genre IS NOT NULL AND genre != \'[]\' AND (hidden IS NULL OR hidden = 0)';
    const params: any[] = [];
    if (type) {
      whereClause += ' AND type = ?';
      params.push(type);
    }
    const rows = await this.db!.getAllAsync<{ genre: string }>(
      `SELECT DISTINCT genre FROM media ${whereClause}`,
      params
    );
    const allGenres = new Set<string>();
    for (const row of rows) {
      try {
        const genres = JSON.parse(row.genre);
        if (Array.isArray(genres)) {
          genres.forEach(g => allGenres.add(g));
        }
      } catch {
        // ignore invalid JSON
      }
    }
    return Array.from(allGenres).sort();
  }

  async getSubTypesByType(type?: string, includeHidden?: boolean, firstOnly?: boolean): Promise<string[]> {
    let whereClause = 'WHERE genre IS NOT NULL AND genre != \'[]\'';
    if (!includeHidden) {
      whereClause += ' AND (hidden IS NULL OR hidden = 0)';
    }
    if (this.kidModeActive) {
      whereClause += ' AND kid_safe = 1';
    }
    const params: any[] = [];
    if (type) {
      whereClause += ' AND type = ?';
      params.push(type);
    }
    if (firstOnly) {
      const rows = await this.db!.getAllAsync<{ genre: string }>(
        `SELECT DISTINCT genre FROM media ${whereClause}`,
        params
      );
      return extractFirstSubtypes(rows.map(row => row.genre));
    }
    const rows = await this.db!.getAllAsync<{ genre: string }>(
      `SELECT DISTINCT genre FROM media ${whereClause}`,
      params
    );
    return expandSubTypes(rows.map(row => row.genre));
  }

  async getYearsByType(type?: string): Promise<number[]> {
    let whereClause = 'WHERE (hidden IS NULL OR hidden = 0)';
    if (this.kidModeActive) {
      whereClause += ' AND kid_safe = 1';
    }
    const params: any[] = [];
    if (type) {
      whereClause += ' AND type = ?';
      params.push(type);
    }
    const dislikedRows = await this.db!.getAllAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM dislike'
    );
    if ((dislikedRows[0]?.count || 0) > 0) {
      whereClause += ' AND id NOT IN (SELECT media_id FROM dislike)';
    }
    const rows = await this.db!.getAllAsync<{ year: number }>(
      `SELECT DISTINCT year FROM media ${whereClause} ORDER BY year DESC`,
      params
    );
    return rows.map(row => row.year);
  }

  async getAreasByType(type?: string): Promise<string[]> {
    let whereClause = 'WHERE area IS NOT NULL AND (hidden IS NULL OR hidden = 0)';
    if (this.kidModeActive) {
      whereClause += ' AND kid_safe = 1';
    }
    const params: any[] = [];
    if (type) {
      whereClause += ' AND type = ?';
      params.push(type);
    }
    const rows = await this.db!.getAllAsync<{ area: string }>(
      `SELECT area FROM media ${whereClause} GROUP BY area ORDER BY COUNT(*) DESC, area`,
      params
    );
    return rows.map(row => row.area);
  }

  async hasShortDrama(type?: string): Promise<boolean> {
    let whereClause = 'WHERE is_short_drama = 1 AND (hidden IS NULL OR hidden = 0)';
    if (this.kidModeActive) {
      whereClause += ' AND kid_safe = 1';
    }
    const params: any[] = [];
    if (type) {
      whereClause += ' AND type = ?';
      params.push(type);
    }
    const result = await this.db!.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM media ${whereClause}`,
      params
    );
    return (result?.count || 0) > 0;
  }

  // —— Episode DAO ——
  async getEpisodesByMediaId(mediaId: number, season?: number, sourceId?: string): Promise<Episode[]> {
    let sql: string;
    const params: any[] = [mediaId];
    if (season !== undefined) {
      sql = 'SELECT * FROM episode WHERE media_id = ? AND season_number = ?';
      params.push(season);
    } else {
      sql = 'SELECT * FROM episode WHERE media_id = ?';
    }
    if (sourceId) {
      sql += ' AND source_id = ?';
      params.push(sourceId);
    }
    sql += ' ORDER BY season_number ASC, episode_number ASC';
    const rows = await this.db!.getAllAsync<any>(sql, params);
    return rows.map(rowToEpisode);
  }

  async getEpisodeSourcesByMediaId(mediaId: number, season?: number): Promise<VideoSource[]> {
    let sql: string;
    const params: any[] = [mediaId];
    if (season !== undefined) {
      sql = `SELECT DISTINCT vs.* FROM video_source vs
             JOIN episode e ON e.source_id = vs.id
             WHERE e.media_id = ? AND e.season_number = ?`;
      params.push(season);
    } else {
      sql = `SELECT DISTINCT vs.* FROM video_source vs
             JOIN episode e ON e.source_id = vs.id
             WHERE e.media_id = ?`;
    }
    sql += ' ORDER BY vs.name ASC';
    const rows = await this.db!.getAllAsync<any>(sql, params);
    return rows.map(rowToVideoSource);
  }

  async getEpisodeById(id: number): Promise<Episode | null> {
    const row = await this.db!.getFirstAsync<any>('SELECT * FROM episode WHERE id = ?', [id]);
    return row ? rowToEpisode(row) : null;
  }

  async upsertEpisode(episode: Episode): Promise<number> {
    await this.db!.runAsync(
      `INSERT INTO episode (media_id, season_number, episode_number, title, duration, source_id)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(media_id, season_number, episode_number, source_id) DO UPDATE SET
         title = excluded.title,
         duration = excluded.duration`,
      [episode.mediaId, episode.seasonNumber, episode.episodeNumber, episode.title || null, episode.duration || null, episode.sourceId || null]
    );
    const row = await this.db!.getFirstAsync<{ id: number }>(
      `SELECT id FROM episode
       WHERE media_id = ? AND season_number = ? AND episode_number = ?
         AND COALESCE(source_id, '') = COALESCE(?, '')
       LIMIT 1`,
      [episode.mediaId, episode.seasonNumber, episode.episodeNumber, episode.sourceId || null]
    );
    return row?.id ?? 0;
  }

  async upsertEpisodesBatch(episodes: Episode[]): Promise<Map<string, number>> {
    const CHUNK = 100;
    for (let i = 0; i < episodes.length; i += CHUNK) {
      const chunk = episodes.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
      const params: any[] = [];
      for (const e of chunk) {
        params.push(e.mediaId, e.seasonNumber, e.episodeNumber, e.title || null, e.duration || null, e.sourceId || null);
      }
      await this.db!.runAsync(
        `INSERT INTO episode (media_id, season_number, episode_number, title, duration, source_id)
         VALUES ${placeholders}
         ON CONFLICT(media_id, season_number, episode_number, source_id) DO UPDATE SET
           title = excluded.title,
           duration = excluded.duration`,
        params
      );
    }
    const mediaIds = Array.from(new Set(episodes.map((e) => e.mediaId)));
    const map = new Map<string, number>();
    if (mediaIds.length === 0) return map;
    const rows = await this.db!.getAllAsync<{ id: number; media_id: number; season_number: number; episode_number: number; source_id: string | null }>(
      `SELECT id, media_id, season_number, episode_number, source_id FROM episode
       WHERE media_id IN (${mediaIds.map(() => '?').join(',')})`,
      mediaIds
    );
    for (const r of rows) {
      map.set(`${r.season_number}:${r.episode_number}:${r.source_id ?? ''}`, r.id);
    }
    return map;
  }

  async updateEpisodeDuration(episodeId: number, duration: number | null): Promise<void> {
    await this.db!.runAsync('UPDATE episode SET duration = ? WHERE id = ?', [duration ?? null, episodeId]);
  }

  async deleteEpisodesByMediaIdAndSourceId(mediaId: number, sourceId: string): Promise<void> {
    await this.db!.runAsync('DELETE FROM episode WHERE media_id = ? AND source_id = ?', [mediaId, sourceId]);
  }

  async deleteAllMedia(): Promise<void> {
    await this.db!.runAsync('DELETE FROM play_source');
    await this.db!.runAsync('DELETE FROM episode');
    await this.db!.runAsync('DELETE FROM media');
    await this.db!.runAsync('DELETE FROM favorite');
    await this.db!.runAsync('DELETE FROM watch_history');
  }

  async deletePlaySourcesBySourceId(sourceId: string): Promise<void> {
    await this.db!.runAsync('DELETE FROM play_source WHERE source_id = ?', [sourceId]);
    await this.db!.runAsync(`DELETE FROM episode WHERE NOT EXISTS (SELECT 1 FROM play_source WHERE play_source.episode_id = episode.id)`);
    await this.db!.runAsync(`DELETE FROM media WHERE NOT EXISTS (SELECT 1 FROM episode WHERE episode.media_id = media.id)`);
    await this.db!.runAsync(`DELETE FROM favorite WHERE NOT EXISTS (SELECT 1 FROM media WHERE media.id = favorite.media_id)`);
    await this.db!.runAsync(`DELETE FROM watch_history WHERE NOT EXISTS (SELECT 1 FROM media WHERE media.id = watch_history.media_id)`);
  }

  async getMediaCountBySourceIdMap(): Promise<Map<string, number>> {
    const rows = await this.db!.getAllAsync<{ sourceId: string; count: number }>(
      `SELECT source_id as sourceId, COUNT(DISTINCT media_id) as count
       FROM episode
       WHERE source_id IS NOT NULL
       GROUP BY source_id`
    );
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.sourceId, row.count);
    }
    return map;
  }

  async deleteMediaCompletely(mediaId: number): Promise<void> {
    await this.db!.runAsync('DELETE FROM play_source WHERE episode_id IN (SELECT id FROM episode WHERE media_id = ?)', [mediaId]);
    await this.db!.runAsync('DELETE FROM episode WHERE media_id = ?', [mediaId]);
    await this.db!.runAsync('DELETE FROM favorite WHERE media_id = ?', [mediaId]);
    await this.db!.runAsync('DELETE FROM watch_history WHERE media_id = ?', [mediaId]);
    await this.db!.runAsync('DELETE FROM media WHERE id = ?', [mediaId]);
  }

  async deleteMediaWithoutPlaySource(): Promise<number> {
    const beforeRows = await this.db!.getAllAsync<{ count: number }>('SELECT COUNT(*) as count FROM media');
    const beforeCount = beforeRows[0]?.count || 0;

    const mediaWithoutPlaySource = await this.db!.getAllAsync<{ id: string }>(
      `SELECT m.id FROM media m 
       WHERE NOT EXISTS (
         SELECT 1 FROM episode e 
         JOIN play_source ps ON e.id = ps.episode_id 
         WHERE e.media_id = m.id
       )`
    );
    
    const countToDelete = mediaWithoutPlaySource.length;
    
    if (countToDelete === 0) {
      return 0;
    }

    const batchSize = 100;
    for (let i = 0; i < mediaWithoutPlaySource.length; i += batchSize) {
      const batch = mediaWithoutPlaySource.slice(i, i + batchSize);
      const ids = batch.map(m => m.id);
      
      await this.db!.runAsync('BEGIN TRANSACTION');
      try {
        await this.db!.runAsync(
          `DELETE FROM media WHERE id IN (${ids.map(() => '?').join(',')})`,
          ids
        );
        await this.db!.runAsync('COMMIT');
      } catch (error) {
        await this.db!.runAsync('ROLLBACK');
        throw error;
      }
    }

    await this.db!.runAsync('BEGIN TRANSACTION');
    try {
      await this.db!.runAsync('DELETE FROM favorite WHERE NOT EXISTS (SELECT 1 FROM media WHERE media.id = favorite.media_id)');
      await this.db!.runAsync('DELETE FROM watch_history WHERE NOT EXISTS (SELECT 1 FROM media WHERE media.id = watch_history.media_id)');
      await this.db!.runAsync('COMMIT');
    } catch (error) {
      await this.db!.runAsync('ROLLBACK');
      throw error;
    }

    const afterRows = await this.db!.getAllAsync<{ count: number }>('SELECT COUNT(*) as count FROM media');
    const afterCount = afterRows[0]?.count || 0;

    return beforeCount - afterCount;
  }

  async deleteNonMediaPlaySources(): Promise<number> {
    const extConditions = MEDIA_FILE_EXTENSIONS.map(ext => `url NOT LIKE '%.${ext}%'`).join(' AND ');
    const beforeRows = await this.db!.getAllAsync<{ count: number }>('SELECT COUNT(*) as count FROM play_source');
    const beforeCount = beforeRows[0]?.count || 0;
    if (beforeCount === 0) return 0;

    await this.db!.runAsync(`DELETE FROM play_source WHERE ${extConditions}`);

    await this.db!.runAsync(`DELETE FROM episode WHERE NOT EXISTS (SELECT 1 FROM play_source WHERE play_source.episode_id = episode.id)`);

    const deletedMedia = await this.deleteMediaWithoutPlaySource();
    if (deletedMedia > 0) {
      console.log(`[deleteNonMediaPlaySources] 顺带删除了 ${deletedMedia} 个无播放源的媒体`);
    }

    const afterRows = await this.db!.getAllAsync<{ count: number }>('SELECT COUNT(*) as count FROM play_source');
    const afterCount = afterRows[0]?.count || 0;
    return beforeCount - afterCount;
  }

  async hideMediaByGenres(genres: string[]): Promise<{ hidden: number }> {
    if (genres.length === 0) return { hidden: 0 };
    const isUncategorized = (g: string) => g === UNCATEGORIZED_GENRE;
    const normalGenres = genres.filter(g => !isUncategorized(g));
    let conditions: string[] = [];
    const params: any[] = [];
    if (normalGenres.length > 0) {
      conditions.push(...normalGenres.map(() => 'genre LIKE ?'));
      params.push(...normalGenres.map(g => `%${g}%`));
    }
    if (genres.some(isUncategorized)) {
      conditions.push("(genre IS NULL OR genre = '' OR genre = '[]' OR json_extract(genre, '$[0]') IS NULL OR json_extract(genre, '$[0]') = '')");
    }
    await this.db!.runAsync(
      `UPDATE media SET hidden = 1 WHERE ${conditions.join(' OR ')}`,
      params
    );
    const now = new Date().toISOString();
    for (const genre of genres) {
      await this.db!.runAsync(
        'INSERT OR IGNORE INTO hidden_genre (sub_type, created_at) VALUES (?, ?)',
        [genre, now]
      );
    }
    const result = await this.db!.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM media WHERE hidden = 1 AND (${conditions.join(' OR ')})`,
      params
    );
    return { hidden: result?.count || 0 };
  }

  async unhideMediaByGenres(genres: string[]): Promise<{ unhidden: number }> {
    if (genres.length === 0) return { unhidden: 0 };
    const isUncategorized = (g: string) => g === UNCATEGORIZED_GENRE;
    const normalGenres = genres.filter(g => !isUncategorized(g));
    let conditions: string[] = [];
    const params: any[] = [];
    if (normalGenres.length > 0) {
      conditions.push(...normalGenres.map(() => 'genre LIKE ?'));
      params.push(...normalGenres.map(g => `%${g}%`));
    }
    if (genres.some(isUncategorized)) {
      conditions.push("(genre IS NULL OR genre = '' OR genre = '[]' OR json_extract(genre, '$[0]') IS NULL OR json_extract(genre, '$[0]') = '')");
    }
    await this.db!.runAsync(
      `UPDATE media SET hidden = 0 WHERE ${conditions.join(' OR ')}`,
      params
    );
    for (const genre of genres) {
      await this.db!.runAsync('DELETE FROM hidden_genre WHERE sub_type = ?', [genre]);
    }
    const result = await this.db!.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM media WHERE hidden = 0 AND (${conditions.join(' OR ')})`,
      params
    );
    return { unhidden: result?.count || 0 };
  }

  async getHiddenGenres(): Promise<string[]> {
    const rows = await this.db!.getAllAsync<{ sub_type: string }>(
      'SELECT sub_type FROM hidden_genre ORDER BY sub_type'
    );
    return rows.map(row => row.sub_type);
  }

  async getHiddenMediaCount(): Promise<number> {
    const result = await this.db!.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM media WHERE hidden = 1'
    );
    return result?.count || 0;
  }

  async syncHiddenByGenres(): Promise<number> {
    // 指纹跳过：hidden_genre 未变化则无需重扫 media（避免每次启动全表扫）
    const genreRows = await this.db!.getAllAsync<{ sub_type: string }>(
      'SELECT sub_type FROM hidden_genre ORDER BY sub_type'
    );
    const fingerprint = JSON.stringify(genreRows.map((r) => r.sub_type));
    const cfgRows = await this.db!.getAllAsync<{ value: string }>(
      "SELECT value FROM system_config WHERE key = 'db.hiddenGenreFingerprint'"
    );
    const existingFp = cfgRows.length > 0 ? cfgRows[0].value : null;
    if (existingFp !== null && existingFp === fingerprint) return 0;

    const uncategorizedCondition =
      "(genre IS NULL OR genre = '' OR genre = '[]' OR json_extract(genre, '$[0]') IS NULL OR json_extract(genre, '$[0]') = '')";
    const whereClause =
      `(hidden IS NULL OR hidden = 0) AND (` +
      `EXISTS (SELECT 1 FROM hidden_genre hg WHERE hg.sub_type != ? AND media.genre LIKE '%' || hg.sub_type || '%')` +
      ` OR (EXISTS (SELECT 1 FROM hidden_genre WHERE sub_type = ?) AND ${uncategorizedCondition})` +
      `)`;
    const params = [UNCATEGORIZED_GENRE, UNCATEGORIZED_GENRE];
    const result = await this.db!.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM media WHERE ${whereClause}`,
      params
    );
    const matched = result?.count || 0;
    if (matched > 0) {
      await this.db!.runAsync(
        `UPDATE media SET hidden = 1 WHERE ${whereClause}`,
        params
      );
    }
    const now = new Date().toISOString();
    await this.db!.runAsync(
      "INSERT INTO system_config (key, value, value_type, created_at, updated_at) VALUES ('db.hiddenGenreFingerprint', ?, 'string', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      [fingerprint, now, now]
    );
    return matched;
  }

  async getUncategorizedCount(type?: string, includeHidden?: boolean): Promise<number> {
    let whereClause = " WHERE (genre IS NULL OR genre = '' OR genre = '[]' OR json_extract(genre, '$[0]') IS NULL OR json_extract(genre, '$[0]') = '')";
    if (!includeHidden) {
      whereClause += ' AND (hidden IS NULL OR hidden = 0)';
    }
    const params: any[] = [];
    if (type) {
      whereClause += ' AND type = ?';
      params.push(type);
    }
    const result = await this.db!.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM media${whereClause}`,
      params
    );
    return result?.count || 0;
  }

  async getSeasonsByMediaId(mediaId: number): Promise<number[]> {
    const rows = await this.db!.getAllAsync<{ season_number: number }>(
      'SELECT DISTINCT season_number FROM episode WHERE media_id = ? ORDER BY season_number ASC',
      [mediaId]
    );
    return rows.map(row => row.season_number);
  }

  // —— PlaySource DAO ——
  async getPlaySourcesByEpisodeId(episodeId: number): Promise<PlaySource[]> {
    const rows = await this.db!.getAllAsync<any>('SELECT * FROM play_source WHERE episode_id = ?', [episodeId]);
    return rows.map(rowToPlaySource);
  }

  async hasVersionEpisodes(mediaId: number, sourceId: string): Promise<boolean> {
    const rows = await this.readDb!.getAllAsync<{ r: number }>(
      `SELECT EXISTS(
         SELECT 1 FROM play_source ps
         JOIN episode e ON e.id = ps.episode_id
         WHERE e.media_id = ? AND e.source_id = ?
           AND ps.language IS NOT NULL AND ps.language <> ''
       ) AS r`,
      [mediaId, sourceId]
    );
    return (rows[0]?.r ?? 0) === 1;
  }

  async getPlaySourceUrlsByMediaAndSource(mediaId: number, sourceId: string): Promise<string[]> {
    const rows = await this.readDb!.getAllAsync<{ url: string }>(
      `SELECT ps.url FROM play_source ps
       JOIN episode e ON e.id = ps.episode_id
       WHERE e.media_id = ? AND e.source_id = ?`,
      [mediaId, sourceId]
    );
    return rows.map((r) => r.url);
  }

  async getPlaySourceLanguagesByMedia(mediaId: number): Promise<{ language: string; episodeId: number; sourceId: string }[]> {
    const rows = await this.readDb!.getAllAsync<{ language: string; episode_id: number; source_id: string }>(
      `SELECT DISTINCT ps.language, e.id AS episode_id, e.source_id
       FROM play_source ps
       JOIN episode e ON e.id = ps.episode_id
       WHERE e.media_id = ? AND ps.language IS NOT NULL AND ps.language <> ''`,
      [mediaId]
    );
    return rows.map((r) => ({ language: r.language, episodeId: r.episode_id, sourceId: r.source_id }));
  }

  async upsertPlaySource(playSource: PlaySource): Promise<void> {
    await this.db!.runAsync(
      `INSERT INTO play_source (episode_id, source_id, source_name, url, quality, language, is_active, fail_count, last_fail_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(episode_id, url) DO UPDATE SET
         quality = excluded.quality,
         language = excluded.language`,
      [
        playSource.episodeId, playSource.sourceId, playSource.sourceName || null,
        playSource.url, playSource.quality || null, playSource.language || null, 1, 0, null,
      ]
    );
  }

  async upsertPlaySourcesBatch(playSources: PlaySource[]): Promise<void> {
    const CHUNK = 100;
    for (let i = 0; i < playSources.length; i += CHUNK) {
      const chunk = playSources.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const params: any[] = [];
      for (const p of chunk) {
        params.push(p.episodeId, p.sourceId, p.sourceName || null, p.url, p.quality || null, p.language || null, 1, 0, null);
      }
      await this.db!.runAsync(
        `INSERT INTO play_source (episode_id, source_id, source_name, url, quality, language, is_active, fail_count, last_fail_at)
         VALUES ${placeholders}
         ON CONFLICT(episode_id, url) DO UPDATE SET
           quality = excluded.quality,
           language = excluded.language`,
        params
      );
    }
  }

  // —— VideoSource DAO ——
  async getAllVideoSources(): Promise<VideoSource[]> {
    const rows = await this.readDb!.getAllAsync<any>('SELECT * FROM video_source ORDER BY id ASC');
    return rows.map(rowToVideoSource);
  }

  async getEnabledVideoSources(): Promise<VideoSource[]> {
    const rows = await this.readDb!.getAllAsync<any>('SELECT * FROM video_source WHERE is_enabled = 1 ORDER BY id ASC');
    return rows.map(rowToVideoSource);
  }

  async getVideoSourceById(id: string): Promise<VideoSource | null> {
    const row = await this.readDb!.getFirstAsync<any>('SELECT * FROM video_source WHERE id = ?', [id]);
    return row ? rowToVideoSource(row) : null;
  }

  async getVideoSourceByCode(code: string): Promise<VideoSource | null> {
    const row = await this.readDb!.getFirstAsync<any>('SELECT * FROM video_source WHERE code = ?', [code]);
    return row ? rowToVideoSource(row) : null;
  }

  async upsertVideoSource(source: VideoSource): Promise<void> {
    await this.db!.runAsync(
      `INSERT INTO video_source (id, code, name, base_url, type, is_enabled, health_status, last_check_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET
         name = excluded.name,
         base_url = excluded.base_url,
         type = excluded.type,
         is_enabled = excluded.is_enabled,
         health_status = excluded.health_status,
         last_check_at = excluded.last_check_at`,
      [source.id, source.code, source.name, source.baseUrl, source.type, source.isEnabled ? 1 : 0, source.healthStatus || null, source.lastCheckAt || null]
    );
  }

  async deleteVideoSource(id: string): Promise<void> {
    await this.db!.runAsync('DELETE FROM video_source WHERE id = ?', [id]);
  }

  async setVideoSourceEnabled(id: string, enabled: boolean): Promise<void> {
    await this.db!.runAsync('UPDATE video_source SET is_enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
  }

  async updateSourceHealth(id: string, data: {
    healthStatus: string;
    lastCheckAt?: string;
    lastSuccessAt?: string;
    failCount?: number;
    avgResponseTime?: number;
  }): Promise<void> {
    const now = new Date().toISOString();
    const updates: string[] = [];
    const params: any[] = [];
    
    updates.push('health_status = ?');
    params.push(data.healthStatus);
    
    updates.push('last_check_at = ?');
    params.push(data.lastCheckAt || now);
    
    if (data.lastSuccessAt) {
      updates.push('last_success_at = ?');
      params.push(data.lastSuccessAt);
    }
    
    if (data.failCount !== undefined) {
      updates.push('fail_count = ?');
      params.push(data.failCount);
    }
    
    if (data.avgResponseTime !== undefined) {
      updates.push('avg_response_time = ?');
      params.push(data.avgResponseTime);
    }
    
    params.push(id);
    
    await this.db!.runAsync(`UPDATE video_source SET ${updates.join(', ')} WHERE id = ?`, params);
  }

  async updateSourceLastCollectedAt(id: string, time: string): Promise<void> {
    await this.db!.runAsync('UPDATE video_source SET last_collected_at = ? WHERE id = ?', [time, id]);
  }

  async updateSourceLastIncrementalCollectedAt(id: string, time: string): Promise<void> {
    await this.db!.runAsync('UPDATE video_source SET last_incremental_collected_at = ? WHERE id = ?', [time, id]);
  }

  async incrementSourceRequestCount(id: string): Promise<void> {
    await this.db!.runAsync('UPDATE video_source SET total_requests = total_requests + 1 WHERE id = ?', [id]);
  }

  async incrementSourceFailCount(id: string): Promise<void> {
    await this.db!.runAsync('UPDATE video_source SET fail_count = fail_count + 1 WHERE id = ?', [id]);
  }

  // —— Favorite DAO ——
  async getAllFavorites(): Promise<Favorite[]> {
    const rows = await this.db!.getAllAsync<any>('SELECT * FROM favorite ORDER BY created_at DESC');
    return rows.map(rowToFavorite);
  }

  async isFavorite(mediaId: number): Promise<boolean> {
    const row = await this.db!.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM favorite WHERE media_id = ?', [mediaId]);
    return (row?.count || 0) > 0;
  }

  async addFavorite(mediaId: number): Promise<void> {
    const now = new Date().toISOString();
    const id = `fav_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    // INSERT OR IGNORE + uq_favorite_media_id UNIQUE 索引兜底：同一 media 重复收藏静默忽略
    await this.db!.runAsync('INSERT OR IGNORE INTO favorite (id, media_id, created_at) VALUES (?, ?, ?)', [id, mediaId, now]);
  }

  async removeFavorite(mediaId: number): Promise<void> {
    await this.db!.runAsync('DELETE FROM favorite WHERE media_id = ?', [mediaId]);
  }

  async toggleFavorite(mediaId: number): Promise<boolean> {
    const isFav = await this.isFavorite(mediaId);
    if (isFav) {
      await this.removeFavorite(mediaId);
      return false;
    } else {
      await this.addFavorite(mediaId);
      return true;
    }
  }

  // —— WatchHistory DAO ——
  async getAllWatchHistory(page: number = 1, pageSize: number = 20): Promise<WatchHistory[]> {
    const offset = (page - 1) * pageSize;
    const rows = await this.db!.getAllAsync<any>(
      'SELECT * FROM watch_history ORDER BY updated_at DESC LIMIT ? OFFSET ?',
      [pageSize, offset]
    );
    return rows.map(rowToWatchHistory);
  }

  async getWatchHistoryCount(): Promise<number> {
    const row = await this.db!.getFirstAsync<{ c: number }>(
      'SELECT COUNT(DISTINCT media_id) AS c FROM watch_history'
    );
    return Number(row?.c ?? 0);
  }

  async getWatchHistoryByEpisodeId(mediaId: number, episodeId: number): Promise<WatchHistory | null> {
    const row = await this.db!.getFirstAsync<any>(
      'SELECT * FROM watch_history WHERE media_id = ? AND episode_id = ? ORDER BY updated_at DESC LIMIT 1',
      [mediaId, episodeId]
    );
    return row ? rowToWatchHistory(row) : null;
  }

  async getAllWatchHistoryByMediaId(mediaId: number): Promise<WatchHistory[]> {
    const rows = await this.db!.getAllAsync<any>(
      'SELECT * FROM watch_history WHERE media_id = ? ORDER BY updated_at DESC',
      [mediaId]
    );
    return rows.map(rowToWatchHistory);
  }

  async upsertWatchHistory(
    mediaId: number,
    episodeId: number | null,
    progress: number,
    duration: number,
    sourceId?: string | null,
    playSourceId?: number | null,
  ): Promise<void> {
    const now = new Date().toISOString();
    const id = `wh_${mediaId}_${episodeId ?? 0}`;
    await this.db!.runAsync(
      `INSERT INTO watch_history (id, media_id, episode_id, progress, duration, source_id, play_source_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         progress = excluded.progress,
         duration = excluded.duration,
         source_id = excluded.source_id,
         play_source_id = excluded.play_source_id,
         updated_at = excluded.updated_at`,
      [id, mediaId, episodeId ?? 0, progress, duration, sourceId ?? null, playSourceId ?? null, now]
    );
  }

  async clearWatchHistory(): Promise<void> {
    await this.db!.runAsync('DELETE FROM watch_history');
    await this.db!.runAsync('DELETE FROM watch_line_progress');
  }

  async deleteWatchHistory(mediaId: number): Promise<void> {
    await this.db!.runAsync('DELETE FROM watch_history WHERE media_id = ?', [mediaId]);
    await this.db!.runAsync('DELETE FROM watch_line_progress WHERE media_id = ?', [mediaId]);
  }

  // —— WatchLineProgress DAO ——
  async getWatchLineProgressByPlaySource(mediaId: number, episodeId: number, playSourceId: number): Promise<WatchHistory | null> {
    const row = await this.db!.getFirstAsync<any>(
      'SELECT * FROM watch_line_progress WHERE media_id = ? AND episode_id = ? AND play_source_id = ? LIMIT 1',
      [mediaId, episodeId, playSourceId]
    );
    return row ? rowToWatchHistory(row) : null;
  }

  async upsertWatchLineProgress(
    mediaId: number,
    episodeId: number,
    playSourceId: number,
    progress: number,
    duration: number,
    sourceId?: string | null,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.db!.runAsync(
      `INSERT INTO watch_line_progress (media_id, episode_id, play_source_id, source_id, progress, duration, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(media_id, episode_id, play_source_id) DO UPDATE SET
         source_id = excluded.source_id,
         progress = excluded.progress,
         duration = excluded.duration,
         updated_at = excluded.updated_at`,
      [mediaId, episodeId, playSourceId, sourceId ?? null, progress, duration, now]
    );
  }

  // —— SearchHistory DAO ——
  async addSearchHistory(keyword: string): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.db!.getFirstAsync<any>('SELECT * FROM search_history WHERE keyword = ?', [keyword]);
    if (existing) {
      await this.db!.runAsync('UPDATE search_history SET count = count + 1, updated_at = ? WHERE keyword = ?', [now, keyword]);
    } else {
      const id = `sh_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      await this.db!.runAsync('INSERT INTO search_history (id, keyword, count, updated_at) VALUES (?, ?, 1, ?)', [id, keyword, now]);
    }
  }

  async getSearchHistory(limit: number = 10): Promise<{ keyword: string; count: number }[]> {
    const rows = await this.db!.getAllAsync<{ keyword: string; count: number }>(
      'SELECT keyword, count FROM search_history ORDER BY updated_at DESC LIMIT ?',
      [limit]
    );
    return rows;
  }

  async getHotSearches(limit: number = 10): Promise<{ keyword: string; count: number }[]> {
    const rows = await this.db!.getAllAsync<{ keyword: string; count: number }>(
      'SELECT keyword, count FROM search_history ORDER BY count DESC LIMIT ?',
      [limit]
    );
    return rows;
  }

  async clearSearchHistory(): Promise<void> {
    await this.db!.runAsync('DELETE FROM search_history');
  }

  async deleteSearchHistory(keyword: string): Promise<void> {
    await this.db!.runAsync('DELETE FROM search_history WHERE keyword = ?', [keyword]);
  }

  async recordImpressions(items: { mediaId: number; shownAt: string }[]): Promise<number[]> {
    if (items.length === 0) return [];
    const placeholders = items.map(() => '(?, ?, ?)').join(', ');
    const params: any[] = [];
    for (const item of items) {
      params.push(item.mediaId, item.shownAt, item.shownAt);
    }
    await this.db!.runAsync(
      `INSERT INTO impression (media_id, shown_count, last_shown_at)
       VALUES ${placeholders}
       ON CONFLICT(media_id) DO UPDATE SET
         shown_count = impression.shown_count + 1,
         last_shown_at = excluded.last_shown_at`,
      params
    );
    const ids = items.map((i) => i.mediaId);
    const rows = await this.db!.getAllAsync<{ media_id: number }>(
      `SELECT media_id FROM impression WHERE shown_count IN (3, 6) AND media_id IN (${ids.map(() => '?').join(', ')})`,
      ids
    );
    return rows.map((r) => r.media_id);
  }

  async replaceUserInterestTags(rows: {
    tag: string;
    tagType: 'genre' | 'director' | 'actor' | 'keyword';
    strength: number;
    sampleCount: number;
    updatedAt: string;
  }[]): Promise<void> {
    await this.db!.runAsync('DELETE FROM user_interest_tag');
    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const placeholders = batch.map(() => '(?, ?, ?, ?, ?)').join(', ');
      const params: any[] = [];
      for (const r of batch) {
        params.push(r.tag, r.tagType, r.strength, r.sampleCount, r.updatedAt);
      }
      await this.db!.runAsync(
        `INSERT INTO user_interest_tag (tag, tag_type, strength, sample_count, updated_at) VALUES ${placeholders}`,
        params
      );
    }
  }

  async replaceRecommendationCandidates(rows: {
    mediaId: number;
    position: number;
    score: number;
    genreGroup: string;
  }[]): Promise<void> {
    await this.db!.runAsync('DELETE FROM recommend_candidates');
    const batchSize = 300;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const placeholders = batch.map(() => '(?, ?, ?, ?)').join(', ');
      const params: any[] = [];
      for (const r of batch) {
        params.push(r.mediaId, r.position, r.score, r.genreGroup);
      }
      await this.db!.runAsync(
        `INSERT INTO recommend_candidates (media_id, position, score, genre_group) VALUES ${placeholders}`,
        params
      );
    }
  }

  async resetRecommendationData(): Promise<void> {
    await this.db!.runAsync('DELETE FROM impression');
    await this.db!.runAsync('DELETE FROM user_interest_tag');
    await this.db!.runAsync('DELETE FROM recommend_candidates');
    await this.db!.runAsync('UPDATE media SET personal_score = 0');
  }

  async getDislikedMediaDetail(): Promise<{ mediaId: number; title: string; createdAt: string }[]> {
    const rows = await this.db!.getAllAsync<{ media_id: number; title: string; created_at: string }>(
      `SELECT d.media_id, COALESCE(m.title, '') AS title, COALESCE(d.created_at, '') AS created_at
       FROM dislike d LEFT JOIN media m ON m.id = d.media_id
       ORDER BY d.created_at DESC`
    );
    return rows.map((r) => ({ mediaId: r.media_id, title: r.title, createdAt: r.created_at }));
  }

  async addDislike(mediaId: number): Promise<void> {
    await this.db!.runAsync(
      'INSERT INTO dislike (media_id, created_at) VALUES (?, ?) ON CONFLICT(media_id) DO UPDATE SET created_at = excluded.created_at',
      [mediaId, new Date().toISOString()]
    );
  }

  async removeDislike(mediaId: number): Promise<void> {
    await this.db!.runAsync('DELETE FROM dislike WHERE media_id = ?', [mediaId]);
  }

  async getInterestTagBlacklist(): Promise<{ tag: string; tagType: string; createdAt: string }[]> {
    const rows = await this.db!.getAllAsync<{ tag: string; tag_type: string; created_at: string }>(
      `SELECT tag, tag_type, COALESCE(created_at, '') AS created_at FROM interest_tag_blacklist ORDER BY created_at DESC`
    );
    return rows.map((r) => ({ tag: r.tag, tagType: r.tag_type, createdAt: r.created_at }));
  }

  async addInterestTagBlacklist(tag: string, tagType: string): Promise<void> {
    await this.db!.runAsync(
      'INSERT INTO interest_tag_blacklist (tag, tag_type, created_at) VALUES (?, ?, ?) ON CONFLICT(tag, tag_type) DO UPDATE SET created_at = excluded.created_at',
      [tag, tagType, new Date().toISOString()]
    );
  }

  async removeInterestTagBlacklist(tag: string, tagType: string): Promise<void> {
    await this.db!.runAsync('DELETE FROM interest_tag_blacklist WHERE tag = ? AND tag_type = ?', [tag, tagType]);
  }

  async createCollectTask(task: CollectTask): Promise<void> {
    await this.db!.runAsync(
      'INSERT INTO collect_task (id, task_id, source_code, source_name, type, status, current_page, total_pages, collected_count, failed_count, error_message, error_type, last_error_page, failed_pages, failed_items, created_at, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        task.id,
        task.taskId,
        task.sourceCode,
        task.sourceName,
        task.type,
        task.status,
        task.currentPage,
        task.totalPages,
        task.collectedCount,
        task.failedCount,
        task.errorMessage || null,
        task.errorType || null,
        task.lastErrorPage ?? null,
        task.failedPages || null,
        task.failedItems || null,
        task.createdAt,
        task.startedAt || null,
        task.completedAt || null,
      ]
    );
  }

  async getCollectTaskById(taskId: string): Promise<CollectTask | null> {
    const row = await this.readDb!.getFirstAsync<any>(
      'SELECT * FROM collect_task WHERE task_id = ?',
      [taskId]
    );
    if (!row) return null;
    return rowToCollectTask(row);
  }

  async getAllCollectTasks(): Promise<CollectTask[]> {
    const rows = await this.readDb!.getAllAsync<any>(
      'SELECT * FROM collect_task ORDER BY created_at DESC'
    );
    return rows.map(rowToCollectTask);
  }

  async getRunningTasksBySourceCode(sourceCode: string): Promise<CollectTask[]> {
    const rows = await this.readDb!.getAllAsync<any>(
      "SELECT * FROM collect_task WHERE source_code = ? AND status IN ('PENDING', 'RUNNING') ORDER BY created_at DESC",
      [sourceCode]
    );
    return rows.map(rowToCollectTask);
  }

  async updateCollectTask(taskId: string, updates: Partial<CollectTask>): Promise<void> {
    const sqlParts: string[] = [];
    const params: any[] = [];

    if (updates.status !== undefined) {
      sqlParts.push('status = ?');
      params.push(updates.status);
    }
    if (updates.currentPage !== undefined) {
      sqlParts.push('current_page = ?');
      params.push(updates.currentPage);
    }
    if (updates.totalPages !== undefined) {
      sqlParts.push('total_pages = ?');
      params.push(updates.totalPages);
    }
    if (updates.collectedCount !== undefined) {
      sqlParts.push('collected_count = ?');
      params.push(updates.collectedCount);
    }
    if (updates.failedCount !== undefined) {
      sqlParts.push('failed_count = ?');
      params.push(updates.failedCount);
    }
    if (updates.errorMessage !== undefined) {
      sqlParts.push('error_message = ?');
      params.push(updates.errorMessage);
    }
    if (updates.errorType !== undefined) {
      sqlParts.push('error_type = ?');
      params.push(updates.errorType);
    }
    if (updates.lastErrorPage !== undefined) {
      sqlParts.push('last_error_page = ?');
      params.push(updates.lastErrorPage);
    }
    if (updates.failedPages !== undefined) {
      sqlParts.push('failed_pages = ?');
      params.push(updates.failedPages);
    }
    if (updates.failedItems !== undefined) {
      sqlParts.push('failed_items = ?');
      params.push(updates.failedItems);
    }
    if (updates.startedAt !== undefined) {
      sqlParts.push('started_at = ?');
      params.push(updates.startedAt);
    }
    if (updates.completedAt !== undefined) {
      sqlParts.push('completed_at = ?');
      params.push(updates.completedAt);
    }

    if (sqlParts.length === 0) return;

    params.push(taskId);
    await this.db!.runAsync(`UPDATE collect_task SET ${sqlParts.join(', ')} WHERE task_id = ?`, params);

    if (updates.status && ['COMPLETED', 'FAILED', 'ABANDONED'].includes(updates.status)) {
      void this.persistCollectPerf(taskId).catch(() => {});
    }
  }

  private async persistCollectPerf(taskId: string): Promise<void> {
    try {
      const task = await this.getCollectTaskById(taskId);
      if (!task) return;
      const endAt = task.completedAt ?? new Date().toISOString();
      const elapsedMs = task.startedAt ? Date.parse(endAt) - Date.parse(task.startedAt) : 0;
      const file = new File(Paths.document, 'collect_perf.json');
      file.write(JSON.stringify({
        updatedAt: new Date().toISOString(),
        taskId: task.taskId,
        sourceCode: task.sourceCode,
        type: task.type,
        status: task.status,
        currentPage: task.currentPage,
        totalPages: task.totalPages,
        collected: task.collectedCount,
        failed: task.failedCount,
        elapsedMs,
        error: task.errorMessage || null,
      }, null, 2));
    } catch (err) {
      console.error('[CollectTask] 写 perf 文件失败:', err);
    }
  }

  async deleteCollectTask(taskId: string): Promise<void> {
    await this.db!.runAsync('DELETE FROM collect_task WHERE task_id = ?', [taskId]);
  }

  async deleteOldTasks(days: number): Promise<void> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    await this.db!.runAsync('DELETE FROM collect_task WHERE created_at < ?', [cutoff]);
  }

  async resetStaleTasks(): Promise<number> {
    const now = new Date().toISOString();
    const result = await this.db!.runAsync(
      `UPDATE collect_task SET
         status = 'FAILED',
         error_message = '应用重启，任务已中断',
         error_type = 'CANCELLED',
         completed_at = ?
       WHERE status IN ('PENDING', 'RUNNING')`,
      [now]
    );
    const affected = result?.changes ?? 0;
    return affected;
  }

  async createReprobeTask(task: CollectTask): Promise<void> {
    await this.db!.runAsync(
      'INSERT INTO collect_task (id, task_id, source_code, source_name, type, status, current_page, total_pages, collected_count, failed_count, probed_count, short_drama_count, long_drama_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        task.id,
        task.taskId,
        task.sourceCode,
        task.sourceName,
        task.type,
        task.status,
        task.currentPage,
        task.totalPages,
        task.collectedCount,
        task.failedCount,
        task.probedCount || 0,
        task.shortDramaCount || 0,
        task.longDramaCount || 0,
        task.createdAt,
      ]
    );
  }

  async updateReprobeTaskProgress(taskId: string, updates: {
    probedCount?: number;
    shortDramaCount?: number;
    longDramaCount?: number;
    status?: string;
  }): Promise<void> {
    const sqlParts: string[] = [];
    const params: any[] = [];

    if (updates.probedCount !== undefined) {
      sqlParts.push('probed_count = ?');
      params.push(updates.probedCount);
    }
    if (updates.shortDramaCount !== undefined) {
      sqlParts.push('short_drama_count = ?');
      params.push(updates.shortDramaCount);
    }
    if (updates.longDramaCount !== undefined) {
      sqlParts.push('long_drama_count = ?');
      params.push(updates.longDramaCount);
    }
    if (updates.status !== undefined) {
      sqlParts.push('status = ?');
      params.push(updates.status);
    }

    if (sqlParts.length === 0) return;

    params.push(taskId);
    await this.db!.runAsync(`UPDATE collect_task SET ${sqlParts.join(', ')} WHERE task_id = ?`, params);
  }

  async getRunningReprobeTask(): Promise<CollectTask | null> {
    const row = await this.db!.getFirstAsync<any>(
      "SELECT * FROM collect_task WHERE type = 'REPROBE' AND status IN ('PENDING', 'RUNNING') ORDER BY created_at DESC LIMIT 1"
    );
    if (!row) return null;
    return rowToCollectTask(row);
  }

  async select<T>(sql: string, params?: any[]): Promise<T[]> {
    return this.db!.getAllAsync<T>(sql, params || []);
  }

  async selectOne<T>(sql: string, params?: any[]): Promise<T | null> {
    return this.db!.getFirstAsync<T>(sql, params || []);
  }

  async execute(sql: string, params?: any[]): Promise<void> {
    await this.db!.runAsync(sql, params || []);
  }

  async withTransactionAsync<T>(fn: () => Promise<T>): Promise<T> {
    const db = this.db!;
    // 使用 expo-sqlite 模块级事务 API（native 维护事务状态），多源并行时经 FIFO 队列串行，
    // 避免手写 execAsync('BEGIN') 造成 SQLiteModule 状态错乱。
    const run = async (): Promise<T> => {
      let result!: T;
      await db.withExclusiveTransactionAsync(async () => {
        result = await fn();
      });
      return result;
    };
    const prev = this.txQueue;
    let release!: () => void;
    this.txQueue = new Promise<void>((res) => { release = res; });
    try {
      // prev.catch 兜底：前序事务 throw 也不会吞掉队列，后续事务照常执行
      return await prev.catch(() => {}).then(run);
    } finally {
      release();
    }
  }
}
