import * as SQLite from 'expo-sqlite';
import {
  PRAGMA_SQL,
  SCHEMA_SQL,
  INSERT_DEFAULT_SOURCE_SQL,
  COUNT_VIDEO_SOURCE_SQL,
  defaultSources,
  splitSqlStatements,
  MEDIA_FILE_EXTENSIONS,
  UNCATEGORIZED_GENRE,
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
  CollectionLog,
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
];

/**
 * DatabaseProvider 的 expo-sqlite 实现（移动端）。
 * SQL 语句与桌面端 TauriSqlProvider 完全一致，仅底层 API 不同。
 */
export class ExpoSqliteProvider implements DatabaseProvider {
  private db: SQLite.SQLiteDatabase | null = null;

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
    const rawDb = await SQLite.openDatabaseAsync('movieapp.db');
    const wrappedDb = this.wrapWithRetry(rawDb);
    this.db = wrappedDb;

    // 执行 PRAGMA（PRAGMA 语句无触发器体，可简单按 ; 拆分）
    const pragmas = PRAGMA_SQL.split(';').map((s: string) => s.trim()).filter(Boolean);
    for (const stmt of pragmas) {
      await wrappedDb.execAsync(stmt);
    }

    await this.runMigrations();
    await this.fixGenreData();
    await this.syncHiddenByGenres();
    
    await this.db!.execAsync('CREATE INDEX IF NOT EXISTS idx_episode_media_id ON episode(media_id);');
    await this.db!.execAsync('CREATE INDEX IF NOT EXISTS idx_play_source_episode_id ON play_source(episode_id);');
    await this.db!.execAsync('CREATE INDEX IF NOT EXISTS idx_play_source_source_id_episode_id ON play_source(source_id, episode_id);');
    await this.db!.execAsync('CREATE INDEX IF NOT EXISTS idx_favorite_media_id ON favorite(media_id);');
    await this.db!.execAsync('CREATE INDEX IF NOT EXISTS idx_watch_history_media_id ON watch_history(media_id);');

    await this.insertDefaultSources();

    // 将历史内置 HTTP 源升级为 HTTPS（iOS ATS 会拦截明文 http）
    await this.upgradeSourceUrlsToHttps();
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
          source.rateLimit,
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
  async getMediaById(id: string): Promise<Media | null> {
    const row = await this.db!.getFirstAsync<any>('SELECT * FROM media WHERE id = ?', [id]);
    return row ? rowToMedia(row) : null;
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
      return { where: ` WHERE ${conditions.join(' AND ')}`, qp };
    };

    // 「为你推荐」：按推荐快照 position 分页；快照为空（冷启动）回退最新序
    if (params.sort === 'recommend') {
      const snapRow = await this.db!.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM recommend_snapshot`
      );
      const hasSnapshot = (snapRow?.count || 0) > 0;
      if (hasSnapshot) {
        const { where, qp } = buildWhere('m');
        const countRow = await this.db!.getFirstAsync<{ count: number }>(
          `SELECT COUNT(*) as count FROM recommend_snapshot rs JOIN media m ON m.id = rs.media_id${where}`,
          qp
        );
        const total = countRow?.count || 0;
        const totalPages = Math.ceil(total / pageSize);
        const rows = await this.db!.getAllAsync<any>(
          `SELECT m.* FROM recommend_snapshot rs JOIN media m ON m.id = rs.media_id${where} ORDER BY rs.position ASC LIMIT ? OFFSET ?`,
          [...qp, pageSize, offset]
        );
        return { items: rows.map(rowToMedia), meta: { page, pageSize, total, totalPages } };
      }
    }

    const { where, qp } = buildWhere('');
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

    const countResult = await this.db!.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM media${where}`,
      qp
    );
    const total = countResult?.count || 0;
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
        id, title, original_title, alias, type, year, area, genre, director, cast,
        description, poster_url, backdrop_url, status, remarks, fingerprint,
        current_episodes, total_episodes, is_short_drama, duration_check_status, episode_duration,
        view_count, rating, rating_count, rating_source, rating_updated_at,
        favorite_count, search_count, hidden, series_group, series_season,
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
        updated_at = excluded.updated_at`,
      [
        media.id, media.title, media.originalTitle || null, media.alias || null,
        media.type, media.year, media.area || null,
        JSON.stringify(media.genres), JSON.stringify(media.directors), JSON.stringify(media.actors),
        media.description || null, media.posterUrl || null, media.backdropUrl || null,
        media.status || null, media.remarks || null, media.fingerprint,
        media.currentEpisodes || null, media.totalEpisodes || null,
        media.isShortDrama ? 1 : 0, media.durationCheckStatus || null, media.episodeDuration || null,
        media.viewCount || 0,
        media.rating ?? null, media.ratingCount ?? null, media.ratingSource || null, media.ratingUpdatedAt || null,
        0, 0, media.hidden ? 1 : 0,
        media.seriesGroup || null, media.seriesSeason ?? null,
        media.createdAt || now, now,
      ]
    );
  }

  async updateMediaStatusAndEpisodes(
    mediaId: string,
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

  async updateMediaPoster(mediaId: string, posterUrl: string | null, updatedAt: string): Promise<void> {
    await this.db!.runAsync(
      `UPDATE media SET poster_url = ?, updated_at = ? WHERE id = ?`,
      [posterUrl, updatedAt, mediaId]
    );
  }

  async updateMediaRating(
    mediaId: string,
    data: { rating: number | null; ratingCount: number | null; source: 'DOUBAN'; updatedAt: string }
  ): Promise<void> {
    await this.db!.runAsync(
      `UPDATE media SET rating = ?, rating_count = ?, rating_source = ?, rating_updated_at = ? WHERE id = ?`,
      [data.rating, data.ratingCount, data.source, data.updatedAt, mediaId]
    );
  }

  async incrementViewCount(id: string): Promise<void> {
    await this.db!.runAsync('UPDATE media SET view_count = view_count + 1 WHERE id = ?', [id]);
  }

  async incrementSearchCount(id: string): Promise<void> {
    await this.db!.runAsync('UPDATE media SET search_count = search_count + 1 WHERE id = ?', [id]);
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

    let whereClause = ' WHERE (m.hidden IS NULL OR m.hidden = 0) AND (m.title LIKE ? OR m.alias LIKE ? OR m.original_title LIKE ? OR m.director LIKE ? OR m.cast LIKE ?)';
    const queryParams: any[] = [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`];

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
    const params: any[] = [];
    if (type) {
      whereClause += ' AND type = ?';
      params.push(type);
    }
    if (firstOnly) {
      const rows = await this.db!.getAllAsync<{ genre: string }>(
        `SELECT genre FROM media ${whereClause}`,
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
    let whereClause = '';
    const params: any[] = [];
    if (type) {
      whereClause = 'WHERE type = ?';
      params.push(type);
    }
    const rows = await this.db!.getAllAsync<{ year: number }>(
      `SELECT DISTINCT year FROM media ${whereClause} ORDER BY year DESC`,
      params
    );
    return rows.map(row => row.year);
  }

  async getAreasByType(type?: string): Promise<string[]> {
    let whereClause = 'WHERE area IS NOT NULL';
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
    let whereClause = 'WHERE is_short_drama = 1';
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
  async getEpisodesByMediaId(mediaId: string, season?: number, sourceId?: string): Promise<Episode[]> {
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

  async getEpisodeSourcesByMediaId(mediaId: string, season?: number): Promise<VideoSource[]> {
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

  async getEpisodeById(id: string): Promise<Episode | null> {
    const row = await this.db!.getFirstAsync<any>('SELECT * FROM episode WHERE id = ?', [id]);
    return row ? rowToEpisode(row) : null;
  }

  async upsertEpisode(episode: Episode): Promise<void> {
    await this.db!.runAsync(
      `INSERT INTO episode (id, media_id, season_number, episode_number, title, duration, source_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         duration = excluded.duration,
         source_id = excluded.source_id`,
      [episode.id, episode.mediaId, episode.seasonNumber, episode.episodeNumber, episode.title || null, episode.duration || null, episode.sourceId || null]
    );
  }

  async deleteEpisodesByMediaIdAndSourceId(mediaId: string, sourceId: string): Promise<void> {
    await this.db!.runAsync('DELETE FROM episode WHERE media_id = ? AND source_id = ?', [mediaId, sourceId]);
  }

  async deleteEpisodesByMediaId(mediaId: string): Promise<void> {
    await this.db!.runAsync('DELETE FROM episode WHERE media_id = ?', [mediaId]);
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

  async getMediaCountBySourceId(sourceId: string): Promise<number> {
    const rows = await this.db!.getAllAsync<{ count: number }>(
      `SELECT COUNT(DISTINCT media_id) as count FROM episode WHERE source_id = ?`,
      [sourceId]
    );
    return rows[0]?.count || 0;
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

  async deleteMediaCompletely(mediaId: string): Promise<void> {
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

  async getSeasonsByMediaId(mediaId: string): Promise<number[]> {
    const rows = await this.db!.getAllAsync<{ season_number: number }>(
      'SELECT DISTINCT season_number FROM episode WHERE media_id = ? ORDER BY season_number ASC',
      [mediaId]
    );
    return rows.map(row => row.season_number);
  }

  // —— PlaySource DAO ——
  async getPlaySourcesByEpisodeId(episodeId: string): Promise<PlaySource[]> {
    const rows = await this.db!.getAllAsync<any>('SELECT * FROM play_source WHERE episode_id = ?', [episodeId]);
    return rows.map(rowToPlaySource);
  }

  async getPlaySourcesByMediaId(mediaId: string): Promise<PlaySource[]> {
    const rows = await this.db!.getAllAsync<any>(
      `SELECT ps.* FROM play_source ps
       INNER JOIN episode e ON ps.episode_id = e.id
       WHERE e.media_id = ?`,
      [mediaId]
    );
    return rows.map(rowToPlaySource);
  }

  async upsertPlaySource(playSource: PlaySource): Promise<void> {
    await this.db!.runAsync(
      `INSERT INTO play_source (id, episode_id, source_id, source_name, url, quality, is_active, fail_count, last_fail_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         url = excluded.url,
         quality = excluded.quality`,
      [
        playSource.id, playSource.episodeId, playSource.sourceId, playSource.sourceName || null,
        playSource.url, playSource.quality || null, 1, 0, null,
      ]
    );
  }

  async deletePlaySourcesByMediaId(mediaId: string): Promise<void> {
    await this.db!.runAsync(
      `DELETE FROM play_source WHERE episode_id IN (SELECT id FROM episode WHERE media_id = ?)`,
      [mediaId]
    );
  }

  async deletePlaySourcesByMediaIdAndSourceId(mediaId: string, sourceId: string): Promise<void> {
    await this.db!.runAsync(
      `DELETE FROM play_source WHERE episode_id IN (SELECT id FROM episode WHERE media_id = ?) AND source_id = ?`,
      [mediaId, sourceId]
    );
  }

  // —— VideoSource DAO ——
  async getAllVideoSources(): Promise<VideoSource[]> {
    const rows = await this.db!.getAllAsync<any>('SELECT * FROM video_source ORDER BY id ASC');
    return rows.map(rowToVideoSource);
  }

  async getEnabledVideoSources(): Promise<VideoSource[]> {
    const rows = await this.db!.getAllAsync<any>('SELECT * FROM video_source WHERE is_enabled = 1 ORDER BY id ASC');
    return rows.map(rowToVideoSource);
  }

  async getVideoSourceById(id: string): Promise<VideoSource | null> {
    const row = await this.db!.getFirstAsync<any>('SELECT * FROM video_source WHERE id = ?', [id]);
    return row ? rowToVideoSource(row) : null;
  }

  async getVideoSourceByCode(code: string): Promise<VideoSource | null> {
    const row = await this.db!.getFirstAsync<any>('SELECT * FROM video_source WHERE code = ?', [code]);
    return row ? rowToVideoSource(row) : null;
  }

  async upsertVideoSource(source: VideoSource): Promise<void> {
    await this.db!.runAsync(
      `INSERT INTO video_source (id, code, name, base_url, type, is_enabled, rate_limit, health_status, last_check_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET
         name = excluded.name,
         base_url = excluded.base_url,
         type = excluded.type,
         is_enabled = excluded.is_enabled,
         rate_limit = excluded.rate_limit,
         health_status = excluded.health_status,
         last_check_at = excluded.last_check_at`,
      [source.id, source.code, source.name, source.baseUrl, source.type, source.isEnabled ? 1 : 0, source.rateLimit, source.healthStatus || null, source.lastCheckAt || null]
    );
  }

  async deleteVideoSource(id: string): Promise<void> {
    await this.db!.runAsync('DELETE FROM video_source WHERE id = ?', [id]);
  }

  async setVideoSourceEnabled(id: string, enabled: boolean): Promise<void> {
    await this.db!.runAsync('UPDATE video_source SET is_enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
  }

  async updateSourceRateLimit(id: string, rateLimit: number): Promise<void> {
    await this.db!.runAsync('UPDATE video_source SET rate_limit = ? WHERE id = ?', [rateLimit, id]);
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

  async isFavorite(mediaId: string): Promise<boolean> {
    const row = await this.db!.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM favorite WHERE media_id = ?', [mediaId]);
    return (row?.count || 0) > 0;
  }

  async addFavorite(mediaId: string): Promise<void> {
    const now = new Date().toISOString();
    const id = `fav_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    await this.db!.runAsync('INSERT INTO favorite (id, media_id, created_at) VALUES (?, ?, ?)', [id, mediaId, now]);
  }

  async removeFavorite(mediaId: string): Promise<void> {
    await this.db!.runAsync('DELETE FROM favorite WHERE media_id = ?', [mediaId]);
  }

  async toggleFavorite(mediaId: string): Promise<boolean> {
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

  async getWatchHistoryByMediaId(mediaId: string): Promise<WatchHistory | null> {
    const row = await this.db!.getFirstAsync<any>(
      'SELECT * FROM watch_history WHERE media_id = ? ORDER BY updated_at DESC LIMIT 1',
      [mediaId]
    );
    return row ? rowToWatchHistory(row) : null;
  }

  async getWatchHistoryByEpisodeId(mediaId: string, episodeId: string): Promise<WatchHistory | null> {
    const row = await this.db!.getFirstAsync<any>(
      'SELECT * FROM watch_history WHERE media_id = ? AND episode_id = ? ORDER BY updated_at DESC LIMIT 1',
      [mediaId, episodeId]
    );
    return row ? rowToWatchHistory(row) : null;
  }

  async getAllWatchHistoryByMediaId(mediaId: string): Promise<WatchHistory[]> {
    const rows = await this.db!.getAllAsync<any>(
      'SELECT * FROM watch_history WHERE media_id = ? ORDER BY updated_at DESC',
      [mediaId]
    );
    return rows.map(rowToWatchHistory);
  }

  async upsertWatchHistory(
    mediaId: string,
    episodeId: string | null,
    progress: number,
    duration: number,
    sourceId?: string | null,
    playSourceId?: string | null,
  ): Promise<void> {
    const now = new Date().toISOString();
    const id = `wh_${mediaId}_${episodeId || 'movie'}`;
    await this.db!.runAsync(
      `INSERT INTO watch_history (id, media_id, episode_id, progress, duration, source_id, play_source_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         progress = excluded.progress,
         duration = excluded.duration,
         source_id = excluded.source_id,
         play_source_id = excluded.play_source_id,
         updated_at = excluded.updated_at`,
      [id, mediaId, episodeId, progress, duration, sourceId ?? null, playSourceId ?? null, now]
    );
  }

  async clearWatchHistory(): Promise<void> {
    await this.db!.runAsync('DELETE FROM watch_history');
  }

  async deleteWatchHistory(mediaId: string): Promise<void> {
    await this.db!.runAsync('DELETE FROM watch_history WHERE media_id = ?', [mediaId]);
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

  async recordImpressions(items: { mediaId: string; shownAt: string }[]): Promise<string[]> {
    if (items.length === 0) return [];
    const placeholders = items.map(() => '(?, ?, ?)').join(', ');
    const params: any[] = [];
    for (const item of items) {
      params.push(item.mediaId, item.shownAt, item.shownAt);
    }
    await this.db!.runAsync(
      `INSERT INTO impression (media_id, shown_count, first_shown_at, last_shown_at)
       VALUES ${placeholders}
       ON CONFLICT(media_id) DO UPDATE SET
         shown_count = impression.shown_count + 1,
         last_shown_at = excluded.last_shown_at`,
      params
    );
    const ids = items.map((i) => i.mediaId);
    const rows = await this.db!.getAllAsync<{ media_id: string }>(
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

  async replaceRecommendationSnapshot(rows: {
    mediaId: string;
    position: number;
    score: number;
    genreGroup: string;
  }[]): Promise<void> {
    await this.db!.runAsync('DELETE FROM recommend_snapshot');
    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const placeholders = batch.map(() => '(?, ?, ?, ?)').join(', ');
      const params: any[] = [];
      for (const r of batch) {
        params.push(r.mediaId, r.position, r.score, r.genreGroup);
      }
      await this.db!.runAsync(
        `INSERT INTO recommend_snapshot (media_id, position, score, genre_group) VALUES ${placeholders}`,
        params
      );
    }
  }

  async resetRecommendationData(): Promise<void> {
    await this.db!.runAsync('DELETE FROM impression');
    await this.db!.runAsync('DELETE FROM user_interest_tag');
    await this.db!.runAsync('DELETE FROM recommend_snapshot');
    await this.db!.runAsync('UPDATE media SET personal_score = 0');
  }

  async getDislikedMediaIds(): Promise<string[]> {
    const rows = await this.db!.getAllAsync<{ media_id: string }>('SELECT media_id FROM dislike');
    return rows.map((r) => r.media_id);
  }

  async getDislikedMediaDetail(): Promise<{ mediaId: string; title: string; createdAt: string }[]> {
    const rows = await this.db!.getAllAsync<{ media_id: string; title: string; created_at: string }>(
      `SELECT d.media_id, COALESCE(m.title, '') AS title, COALESCE(d.created_at, '') AS created_at
       FROM dislike d LEFT JOIN media m ON m.id = d.media_id
       ORDER BY d.created_at DESC`
    );
    return rows.map((r) => ({ mediaId: r.media_id, title: r.title, createdAt: r.created_at }));
  }

  async addDislike(mediaId: string): Promise<void> {
    await this.db!.runAsync(
      'INSERT INTO dislike (media_id, created_at) VALUES (?, ?) ON CONFLICT(media_id) DO UPDATE SET created_at = excluded.created_at',
      [mediaId, new Date().toISOString()]
    );
  }

  async removeDislike(mediaId: string): Promise<void> {
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
      'INSERT INTO collect_task (id, task_id, source_code, source_name, type, status, current_page, total_pages, collected_count, failed_count, error_message, error_type, last_error_page, created_at, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
        task.createdAt,
        task.startedAt || null,
        task.completedAt || null,
      ]
    );
  }

  async getCollectTaskById(taskId: string): Promise<CollectTask | null> {
    const row = await this.db!.getFirstAsync<any>(
      'SELECT * FROM collect_task WHERE task_id = ?',
      [taskId]
    );
    if (!row) return null;
    return rowToCollectTask(row);
  }

  async getAllCollectTasks(): Promise<CollectTask[]> {
    const rows = await this.db!.getAllAsync<any>(
      'SELECT * FROM collect_task ORDER BY created_at DESC'
    );
    return rows.map(rowToCollectTask);
  }

  async getRunningTasksBySourceCode(sourceCode: string): Promise<CollectTask[]> {
    const rows = await this.db!.getAllAsync<any>(
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
    const staleTasks = await this.db!.getAllAsync<any>(
      "SELECT task_id, source_code, created_at FROM collect_task WHERE status IN ('PENDING', 'RUNNING')"
    );
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
    if (affected > 0) {
      for (const task of staleTasks) {
        await this.db!.runAsync(
          'INSERT INTO collection_log (id, timestamp, level, message, task_id, source_code, details) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            now,
            'warn',
            `重置残留任务: task=${task.task_id}, source=${task.source_code}, created_at=${task.created_at}`,
            task.task_id,
            task.source_code,
            JSON.stringify({ action: 'resetStaleTasks', taskId: task.task_id, sourceCode: task.source_code, createdAt: task.created_at, resetAt: now }),
          ]
        );
      }
    }
    return affected;
  }

  async cancelCollectTask(taskId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db!.runAsync(
      `UPDATE collect_task SET
         status = 'FAILED',
         error_message = '用户已取消',
         error_type = 'CANCELLED',
         completed_at = ?
       WHERE task_id = ?`,
      [now, taskId]
    );
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

  async addCollectionLog(log: CollectionLog): Promise<void> {
    await this.db!.runAsync(
      'INSERT INTO collection_log (id, timestamp, level, message, task_id, source_code, source_name, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [log.id, log.timestamp, log.level, log.message, log.taskId || null, log.sourceCode || null, log.sourceName || null, log.details || null]
    );
  }

  async getCollectionLogs(filter?: { taskId?: string; sourceCode?: string; level?: string; limit?: number; offset?: number }): Promise<CollectionLog[]> {
    let sql = 'SELECT * FROM collection_log WHERE 1=1';
    const params: any[] = [];

    if (filter?.taskId) { sql += ' AND task_id = ?'; params.push(filter.taskId); }
    if (filter?.sourceCode) { sql += ' AND source_code = ?'; params.push(filter.sourceCode); }
    if (filter?.level) { sql += ' AND level = ?'; params.push(filter.level); }

    sql += ' ORDER BY timestamp DESC';

    if (filter?.limit) { sql += ' LIMIT ?'; params.push(filter.limit); }
    if (filter?.offset) { sql += ' OFFSET ?'; params.push(filter.offset); }

    const rows = await this.db!.getAllAsync<any>(sql, params);
    return rows.map((row: any) => ({
      id: row.id,
      timestamp: row.timestamp,
      level: row.level,
      message: row.message,
      taskId: row.task_id || undefined,
      sourceCode: row.source_code || undefined,
      sourceName: row.source_name || undefined,
      details: row.details || undefined,
    }));
  }

  async clearCollectionLogs(beforeDays?: number): Promise<void> {
    if (beforeDays) {
      const cutoff = new Date(Date.now() - beforeDays * 86400000).toISOString();
      await this.db!.runAsync('DELETE FROM collection_log WHERE timestamp < ?', [cutoff]);
    } else {
      await this.db!.runAsync('DELETE FROM collection_log');
    }
  }

  async getVoiceConfig(key: string): Promise<string | null> {
    const row = await this.db!.getFirstAsync<any>('SELECT value FROM voice_config WHERE key = ?', [key]);
    return row ? row.value : null;
  }

  async setVoiceConfig(key: string, value: string, valueType: string = 'string'): Promise<void> {
    const now = new Date().toISOString();
    await this.db!.runAsync(
      'INSERT OR REPLACE INTO voice_config (key, value, value_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [key, value, valueType, now, now]
    );
  }

  async deleteVoiceConfig(key: string): Promise<void> {
    await this.db!.runAsync('DELETE FROM voice_config WHERE key = ?', [key]);
  }

  async getAllVoiceConfig(): Promise<Record<string, string>> {
    const rows = await this.db!.getAllAsync<any>('SELECT key, value FROM voice_config');
    const config: Record<string, string> = {};
    for (const row of rows) {
      config[row.key] = row.value;
    }
    return config;
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
}
