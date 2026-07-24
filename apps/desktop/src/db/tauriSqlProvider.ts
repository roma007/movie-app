import Database from '@tauri-apps/plugin-sql';
import {
  SCHEMA_SQL,
  INSERT_DEFAULT_SOURCE_SQL,
  COUNT_VIDEO_SOURCE_SQL,
  defaultSources,
  splitSqlStatements,
  rowToMedia,
  rowToEpisode,
  rowToPlaySource,
  rowToVideoSource,
  rowToFavorite,
  rowToWatchHistory,
  rowToCollectTask,
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

/**
 * DatabaseProvider 的 tauri-plugin-sql 实现（桌面端）。
 * SQL 语句与移动端 ExpoSqliteProvider 共享 schema.ts，仅底层 API 不同：
 *   - schema 由 TypeScript 层管理（幂等 DDL），不再使用 Rust 迁移
 *   - 单行查询用 select 返回数组的 [0]，对应移动端 getFirstAsync
 *   - 多行查询直接用 select 返回数组，对应移动端 getAllAsync
 *   - 写入用 execute，对应移动端 runAsync
 */
export class TauriSqlProvider implements DatabaseProvider {
  private db: InstanceType<typeof Database> | null = null;

  private wrapWithRetry(db: any): any {
    const originalExecute = db.execute.bind(db);
    const originalSelect = db.select.bind(db);

    const isLockError = (error: any): boolean => {
      const msg = (error?.message || String(error)).toLowerCase();
      return msg.includes('database is locked') || msg.includes('code: 5') || msg.includes('busy');
    };

    let inTransaction = false;

    const executeWithRetry = async (sql: string, params?: any[]) => {
      const trimmedSql = sql.trim().toUpperCase();
      if (trimmedSql.startsWith('BEGIN')) {
        inTransaction = true;
      } else if (trimmedSql.startsWith('COMMIT') || trimmedSql.startsWith('ROLLBACK')) {
        inTransaction = false;
      }

      if (inTransaction) {
        return await originalExecute(sql, params);
      }

      let lastError: Error | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          return await originalExecute(sql, params);
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

    const selectWithRetry = async (sql: string, params?: any[]) => {
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          return await originalSelect(sql, params);
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

    return new Proxy(db, {
      get(target, prop) {
        if (prop === 'execute') return executeWithRetry;
        if (prop === 'select') return selectWithRetry;
        return (target as any)[prop];
      },
    });
  }

  async init(): Promise<void> {
    if (this.db) return;

    // 1. 加载数据库连接
    try {
      const sqlModule = await import('@tauri-apps/plugin-sql');
      const SqlDatabase = sqlModule.default || sqlModule;
      const rawDb = await SqlDatabase.load('sqlite:movieapp.db');
      this.db = this.wrapWithRetry(rawDb);
      console.log('Database loaded successfully');
    } catch (error) {
      console.error('Failed to load database:', error);
      throw error;
    }

    // 2. PRAGMA 设置
    await this.db!.execute('PRAGMA journal_mode = WAL;');
    await this.db!.execute('PRAGMA foreign_keys = ON;');
    await this.db!.execute('PRAGMA busy_timeout = 5000;');
    await this.db!.execute('PRAGMA synchronous = NORMAL;');
    await this.db!.execute('PRAGMA cache_size = -20000;');

    // 3. 检测并清理旧数据库（经历过 Rust 迁移的数据库）
    await this.migrateFromOldSchema();

    // 4. 执行完整 schema（幂等，全部 IF NOT EXISTS）
    await this.initSchema();

    // 5. 插入默认视频源
    await this.insertDefaultSources();
  }

  /**
   * 检测旧数据库（含 _sqlx_migrations 表），清空所有表和索引，
   * 以便后续 initSchema() 用共享 schema 重建完整结构。
   */
  private async migrateFromOldSchema(): Promise<void> {
    const rows = await this.db!.select<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='_sqlx_migrations'"
    );

    if (rows.length === 0) return; // 新数据库或已迁移，无需处理

    console.log('Detected old schema with _sqlx_migrations, resetting database...');

    // 先删除 FTS5 触发器和虚拟表（必须在删除 media 表之前）
    await this.db!.execute('DROP TRIGGER IF EXISTS media_ai');
    await this.db!.execute('DROP TRIGGER IF EXISTS media_ad');
    await this.db!.execute('DROP TRIGGER IF EXISTS media_au');
    await this.db!.execute('DROP TABLE IF EXISTS media_fts');
    await this.db!.execute('DROP TABLE IF EXISTS media_fts_data');
    await this.db!.execute('DROP TABLE IF EXISTS media_fts_idx');
    await this.db!.execute('DROP TABLE IF EXISTS media_fts_content');
    await this.db!.execute('DROP TABLE IF EXISTS media_fts_docsize');

    // 获取所有用户表名（排除 sqlite 内部表）
    const tables = await this.db!.select<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );
    for (const table of tables) {
      await this.db!.execute(`DROP TABLE IF EXISTS "${table.name}"`);
    }

    // 删除索引
    const indexes = await this.db!.select<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"
    );
    for (const idx of indexes) {
      await this.db!.execute(`DROP INDEX IF EXISTS "${idx.name}"`);
    }

    // 删除触发器
    const triggers = await this.db!.select<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='trigger'"
    );
    for (const trig of triggers) {
      await this.db!.execute(`DROP TRIGGER IF EXISTS "${trig.name}"`);
    }

    console.log('Old schema cleaned up successfully');
  }

  /**
   * 使用共享 schema（schema.ts）执行幂等 DDL，确保所有表、FTS5、触发器、索引存在。
   * 对于全新数据库：创建所有结构。
   * 对于已清理的旧数据库：重新创建所有结构。
   * 对于已完整的数据库：全部 IF NOT EXISTS 跳过，无副作用。
   */
  private async initSchema(): Promise<void> {
    // 执行共享 schema（CREATE TABLE IF NOT EXISTS + 索引）
    // 跳过 FTS5 相关语句（虚拟表 + 触发器），由 rebuildFts5() 统一创建
    for (const stmt of splitSqlStatements(SCHEMA_SQL)) {
      if (stmt.includes('media_fts')) continue;
      try {
        await this.db!.execute(stmt);
      } catch (e) {
        console.warn('Schema statement failed:', stmt, e);
      }
    }

    // 增量迁移：为已有 media 表补齐 series_group / series_season 列
    await this.addColumnIfMissing('media', 'series_group', 'TEXT');
    await this.addColumnIfMissing('media', 'series_season', 'INTEGER');

    // 始终重建 FTS5：确保虚拟表和辅助表状态一致，不受历史损坏影响
    await this.rebuildFts5();

    // 补齐 collect_task 表（schema.ts 中未包含，桌面端专用）
    await this.db!.execute(`CREATE TABLE IF NOT EXISTS collect_task (
      id TEXT PRIMARY KEY,
      task_id TEXT UNIQUE NOT NULL,
      source_code TEXT NOT NULL,
      source_name TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      current_page INTEGER DEFAULT 0,
      total_pages INTEGER DEFAULT 0,
      collected_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      error_message TEXT,
      error_type TEXT,
      last_error_page INTEGER,
      failed_pages TEXT,
      probed_count INTEGER DEFAULT 0,
      short_drama_count INTEGER DEFAULT 0,
      long_drama_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );`);
  }

  /**
   * 若表已存在但缺少指定列，则通过 ALTER TABLE ADD COLUMN 补齐。
   * 用 PRAGMA table_info 检测，不存在则添加，已存在则静默跳过。
   */
  private async addColumnIfMissing(table: string, column: string, type: string): Promise<void> {
    const cols = await this.db!.select<{ name: string }[]>(
      `PRAGMA table_info(${table})`
    );
    if (cols.some(c => c.name === column)) return;
    await this.db!.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }

  /**
   * Drop 并重建 media_fts 虚拟表及其触发器，然后从 media 表重建索引。
   * 每次启动时调用，确保 FTS5 虚拟表和辅助表状态一致。
   *
   * 3 阶段策略：
   *   1. 检测 FTS5 是否可用，可用则跳过（正常启动零开销）。
   *   2. 尝试常规 DROP（辅助表 + 虚拟表）。
   *   3. 若 DROP 失败（孤立虚拟表），用 writable_schema 清理 sqlite_master 后重建。
   */
  private async rebuildFts5(): Promise<void> {
    // ── 阶段 1：检测 FTS5 是否可用 ──
    try {
      await this.db!.execute('SELECT count(*) FROM media_fts LIMIT 1');
      return; // FTS5 正常，跳过重建
    } catch {
      // FTS5 不可用，继续修复
    }

    // ── 阶段 2：尝试常规清理 ──
    let needWritableView = false;
    try {
      // 先删触发器
      await this.db!.execute('DROP TRIGGER IF EXISTS media_ai');
      await this.db!.execute('DROP TRIGGER IF EXISTS media_ad');
      await this.db!.execute('DROP TRIGGER IF EXISTS media_au');

      // 再删辅助表（普通表，DROP 一定成功）
      await this.db!.execute('DROP TABLE IF EXISTS media_fts_data');
      await this.db!.execute('DROP TABLE IF EXISTS media_fts_idx');
      await this.db!.execute('DROP TABLE IF EXISTS media_fts_content');
      await this.db!.execute('DROP TABLE IF EXISTS media_fts_docsize');

      // 最后删虚拟表
      await this.db!.execute('DROP TABLE IF EXISTS media_fts');
    } catch {
      // DROP 失败 —— 孤立虚拟表（辅助表缺失，xConnect 无法调用）
      needWritableView = true;
    }

    // ── 阶段 3：修复孤立虚拟表 ──
    if (needWritableView) {
      await this.db!.execute('PRAGMA writable_schema = ON');
      await this.db!.execute("DELETE FROM sqlite_master WHERE type='table' AND name LIKE 'media_fts%'");
      await this.db!.execute('PRAGMA writable_schema = OFF');
      await this.db!.execute('PRAGMA integrity_check');
    }

    // ── 阶段 4：重建 FTS5 虚拟表 + 触发器 + 索引 ──
    await this.db!.execute(
      `CREATE VIRTUAL TABLE IF NOT EXISTS media_fts USING fts5(
        title, alias, original_title, director, cast,
        content='media',
        content_rowid='rowid'
      )`
    );

    await this.db!.execute(`CREATE TRIGGER IF NOT EXISTS media_ai AFTER INSERT ON media BEGIN
      INSERT INTO media_fts(rowid, title, alias, original_title, director, cast)
      VALUES (new.rowid, new.title, new.alias, new.original_title, new.director, new.cast);
    END;`);
    await this.db!.execute(`CREATE TRIGGER IF NOT EXISTS media_ad AFTER DELETE ON media BEGIN
      INSERT INTO media_fts(media_fts, rowid, title, alias, original_title, director, cast)
      VALUES ('delete', old.rowid, old.title, old.alias, old.original_title, old.director, old.cast);
    END;`);
    await this.db!.execute(`CREATE TRIGGER IF NOT EXISTS media_au AFTER UPDATE ON media BEGIN
      INSERT INTO media_fts(media_fts, rowid, title, alias, original_title, director, cast)
      VALUES ('delete', old.rowid, old.title, old.alias, old.original_title, old.director, old.cast);
      INSERT INTO media_fts(rowid, title, alias, original_title, director, cast)
      VALUES (new.rowid, new.title, new.alias, new.original_title, new.director, new.cast);
    END;`);

    await this.db!.execute(`INSERT INTO media_fts(media_fts) VALUES('rebuild')`);
  }

  private async insertDefaultSources(): Promise<void> {
    const rows = await this.db!.select<{ count: number }[]>(COUNT_VIDEO_SOURCE_SQL);
    if ((rows[0]?.count ?? 0) === 0) {
      const now = new Date().toISOString();
      for (const source of defaultSources) {
        await this.db!.execute(INSERT_DEFAULT_SOURCE_SQL, [
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

  // —— Media DAO ——
  async getMediaById(id: string): Promise<Media | null> {
    const rows = await this.db!.select<any[]>('SELECT * FROM media WHERE id = ?', [id]);
    return rows[0] ? rowToMedia(rows[0]) : null;
  }

  async getMediaByFingerprint(fingerprint: string): Promise<Media | null> {
    const rows = await this.db!.select<any[]>('SELECT * FROM media WHERE fingerprint = ?', [fingerprint]);
    return rows[0] ? rowToMedia(rows[0]) : null;
  }

  async getMediaBySeriesGroup(groupKey: string): Promise<Media[]> {
    const rows = await this.db!.select<any[]>('SELECT * FROM media WHERE series_group = ? ORDER BY series_season ASC', [groupKey]);
    return rows.map(rowToMedia);
  }

  async listMedia(params: ListParams = {}): Promise<PaginatedResponse<Media>> {
    const page = params.page || 1;
    const pageSize = params.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let whereClause = ' WHERE (hidden IS NULL OR hidden = 0)';
    const queryParams: any[] = [];
    if (params.type) {
      whereClause += ' AND type = ?';
      queryParams.push(params.type);
    }
    if (params.year) {
      whereClause += ' AND year = ?';
      queryParams.push(params.year);
    }
    if (params.area) {
      whereClause += ' AND area = ?';
      queryParams.push(params.area);
    }
    if (params.genre) {
      whereClause += ' AND genre LIKE ?';
      queryParams.push(`%${params.genre}%`);
    }
    if (params.subType) {
      whereClause += ' AND json_extract(genre, \'$[0]\') = ?';
      queryParams.push(params.subType);
    }
    if (params.isShortDrama !== undefined) {
      whereClause += ' AND is_short_drama = ?';
      queryParams.push(params.isShortDrama ? 1 : 0);
    }

    let orderBy: string;
    switch (params.sort) {
      case 'hot':
        orderBy = 'view_count DESC, updated_at DESC';
        break;
      case 'rating':
        orderBy = 'favorite_count DESC, view_count DESC';
        break;
      case 'year':
        orderBy = 'year DESC, updated_at DESC';
        break;
      case 'latest':
      default:
        orderBy = 'updated_at DESC';
        break;
    }

    const countRows = await this.db!.select<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM media${whereClause}`,
      queryParams
    );
    const total = countRows[0]?.count || 0;
    const totalPages = Math.ceil(total / pageSize);

    const rows = await this.db!.select<any[]>(
      `SELECT * FROM media${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...queryParams, pageSize, offset]
    );

    return { items: rows.map(rowToMedia), meta: { page, pageSize, total, totalPages } };
  }

  async upsertMedia(media: Media): Promise<void> {
    const now = new Date().toISOString();
    await this.db!.execute(
      `INSERT INTO media (
        id, title, original_title, alias, type, year, area, genre, director, cast,
        description, poster_url, backdrop_url, status, remarks, fingerprint,
        current_episodes, total_episodes, is_short_drama, duration_check_status, episode_duration,
        view_count, favorite_count, search_count, hidden, series_group, series_season,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        media.viewCount || 0, 0, 0, media.hidden ? 1 : 0,
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
    await this.db!.execute(
      `UPDATE media SET status = ?, current_episodes = ?, total_episodes = ?, updated_at = ? WHERE id = ?`,
      [status, currentEpisodes, totalEpisodes, updatedAt, mediaId]
    );
  }

  async incrementViewCount(id: string): Promise<void> {
    await this.db!.execute('UPDATE media SET view_count = view_count + 1 WHERE id = ?', [id]);
  }

  async incrementSearchCount(id: string): Promise<void> {
    await this.db!.execute('UPDATE media SET search_count = search_count + 1 WHERE id = ?', [id]);
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

    const countRows = await this.db!.select<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM media m${whereClause}`,
      queryParams
    );
    const total = countRows[0]?.count || 0;
    const totalPages = Math.ceil(total / pageSize);

    const rows = await this.db!.select<any[]>(
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
    const rows = await this.db!.select<{ genre: string }[]>(
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

  async getSubTypesByType(type?: string, includeHidden?: boolean): Promise<string[]> {
    let whereClause = 'WHERE genre IS NOT NULL AND genre != \'[]\' AND json_extract(genre, \'$[0]\') IS NOT NULL AND json_extract(genre, \'$[0]\') != \'\'';
    if (!includeHidden) {
      whereClause += ' AND (hidden IS NULL OR hidden = 0)';
    }
    const params: any[] = [];
    if (type) {
      whereClause += ' AND type = ?';
      params.push(type);
    }
    const rows = await this.db!.select<{ sub_type: string }[]>(
      `SELECT DISTINCT json_extract(genre, '$[0]') as sub_type FROM media ${whereClause} ORDER BY sub_type`,
      params
    );
    return rows.map(row => row.sub_type);
  }

  async getYearsByType(type?: string): Promise<number[]> {
    let whereClause = '';
    const params: any[] = [];
    if (type) {
      whereClause = 'WHERE type = ?';
      params.push(type);
    }
    const rows = await this.db!.select<{ year: number }[]>(
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
    const rows = await this.db!.select<{ area: string }[]>(
      `SELECT DISTINCT area FROM media ${whereClause} ORDER BY area`,
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
    const rows = await this.db!.select<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM media ${whereClause}`,
      params
    );
    return (rows[0]?.count || 0) > 0;
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
    const rows = await this.db!.select<any[]>(sql, params);
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
    const rows = await this.db!.select<any[]>(sql, params);
    return rows.map(rowToVideoSource);
  }

  async getEpisodeById(id: string): Promise<Episode | null> {
    const rows = await this.db!.select<any[]>('SELECT * FROM episode WHERE id = ?', [id]);
    return rows[0] ? rowToEpisode(rows[0]) : null;
  }

  async upsertEpisode(episode: Episode): Promise<void> {
    await this.db!.execute(
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
    await this.db!.execute('DELETE FROM episode WHERE media_id = ? AND source_id = ?', [mediaId, sourceId]);
  }

  async deleteEpisodesByMediaId(mediaId: string): Promise<void> {
    await this.db!.execute('DELETE FROM episode WHERE media_id = ?', [mediaId]);
  }

  async deleteAllMedia(): Promise<void> {
    await this.db!.execute('DELETE FROM play_source');
    await this.db!.execute('DELETE FROM episode');
    await this.db!.execute('DELETE FROM media');
    await this.db!.execute('DELETE FROM favorite');
    await this.db!.execute('DELETE FROM watch_history');
  }

  async deletePlaySourcesBySourceId(sourceId: string): Promise<void> {
    await this.db!.execute('DELETE FROM play_source WHERE source_id = ?', [sourceId]);
    await this.db!.execute(`DELETE FROM episode WHERE NOT EXISTS (SELECT 1 FROM play_source WHERE play_source.episode_id = episode.id)`);
    await this.db!.execute(`DELETE FROM media WHERE NOT EXISTS (SELECT 1 FROM episode WHERE episode.media_id = media.id)`);
    await this.db!.execute(`DELETE FROM favorite WHERE NOT EXISTS (SELECT 1 FROM media WHERE media.id = favorite.media_id)`);
    await this.db!.execute(`DELETE FROM watch_history WHERE NOT EXISTS (SELECT 1 FROM media WHERE media.id = watch_history.media_id)`);
  }

  async getMediaCountBySourceId(sourceId: string): Promise<number> {
    const rows = await this.db!.select<{ count: number }[]>(
      `SELECT COUNT(DISTINCT e.media_id) as count FROM episode e
       WHERE e.id IN (SELECT DISTINCT episode_id FROM play_source WHERE source_id = ?)`,
      [sourceId]
    );
    return rows[0]?.count || 0;
  }

  async getMediaCountBySourceIdMap(): Promise<Map<string, number>> {
    const rows = await this.db!.select<{ sourceId: string; count: number }[]>(
      `SELECT ps.source_id as sourceId, COUNT(DISTINCT e.media_id) as count
       FROM episode e
       JOIN play_source ps ON e.id = ps.episode_id
       GROUP BY ps.source_id`
    );
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.sourceId, row.count);
    }
    return map;
  }

  async deleteMediaCompletely(mediaId: string): Promise<void> {
    await this.db!.execute('DELETE FROM play_source WHERE episode_id IN (SELECT id FROM episode WHERE media_id = ?)', [mediaId]);
    await this.db!.execute('DELETE FROM episode WHERE media_id = ?', [mediaId]);
    await this.db!.execute('DELETE FROM favorite WHERE media_id = ?', [mediaId]);
    await this.db!.execute('DELETE FROM watch_history WHERE media_id = ?', [mediaId]);
    await this.db!.execute('DELETE FROM media WHERE id = ?', [mediaId]);
  }

  async deleteMediaWithoutPlaySource(): Promise<number> {
    console.log('[deleteMediaWithoutPlaySource] started');
    
    const beforeRows = await this.db!.select<{ count: number }[]>('SELECT COUNT(*) as count FROM media');
    const beforeCount = beforeRows[0]?.count || 0;
    console.log(`[deleteMediaWithoutPlaySource] before media count: ${beforeCount}`);

    const mediaWithoutPlaySource = await this.db!.select<{ id: string }[]>(
      `SELECT m.id FROM media m 
       WHERE NOT EXISTS (
         SELECT 1 FROM episode e 
         JOIN play_source ps ON e.id = ps.episode_id 
         WHERE e.media_id = m.id
       )`
    );
    
    const countToDelete = mediaWithoutPlaySource.length;
    console.log(`[deleteMediaWithoutPlaySource] found ${countToDelete} media without play source`);
    
    if (countToDelete === 0) {
      console.log('[deleteMediaWithoutPlaySource] no media to delete, returning 0');
      return 0;
    }

    const batchSize = 100;
    for (let i = 0; i < mediaWithoutPlaySource.length; i += batchSize) {
      const batch = mediaWithoutPlaySource.slice(i, i + batchSize);
      const ids = batch.map(m => m.id);
      
      await this.db!.execute('BEGIN');
      try {
        await this.db!.execute(
          `DELETE FROM media WHERE id IN (${ids.map(() => '?').join(',')})`,
          ids
        );
        await this.db!.execute('COMMIT');
        console.log(`[deleteMediaWithoutPlaySource] deleted batch ${Math.floor(i / batchSize) + 1}`);
      } catch (error) {
        await this.db!.execute('ROLLBACK');
        console.error('[deleteMediaWithoutPlaySource] batch delete error:', error);
        throw error;
      }
    }

    await this.db!.execute('BEGIN');
    try {
      await this.db!.execute('DELETE FROM favorite WHERE NOT EXISTS (SELECT 1 FROM media WHERE media.id = favorite.media_id)');
      await this.db!.execute('DELETE FROM watch_history WHERE NOT EXISTS (SELECT 1 FROM media WHERE media.id = watch_history.media_id)');
      await this.db!.execute('COMMIT');
      console.log('[deleteMediaWithoutPlaySource] cleaned up favorites and watch_history');
    } catch (error) {
      await this.db!.execute('ROLLBACK');
      console.error('[deleteMediaWithoutPlaySource] cleanup error:', error);
      throw error;
    }

    const afterRows = await this.db!.select<{ count: number }[]>('SELECT COUNT(*) as count FROM media');
    const afterCount = afterRows[0]?.count || 0;
    const deleted = beforeCount - afterCount;
    console.log(`[deleteMediaWithoutPlaySource] after media count: ${afterCount}, deleted: ${deleted}`);

    return deleted;
  }

  async hideMediaByGenres(genres: string[]): Promise<{ hidden: number }> {
    if (genres.length === 0) return { hidden: 0 };
    const conditions = genres.map(() => 'genre LIKE ?');
    const params = genres.map(g => `%${g}%`);
    await this.db!.execute(
      `UPDATE media SET hidden = 1 WHERE ${conditions.join(' OR ')}`,
      params
    );
    const rows = await this.db!.select<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM media WHERE hidden = 1 AND ${conditions.join(' OR ')}`,
      params
    );
    return { hidden: rows[0]?.count || 0 };
  }

  async unhideMediaByGenres(genres: string[]): Promise<{ unhidden: number }> {
    if (genres.length === 0) return { unhidden: 0 };
    const conditions = genres.map(() => 'genre LIKE ?');
    const params = genres.map(g => `%${g}%`);
    await this.db!.execute(
      `UPDATE media SET hidden = 0 WHERE ${conditions.join(' OR ')}`,
      params
    );
    const rows = await this.db!.select<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM media WHERE hidden = 0 AND ${conditions.join(' OR ')}`,
      params
    );
    return { unhidden: rows[0]?.count || 0 };
  }

  async getHiddenMediaCount(): Promise<number> {
    const rows = await this.db!.select<{ count: number }[]>(
      'SELECT COUNT(*) as count FROM media WHERE hidden = 1'
    );
    return rows[0]?.count || 0;
  }

  async getSeasonsByMediaId(mediaId: string): Promise<number[]> {
    const rows = await this.db!.select<{ season_number: number }[]>(
      'SELECT DISTINCT season_number FROM episode WHERE media_id = ? ORDER BY season_number ASC',
      [mediaId]
    );
    return rows.map(row => row.season_number);
  }

  // —— PlaySource DAO ——
  async getPlaySourcesByEpisodeId(episodeId: string): Promise<PlaySource[]> {
    const rows = await this.db!.select<any[]>('SELECT * FROM play_source WHERE episode_id = ?', [episodeId]);
    return rows.map(rowToPlaySource);
  }

  async getPlaySourcesByMediaId(mediaId: string): Promise<PlaySource[]> {
    const rows = await this.db!.select<any[]>(
      `SELECT ps.* FROM play_source ps
       INNER JOIN episode e ON ps.episode_id = e.id
       WHERE e.media_id = ?`,
      [mediaId]
    );
    return rows.map(rowToPlaySource);
  }

  async upsertPlaySource(playSource: PlaySource): Promise<void> {
    await this.db!.execute(
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
    await this.db!.execute(
      `DELETE FROM play_source WHERE episode_id IN (SELECT id FROM episode WHERE media_id = ?)`,
      [mediaId]
    );
  }

  async deletePlaySourcesByMediaIdAndSourceId(mediaId: string, sourceId: string): Promise<void> {
    await this.db!.execute(
      `DELETE FROM play_source WHERE episode_id IN (SELECT id FROM episode WHERE media_id = ?) AND source_id = ?`,
      [mediaId, sourceId]
    );
  }

  async reportPlaySourceFail(sourceId: string): Promise<void> {
    const FAIL_COUNT_WINDOW_MS = 24 * 60 * 60 * 1000;
    const MAX_FAIL_COUNT = 5;
    const FAIL_COOLDOWN_MS = 60 * 60 * 1000;

    const now = new Date().toISOString();
    const row = await this.db!.select<{ fail_count: number; last_fail_at: string; is_active: number }[]>(
      'SELECT fail_count, last_fail_at, is_active FROM play_source WHERE id = ?',
      [sourceId]
    );

    if (row.length === 0) return;

    let currentFailCount = row[0].fail_count || 0;
    const lastFailAt = row[0].last_fail_at;

    if (lastFailAt) {
      const timeSinceLastFail = Date.now() - new Date(lastFailAt).getTime();
      if (timeSinceLastFail > FAIL_COUNT_WINDOW_MS) {
        currentFailCount = 0;
      }
    }

    const newFailCount = currentFailCount + 1;
    const isActive = newFailCount < MAX_FAIL_COUNT ? 1 : 0;

    await this.db!.execute(
      `UPDATE play_source SET
         fail_count = ?,
         last_fail_at = ?,
         is_active = ?
       WHERE id = ?`,
      [newFailCount, now, isActive, sourceId]
    );
  }

  // —— VideoSource DAO ——
  async getAllVideoSources(): Promise<VideoSource[]> {
    const rows = await this.db!.select<any[]>('SELECT * FROM video_source ORDER BY id ASC');
    return rows.map(rowToVideoSource);
  }

  async getEnabledVideoSources(): Promise<VideoSource[]> {
    const rows = await this.db!.select<any[]>('SELECT * FROM video_source WHERE is_enabled = 1 ORDER BY id ASC');
    return rows.map(rowToVideoSource);
  }

  async getVideoSourceById(id: string): Promise<VideoSource | null> {
    const rows = await this.db!.select<any[]>('SELECT * FROM video_source WHERE id = ?', [id]);
    return rows[0] ? rowToVideoSource(rows[0]) : null;
  }

  async getVideoSourceByCode(code: string): Promise<VideoSource | null> {
    const rows = await this.db!.select<any[]>('SELECT * FROM video_source WHERE code = ?', [code]);
    return rows[0] ? rowToVideoSource(rows[0]) : null;
  }

  async upsertVideoSource(source: VideoSource): Promise<void> {
    await this.db!.execute(
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
    await this.db!.execute('DELETE FROM video_source WHERE id = ?', [id]);
  }

  async setVideoSourceEnabled(id: string, enabled: boolean): Promise<void> {
    await this.db!.execute('UPDATE video_source SET is_enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
  }

  async updateSourceRateLimit(id: string, rateLimit: number): Promise<void> {
    await this.db!.execute('UPDATE video_source SET rate_limit = ? WHERE id = ?', [rateLimit, id]);
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
    
    await this.db!.execute(`UPDATE video_source SET ${updates.join(', ')} WHERE id = ?`, params);
  }

  async updateSourceLastCollectedAt(id: string, time: string): Promise<void> {
    await this.db!.execute('UPDATE video_source SET last_collected_at = ? WHERE id = ?', [time, id]);
  }

  async incrementSourceRequestCount(id: string): Promise<void> {
    await this.db!.execute('UPDATE video_source SET total_requests = total_requests + 1 WHERE id = ?', [id]);
  }

  async incrementSourceFailCount(id: string): Promise<void> {
    await this.db!.execute('UPDATE video_source SET fail_count = fail_count + 1 WHERE id = ?', [id]);
  }

  // —— Favorite DAO ——
  async getAllFavorites(): Promise<Favorite[]> {
    const rows = await this.db!.select<any[]>('SELECT * FROM favorite ORDER BY created_at DESC');
    return rows.map(rowToFavorite);
  }

  async isFavorite(mediaId: string): Promise<boolean> {
    const rows = await this.db!.select<{ count: number }[]>('SELECT COUNT(*) as count FROM favorite WHERE media_id = ?', [mediaId]);
    return (rows[0]?.count || 0) > 0;
  }

  async addFavorite(mediaId: string): Promise<void> {
    const now = new Date().toISOString();
    const id = `fav_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    await this.db!.execute('INSERT INTO favorite (id, media_id, created_at) VALUES (?, ?, ?)', [id, mediaId, now]);
  }

  async removeFavorite(mediaId: string): Promise<void> {
    await this.db!.execute('DELETE FROM favorite WHERE media_id = ?', [mediaId]);
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
    const rows = await this.db!.select<any[]>(
      'SELECT * FROM watch_history ORDER BY updated_at DESC LIMIT ? OFFSET ?',
      [pageSize, offset]
    );
    return rows.map(rowToWatchHistory);
  }

  async getWatchHistoryByMediaId(mediaId: string): Promise<WatchHistory | null> {
    const rows = await this.db!.select<any[]>(
      'SELECT * FROM watch_history WHERE media_id = ? ORDER BY updated_at DESC LIMIT 1',
      [mediaId]
    );
    return rows[0] ? rowToWatchHistory(rows[0]) : null;
  }

  async getAllWatchHistoryByMediaId(mediaId: string): Promise<WatchHistory[]> {
    const rows = await this.db!.select<any[]>(
      'SELECT * FROM watch_history WHERE media_id = ? ORDER BY updated_at DESC',
      [mediaId]
    );
    return rows.map(rowToWatchHistory);
  }

  async upsertWatchHistory(mediaId: string, episodeId: string | null, progress: number, duration: number): Promise<void> {
    const now = new Date().toISOString();
    const id = `wh_${mediaId}_${episodeId || 'movie'}`;
    await this.db!.execute(
      `INSERT INTO watch_history (id, media_id, episode_id, progress, duration, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         progress = excluded.progress,
         duration = excluded.duration,
         updated_at = excluded.updated_at`,
      [id, mediaId, episodeId, progress, duration, now]
    );
  }

  async clearWatchHistory(): Promise<void> {
    await this.db!.execute('DELETE FROM watch_history');
  }

  async deleteWatchHistory(mediaId: string): Promise<void> {
    await this.db!.execute('DELETE FROM watch_history WHERE media_id = ?', [mediaId]);
  }

  // —— SearchHistory DAO ——
  async addSearchHistory(keyword: string): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.db!.select<any[]>('SELECT * FROM search_history WHERE keyword = ?', [keyword]);
    if (existing.length > 0) {
      await this.db!.execute('UPDATE search_history SET count = count + 1, updated_at = ? WHERE keyword = ?', [now, keyword]);
    } else {
      const id = `sh_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      await this.db!.execute('INSERT INTO search_history (id, keyword, count, updated_at) VALUES (?, ?, 1, ?)', [id, keyword, now]);
    }
  }

  async getSearchHistory(limit: number = 10): Promise<{ keyword: string; count: number }[]> {
    return this.db!.select<{ keyword: string; count: number }[]>(
      'SELECT keyword, count FROM search_history ORDER BY updated_at DESC LIMIT ?',
      [limit]
    );
  }

  async getHotSearches(limit: number = 10): Promise<{ keyword: string; count: number }[]> {
    return this.db!.select<{ keyword: string; count: number }[]>(
      'SELECT keyword, count FROM search_history ORDER BY count DESC LIMIT ?',
      [limit]
    );
  }

  async clearSearchHistory(): Promise<void> {
    await this.db!.execute('DELETE FROM search_history');
  }

  async deleteSearchHistory(keyword: string): Promise<void> {
    await this.db!.execute('DELETE FROM search_history WHERE keyword = ?', [keyword]);
  }

  async createCollectTask(task: CollectTask): Promise<void> {
    await this.db!.execute(
      'INSERT INTO collect_task (id, task_id, source_code, source_name, type, status, current_page, total_pages, collected_count, failed_count, error_message, error_type, last_error_page, failed_pages, created_at, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
        task.createdAt,
        task.startedAt || null,
        task.completedAt || null,
      ]
    );
  }

  async getCollectTaskById(taskId: string): Promise<CollectTask | null> {
    const rows = await this.db!.select<any[]>(
      'SELECT * FROM collect_task WHERE task_id = ?',
      [taskId]
    );
    if (rows.length === 0) return null;
    return rowToCollectTask(rows[0]);
  }

  async getAllCollectTasks(): Promise<CollectTask[]> {
    const rows = await this.db!.select<any[]>(
      'SELECT * FROM collect_task ORDER BY created_at DESC'
    );
    return rows.map(rowToCollectTask);
  }

  async getRunningTasksBySourceCode(sourceCode: string): Promise<CollectTask[]> {
    const rows = await this.db!.select<any[]>(
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
    await this.db!.execute(`UPDATE collect_task SET ${sqlParts.join(', ')} WHERE task_id = ?`, params);
  }

  async deleteCollectTask(taskId: string): Promise<void> {
    await this.db!.execute('DELETE FROM collect_task WHERE task_id = ?', [taskId]);
  }

  async deleteOldTasks(days: number): Promise<void> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    await this.db!.execute('DELETE FROM collect_task WHERE created_at < ?', [cutoff]);
  }

  async resetStaleTasks(): Promise<number> {
    const now = new Date().toISOString();
    const result = await this.db!.execute(
      `UPDATE collect_task SET
         status = 'FAILED',
         error_message = '应用重启，任务已中断',
         error_type = 'CANCELLED',
         completed_at = ?
       WHERE status IN ('PENDING', 'RUNNING')`,
      [now]
    );
    return result?.rowsAffected ?? 0;
  }

  async cancelCollectTask(taskId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db!.execute(
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
    await this.db!.execute(
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
    await this.db!.execute(`UPDATE collect_task SET ${sqlParts.join(', ')} WHERE task_id = ?`, params);
  }

  async getRunningReprobeTask(): Promise<CollectTask | null> {
    const rows = await this.db!.select<any[]>(
      "SELECT * FROM collect_task WHERE type = 'REPROBE' AND status IN ('PENDING', 'RUNNING') ORDER BY created_at DESC LIMIT 1"
    );
    if (rows.length === 0) return null;
    return rowToCollectTask(rows[0]);
  }

  async select<T>(sql: string, params?: any[]): Promise<T[]> {
    return this.db!.select<T[]>(sql, params);
  }

  async selectOne<T>(sql: string, params?: any[]): Promise<T | null> {
    const rows = await this.db!.select<T[]>(sql, params);
    return rows[0] || null;
  }

  async execute(sql: string, params?: any[]): Promise<void> {
    await this.db!.execute(sql, params);
  }
}
