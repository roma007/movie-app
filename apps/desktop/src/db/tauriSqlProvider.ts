import Database from '@tauri-apps/plugin-sql';
import {
  SCHEMA_SQL,
  DROP_SYNC_REMNANTS_SQL,
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

    // 6. 将历史内置 HTTP 源升级为 HTTPS（iOS ATS 会拦截明文 http）
    await this.upgradeSourceUrlsToHttps();
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

    // 清理已废弃多设备同步残留（change_log 表/触发器/索引，幂等），
    // 仅对曾执行过同步逻辑的库生效；SCHEMA_SQL 已不含这些对象，此处专清历史残留。
    for (const stmt of splitSqlStatements(DROP_SYNC_REMNANTS_SQL)) {
      try {
        await this.db!.execute(stmt);
      } catch (e) {
        console.warn('Drop sync remnant failed:', stmt, e);
      }
    }

    // 增量迁移：为已有 media 表补齐 series_group / series_season 列
    await this.addColumnIfMissing('media', 'series_group', 'TEXT');
    await this.addColumnIfMissing('media', 'series_season', 'INTEGER');
    // 增量迁移：为已有 media 表补齐评分相关列
    await this.addColumnIfMissing('media', 'rating', 'REAL');
    await this.addColumnIfMissing('media', 'rating_count', 'INTEGER');
    await this.addColumnIfMissing('media', 'rating_source', 'TEXT');
    await this.addColumnIfMissing('media', 'rating_updated_at', 'TEXT');
    // 增量迁移：为已有 media 表补齐「越看越懂你」推荐分列
    await this.addColumnIfMissing('media', 'personal_score', 'INTEGER');
    // 清理历史 CMS 评分补充数据（幂等，评分只保留豆瓣抓取结果）
    await this.db!.execute(
      `UPDATE media SET rating = NULL, rating_count = NULL, rating_source = NULL, rating_updated_at = NULL WHERE rating_source = 'CMS'`
    );
    // 增量迁移：为已有 video_source 表补齐健康检查相关列
    await this.addColumnIfMissing('video_source', 'last_success_at', 'TEXT');
    await this.addColumnIfMissing('video_source', 'avg_response_time', 'INTEGER');
    // 增量迁移：为已有 video_source 表补齐增量采集时间列
    await this.addColumnIfMissing('video_source', 'last_incremental_collected_at', 'TEXT');
    // 增量迁移：为已有 watch_history 表补齐播放源/播放线路列（续播按「同源同线路」判定）
    await this.addColumnIfMissing('watch_history', 'source_id', 'TEXT');
    await this.addColumnIfMissing('watch_history', 'play_source_id', 'TEXT');

    // 删除 video_source 表的 rate_limit 列（重建表）
    await this.dropColumnIfExists('video_source', 'rate_limit');

    // 始终重建 FTS5：确保虚拟表和辅助表状态一致，不受历史损坏影响
    await this.rebuildFts5();

    // 升级 media_au 触发器为 WHEN 守卫版：仅 FTS 索引列变化时同步全文索引，
    // 避免 hidden 等非索引列更新（如按子类型隐藏）触发全表 FTS 重建导致卡顿。
    // rebuildFts5 在 FTS 正常时提前返回且 CREATE IF NOT EXISTS 不覆盖旧定义，需在此显式重建。
    await this.db!.execute('DROP TRIGGER IF EXISTS media_au');
    await this.db!.execute(`CREATE TRIGGER IF NOT EXISTS media_au AFTER UPDATE ON media WHEN
      old.title IS NOT new.title OR old.alias IS NOT new.alias OR
      old.original_title IS NOT new.original_title OR
      old.director IS NOT new.director OR old.cast IS NOT new.cast
    BEGIN
      INSERT INTO media_fts(media_fts, rowid, title, alias, original_title, director, cast)
      VALUES ('delete', old.rowid, old.title, old.alias, old.original_title, old.director, old.cast);
      INSERT INTO media_fts(rowid, title, alias, original_title, director, cast)
      VALUES (new.rowid, new.title, new.alias, new.original_title, new.director, new.cast);
    END;`);

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

    await this.fixGenreData();
    await this.backfillHiddenGenres();
    await this.syncHiddenByGenres();
  }

  /**
   * 一次性回填隐藏子类型清单：仅当 hidden_genre 为空时，从当前已隐藏媒体
   * 的 genre 中提取子类型写入，保证老版本用户已隐藏的子类型在新逻辑下继续生效。
   */
  private async backfillHiddenGenres(): Promise<void> {
    const countRows = await this.db!.select<{ count: number }[]>(
      'SELECT COUNT(*) as count FROM hidden_genre'
    );
    if ((countRows[0]?.count || 0) > 0) return;
    await this.db!.execute(`
      INSERT OR IGNORE INTO hidden_genre (sub_type, created_at)
      SELECT DISTINCT json_each.value, ?
      FROM media, json_each(media.genre)
      WHERE media.hidden = 1 AND json_valid(media.genre)
        AND json_each.value IS NOT NULL AND json_each.value != ''
    `, [new Date().toISOString()]);
  }

  private async fixGenreData(): Promise<void> {
    const rows = await this.db!.select<{ id: string; genre: string }[]>(
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
          await this.db!.execute('UPDATE media SET genre = ? WHERE id = ?', [JSON.stringify(newGenres), row.id]);
          fixed++;
        }
      } catch { /* skip invalid JSON */ }
    }
    if (fixed > 0) {
      console.log(`Fixed ${fixed} media records with comma-separated genre in first element`);
    }
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
   * 若表存在且包含指定列，则通过重建表删除该列。
   * SQLite 不支持 ALTER TABLE DROP COLUMN，需走重建表流程。
   * 当前仅用于 video_source 表删除 rate_limit 列，重建时显式还原表结构（含主键/唯一约束）。
   */
  private async dropColumnIfExists(table: string, column: string): Promise<void> {
    const cols = await this.db!.select<{ name: string }[]>(
      `PRAGMA table_info(${table})`
    );
    if (!cols.some(c => c.name === column)) return;

    // 1. 禁用外键约束
    await this.db!.execute('PRAGMA foreign_keys=OFF');

    // 2. 显式重建 video_source 表（保留主键/唯一约束，移除 rate_limit 列）
    await this.db!.execute(`CREATE TABLE ${table}_new (
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
    )`);

    // 3. 复制数据（跳过被删列）
    await this.db!.execute(
      `INSERT INTO ${table}_new (id, code, name, base_url, type, is_enabled, health_status, last_check_at, last_success_at, avg_response_time, last_collected_at, last_incremental_collected_at, created_at, fail_count, total_requests)
       SELECT id, code, name, base_url, type, is_enabled, health_status, last_check_at, last_success_at, avg_response_time, last_collected_at, last_incremental_collected_at, created_at, fail_count, total_requests FROM ${table}`
    );

    // 4. 删除旧表
    await this.db!.execute(`DROP TABLE ${table}`);

    // 5. 重命名新表
    await this.db!.execute(`ALTER TABLE ${table}_new RENAME TO ${table}`);

    // 6. 恢复外键约束
    await this.db!.execute('PRAGMA foreign_keys=ON');
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
    await this.db!.execute(`CREATE TRIGGER IF NOT EXISTS media_au AFTER UPDATE ON media WHEN
      old.title IS NOT new.title OR old.alias IS NOT new.alias OR
      old.original_title IS NOT new.original_title OR
      old.director IS NOT new.director OR old.cast IS NOT new.cast
    BEGIN
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
      await this.db!.execute(
        'UPDATE video_source SET base_url = ? WHERE code = ? AND base_url = ?',
        [httpsUrl, code, httpUrl]
      );
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
      const snapRows = await this.db!.select<{ count: number }[]>(
        `SELECT COUNT(*) as count FROM recommend_snapshot`
      );
      const hasSnapshot = (snapRows[0]?.count || 0) > 0;
      if (hasSnapshot) {
        const { where, qp } = buildWhere('m');
        const countRows = await this.db!.select<{ count: number }[]>(
          `SELECT COUNT(*) as count FROM recommend_snapshot rs JOIN media m ON m.id = rs.media_id${where}`,
          qp
        );
        const total = countRows[0]?.count || 0;
        const totalPages = Math.ceil(total / pageSize);
        const rows = await this.db!.select<any[]>(
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

    const countRows = await this.db!.select<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM media${where}`,
      qp
    );
    const total = countRows[0]?.count || 0;
    const totalPages = Math.ceil(total / pageSize);

    const rows = await this.db!.select<any[]>(
      `SELECT * FROM media${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...qp, pageSize, offset]
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
        view_count, rating, rating_count, rating_source, rating_updated_at,
        hidden, series_group, series_season,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        media.hidden ? 1 : 0,
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

  async updateMediaPoster(mediaId: string, posterUrl: string | null, updatedAt: string): Promise<void> {
    await this.db!.execute(
      `UPDATE media SET poster_url = ?, updated_at = ? WHERE id = ?`,
      [posterUrl, updatedAt, mediaId]
    );
  }

  async updateMediaRating(
    mediaId: string,
    data: { rating: number | null; ratingCount: number | null; source: 'DOUBAN'; updatedAt: string }
  ): Promise<void> {
    await this.db!.execute(
      `UPDATE media SET rating = ?, rating_count = ?, rating_source = ?, rating_updated_at = ? WHERE id = ?`,
      [data.rating, data.ratingCount, data.source, data.updatedAt, mediaId]
    );
  }

  async incrementViewCount(id: string): Promise<void> {
    await this.db!.execute('UPDATE media SET view_count = view_count + 1 WHERE id = ?', [id]);
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
      const rows = await this.db!.select<{ genre: string }[]>(
        `SELECT genre FROM media ${whereClause}`,
        params
      );
      return extractFirstSubtypes(rows.map(row => row.genre));
    }
    const rows = await this.db!.select<{ genre: string }[]>(
      `SELECT DISTINCT genre FROM media ${whereClause}`,
      params
    );
    return expandSubTypes(rows.map(row => row.genre));
  }

  async getYearsByType(type?: string): Promise<number[]> {
    let whereClause = 'WHERE (hidden IS NULL OR hidden = 0)';
    const params: any[] = [];
    if (type) {
      whereClause += ' AND type = ?';
      params.push(type);
    }
    const rows = await this.db!.select<{ year: number }[]>(
      `SELECT DISTINCT year FROM media ${whereClause} ORDER BY year DESC`,
      params
    );
    return rows.map(row => row.year);
  }

  async getAreasByType(type?: string): Promise<string[]> {
    let whereClause = 'WHERE area IS NOT NULL AND (hidden IS NULL OR hidden = 0)';
    const params: any[] = [];
    if (type) {
      whereClause += ' AND type = ?';
      params.push(type);
    }
    const rows = await this.db!.select<{ area: string }[]>(
      `SELECT area FROM media ${whereClause} GROUP BY area ORDER BY COUNT(*) DESC, area`,
      params
    );
    return rows.map(row => row.area);
  }

  async hasShortDrama(type?: string): Promise<boolean> {
    let whereClause = 'WHERE is_short_drama = 1 AND (hidden IS NULL OR hidden = 0)';
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

  async updateEpisodeDuration(episodeId: string, duration: number | null): Promise<void> {
    await this.db!.execute('UPDATE episode SET duration = ? WHERE id = ?', [duration ?? null, episodeId]);
  }

  async deleteEpisodesByMediaIdAndSourceId(mediaId: string, sourceId: string): Promise<void> {
    await this.db!.execute('DELETE FROM episode WHERE media_id = ? AND source_id = ?', [mediaId, sourceId]);
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

  async getMediaCountBySourceIdMap(): Promise<Map<string, number>> {
    const rows = await this.db!.select<{ sourceId: string; count: number }[]>(
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

      // 注意：桌面端经 tauri-plugin-sql 连接池执行 SQL，池内多连接不保证 BEGIN/COMMIT 落在同一连接，
      // 故不能使用跨 execute 的事务；单条 DELETE 由 SQLite 原子执行即可。
      await this.db!.execute(
        `DELETE FROM media WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
      console.log(`[deleteMediaWithoutPlaySource] deleted batch ${Math.floor(i / batchSize) + 1}`);
    }

    await this.db!.execute('DELETE FROM favorite WHERE NOT EXISTS (SELECT 1 FROM media WHERE media.id = favorite.media_id)');
    await this.db!.execute('DELETE FROM watch_history WHERE NOT EXISTS (SELECT 1 FROM media WHERE media.id = watch_history.media_id)');
    console.log('[deleteMediaWithoutPlaySource] cleaned up favorites and watch_history');

    const afterRows = await this.db!.select<{ count: number }[]>('SELECT COUNT(*) as count FROM media');
    const afterCount = afterRows[0]?.count || 0;
    const deleted = beforeCount - afterCount;
    console.log(`[deleteMediaWithoutPlaySource] after media count: ${afterCount}, deleted: ${deleted}`);

    return deleted;
  }

  async deleteNonMediaPlaySources(): Promise<number> {
    const extConditions = MEDIA_FILE_EXTENSIONS.map(ext => `url NOT LIKE '%.${ext}%'`).join(' AND ');
    const beforeRows = await this.db!.select<{ count: number }[]>('SELECT COUNT(*) as count FROM play_source');
    const beforeCount = beforeRows[0]?.count || 0;
    if (beforeCount === 0) return 0;

    await this.db!.execute(`DELETE FROM play_source WHERE ${extConditions}`);

    await this.db!.execute(`DELETE FROM episode WHERE NOT EXISTS (SELECT 1 FROM play_source WHERE play_source.episode_id = episode.id)`);

    const deletedMedia = await this.deleteMediaWithoutPlaySource();
    if (deletedMedia > 0) {
      console.log(`[deleteNonMediaPlaySources] 顺带删除了 ${deletedMedia} 个无播放源的媒体`);
    }

    const afterRows = await this.db!.select<{ count: number }[]>('SELECT COUNT(*) as count FROM play_source');
    const afterCount = afterRows[0]?.count || 0;
    const deleted = beforeCount - afterCount;
    console.log(`[deleteNonMediaPlaySources] play_source: ${beforeCount} -> ${afterCount}, deleted ${deleted}`);
    return deleted;
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
    // 注意：桌面端经 tauri-plugin-sql 连接池执行 SQL，池内多连接不保证 BEGIN/COMMIT 落在同一连接，
    // 故不能使用跨 execute 的事务，各语句由 SQLite 自动提交。
    await this.db!.execute(
      `UPDATE media SET hidden = 1 WHERE ${conditions.join(' OR ')}`,
      params
    );
    const now = new Date().toISOString();
    for (const genre of genres) {
      await this.db!.execute(
        'INSERT OR IGNORE INTO hidden_genre (sub_type, created_at) VALUES (?, ?)',
        [genre, now]
      );
    }
    const rows = await this.db!.select<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM media WHERE hidden = 1 AND (${conditions.join(' OR ')})`,
      params
    );
    return { hidden: rows[0]?.count || 0 };
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
    await this.db!.execute(
      `UPDATE media SET hidden = 0 WHERE ${conditions.join(' OR ')}`,
      params
    );
    for (const genre of genres) {
      await this.db!.execute('DELETE FROM hidden_genre WHERE sub_type = ?', [genre]);
    }
    const rows = await this.db!.select<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM media WHERE hidden = 0 AND (${conditions.join(' OR ')})`,
      params
    );
    return { unhidden: rows[0]?.count || 0 };
  }

  async getHiddenGenres(): Promise<string[]> {
    const rows = await this.db!.select<{ sub_type: string }[]>(
      'SELECT sub_type FROM hidden_genre ORDER BY sub_type'
    );
    return rows.map(row => row.sub_type);
  }

  async getHiddenMediaCount(): Promise<number> {
    const rows = await this.db!.select<{ count: number }[]>(
      'SELECT COUNT(*) as count FROM media WHERE hidden = 1'
    );
    return rows[0]?.count || 0;
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
    const rows = await this.db!.select<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM media WHERE ${whereClause}`,
      params
    );
    const matched = rows[0]?.count || 0;
    if (matched > 0) {
      await this.db!.execute(
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
    const rows = await this.db!.select<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM media${whereClause}`,
      params
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
    await this.db!.execute('DELETE FROM video_source WHERE id = ?', [id]);
  }

  async setVideoSourceEnabled(id: string, enabled: boolean): Promise<void> {
    await this.db!.execute('UPDATE video_source SET is_enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
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

  async updateSourceLastIncrementalCollectedAt(id: string, time: string): Promise<void> {
    await this.db!.execute('UPDATE video_source SET last_incremental_collected_at = ? WHERE id = ?', [time, id]);
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

  async getWatchHistoryCount(): Promise<number> {
    const rows = await this.db!.select<any[]>(
      'SELECT COUNT(DISTINCT media_id) AS c FROM watch_history'
    );
    return Number(rows[0]?.c ?? 0);
  }

  async getWatchHistoryByEpisodeId(mediaId: string, episodeId: string): Promise<WatchHistory | null> {
    const rows = await this.db!.select<any[]>(
      'SELECT * FROM watch_history WHERE media_id = ? AND episode_id = ? ORDER BY updated_at DESC LIMIT 1',
      [mediaId, episodeId]
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
    await this.db!.execute(
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
      await this.db!.execute('DELETE FROM watch_history');
      await this.db!.execute('DELETE FROM watch_line_progress');
    }

    async deleteWatchHistory(mediaId: string): Promise<void> {
      await this.db!.execute('DELETE FROM watch_history WHERE media_id = ?', [mediaId]);
      await this.db!.execute('DELETE FROM watch_line_progress WHERE media_id = ?', [mediaId]);
    }

    // —— WatchLineProgress DAO ——
    async getWatchLineProgressByPlaySource(mediaId: string, episodeId: string, playSourceId: string): Promise<WatchHistory | null> {
      const rows = await this.db!.select<any[]>(
        'SELECT * FROM watch_line_progress WHERE media_id = ? AND episode_id = ? AND play_source_id = ? LIMIT 1',
        [mediaId, episodeId, playSourceId]
      );
      return rows[0] ? rowToWatchHistory(rows[0]) : null;
    }

    async upsertWatchLineProgress(
      mediaId: string,
      episodeId: string,
      playSourceId: string,
      progress: number,
      duration: number,
      sourceId?: string | null,
    ): Promise<void> {
      const now = new Date().toISOString();
      await this.db!.execute(
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

  async recordImpressions(items: { mediaId: string; shownAt: string }[]): Promise<string[]> {
    if (items.length === 0) return [];
    const placeholders = items.map(() => '(?, ?, ?)').join(', ');
    const params: any[] = [];
    for (const item of items) {
      params.push(item.mediaId, item.shownAt, item.shownAt);
    }
    await this.db!.execute(
      `INSERT INTO impression (media_id, shown_count, last_shown_at)
       VALUES ${placeholders}
       ON CONFLICT(media_id) DO UPDATE SET
         shown_count = impression.shown_count + 1,
         last_shown_at = excluded.last_shown_at`,
      params
    );
    const ids = items.map((i) => i.mediaId);
    const rows = await this.db!.select<{ media_id: string }[]>(
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
    await this.db!.execute('DELETE FROM user_interest_tag');
    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const placeholders = batch.map(() => '(?, ?, ?, ?, ?)').join(', ');
      const params: any[] = [];
      for (const r of batch) {
        params.push(r.tag, r.tagType, r.strength, r.sampleCount, r.updatedAt);
      }
      await this.db!.execute(
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
    await this.db!.execute('DELETE FROM recommend_snapshot');
    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const placeholders = batch.map(() => '(?, ?, ?, ?)').join(', ');
      const params: any[] = [];
      for (const r of batch) {
        params.push(r.mediaId, r.position, r.score, r.genreGroup);
      }
      await this.db!.execute(
        `INSERT INTO recommend_snapshot (media_id, position, score, genre_group) VALUES ${placeholders}`,
        params
      );
    }
  }

  async resetRecommendationData(): Promise<void> {
    await this.db!.execute('DELETE FROM impression');
    await this.db!.execute('DELETE FROM user_interest_tag');
    await this.db!.execute('DELETE FROM recommend_snapshot');
    await this.db!.execute('UPDATE media SET personal_score = 0');
  }

  async getDislikedMediaDetail(): Promise<{ mediaId: string; title: string; createdAt: string }[]> {
    const rows = await this.db!.select<{ media_id: string; title: string; created_at: string }[]>(
      `SELECT d.media_id, COALESCE(m.title, '') AS title, COALESCE(d.created_at, '') AS created_at
       FROM dislike d LEFT JOIN media m ON m.id = d.media_id
       ORDER BY d.created_at DESC`
    );
    return rows.map((r) => ({ mediaId: r.media_id, title: r.title, createdAt: r.created_at }));
  }

  async addDislike(mediaId: string): Promise<void> {
    await this.db!.execute(
      'INSERT INTO dislike (media_id, created_at) VALUES (?, ?) ON CONFLICT(media_id) DO UPDATE SET created_at = excluded.created_at',
      [mediaId, new Date().toISOString()]
    );
  }

  async removeDislike(mediaId: string): Promise<void> {
    await this.db!.execute('DELETE FROM dislike WHERE media_id = ?', [mediaId]);
  }

  async getInterestTagBlacklist(): Promise<{ tag: string; tagType: string; createdAt: string }[]> {
    const rows = await this.db!.select<{ tag: string; tag_type: string; created_at: string }[]>(
      `SELECT tag, tag_type, COALESCE(created_at, '') AS created_at FROM interest_tag_blacklist ORDER BY created_at DESC`
    );
    return rows.map((r) => ({ tag: r.tag, tagType: r.tag_type, createdAt: r.created_at }));
  }

  async addInterestTagBlacklist(tag: string, tagType: string): Promise<void> {
    await this.db!.execute(
      'INSERT INTO interest_tag_blacklist (tag, tag_type, created_at) VALUES (?, ?, ?) ON CONFLICT(tag, tag_type) DO UPDATE SET created_at = excluded.created_at',
      [tag, tagType, new Date().toISOString()]
    );
  }

  async removeInterestTagBlacklist(tag: string, tagType: string): Promise<void> {
    await this.db!.execute('DELETE FROM interest_tag_blacklist WHERE tag = ? AND tag_type = ?', [tag, tagType]);
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
    // 先查出将要被重置的任务
    const staleTasks = await this.db!.select<any[]>(
      "SELECT task_id, source_code, created_at FROM collect_task WHERE status IN ('PENDING', 'RUNNING')"
    );
    const result = await this.db!.execute(
      `UPDATE collect_task SET
         status = 'FAILED',
         error_message = '应用重启，任务已中断',
         error_type = 'CANCELLED',
         completed_at = ?
       WHERE status IN ('PENDING', 'RUNNING')`,
      [now]
    );
    const affected = result?.rowsAffected ?? 0;
    // 记录重置日志
    if (affected > 0) {
      for (const task of staleTasks) {
        await this.db!.execute(
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

  async addCollectionLog(log: CollectionLog): Promise<void> {
    await this.db!.execute(
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

    const rows = await this.db!.select<any[]>(sql, params);
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

  async getVoiceConfig(key: string): Promise<string | null> {
    const rows = await this.db!.select<any[]>('SELECT value FROM voice_config WHERE key = ?', [key]);
    return rows[0] ? rows[0].value : null;
  }

  async setVoiceConfig(key: string, value: string, valueType: string = 'string'): Promise<void> {
    const now = new Date().toISOString();
    await this.db!.execute(
      'INSERT OR REPLACE INTO voice_config (key, value, value_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [key, value, valueType, now, now]
    );
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
