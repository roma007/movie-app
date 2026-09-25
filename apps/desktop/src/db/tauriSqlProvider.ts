import Database from '@tauri-apps/plugin-sql';
import {
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

/**
 * DatabaseProvider 的 tauri-plugin-sql 实现（桌面端）。
 * SQL 语句与移动端 ExpoSqliteProvider 共享 schema.ts，仅底层 API 不同：
 *   - schema 由 TypeScript 层管理（幂等 DDL），不再使用 Rust 迁移
 *   - 单行查询用 select 返回数组的 [0]，对应移动端 getFirstAsync
 *   - 多行查询直接用 select 返回数组，对应移动端 getAllAsync
 *   - 写入用 execute，对应移动端 runAsync
 */
interface DbSem {
  inFlight: number;
  max: number;
  waiters: (() => void)[];
}

export class TauriSqlProvider implements DatabaseProvider {
  private db: InstanceType<typeof Database> | null = null;

  /** 事务进行中标志：事务内写操作绕过 writeState acquire（改由 withTransactionAsync 长持锁），避免重入死锁。
   *  注意：桌面端 tauri-plugin-sql 使用 sqlx 连接池，显式 BEGIN/COMMIT 会导致 BEGIN 在连接 A、
   *  后续写在连接 B/C，触发 database is locked。因此 withTransactionAsync 不发 BEGIN/COMMIT，
   *  仅保留 JS 层写锁串行 + txLockHeld 重入保护；原子性由 SQLite 单语句隐式事务保证。 */
  private txLockHeld = false;

  /** 儿童模式开关缓存（启动时由 system_config 初始化，setKidModeActive 同步更新）。 */
  private kidModeActive = false;

  /** 推荐排序「候选∩筛选」视图缓存：同筛选键 120s 内复用，翻页只需对有序候选切片（毫秒级）。 */
  private recommendViewCache: { key: string; view: number[]; at: number } | null = null;

  private wrapWithRetry(db: any): any {
    const originalExecute = db.execute.bind(db);
    const originalSelect = db.select.bind(db);

    const isLockError = (error: any): boolean => {
      const msg = (error?.message || String(error)).toLowerCase();
      return msg.includes('database is locked') || msg.includes('code: 5') || msg.includes('busy');
    };

    let inTransaction = false;

    const queuedExecute = (sql: string, params?: any[]) => this.withWriteLock(() => executeWithRetry(sql, params));
    const queuedSelect = (sql: string, params?: any[]) => this.withReadLock(() => selectWithRetry(sql, params));

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
        if (prop === 'execute') return queuedExecute;
        if (prop === 'select') return queuedSelect;
        return (target as any)[prop];
      },
    });
  }

  // 读写分离锁：
  // - 写（execute）：SQLite 单写者，串行（max 1）——写互斥 + 防止连接池被写占满。
  // - 读（select）：放开并发（max 6）——读者互不阻塞；UI 首屏查询不会再排在
  //   后台 recompute/采集的写事务后面干等（此前全排一条队导致分类页半分钟白屏）。
  // 采集 detail 网络并发 20 里的 select 也受此限流（≤6），池不爆。
  private readState: DbSem = { inFlight: 0, max: 6, waiters: [] };
  private writeState: DbSem = { inFlight: 0, max: 1, waiters: [] };

  private acquire(state: DbSem): Promise<void> {
    if (state.inFlight < state.max) {
      state.inFlight++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      state.waiters.push(() => {
        state.inFlight++;
        resolve();
      });
    });
  }

  private release(state: DbSem): void {
    state.inFlight--;
    const next = state.waiters.shift();
    if (next) next();
  }

  private async withLock<T>(state: DbSem, op: () => Promise<T>): Promise<T> {
    await this.acquire(state);
    try {
      return await op();
    } finally {
      this.release(state);
    }
  }

  private withReadLock<T>(op: () => Promise<T>): Promise<T> {
    return this.withLock(this.readState, op);
  }

  private withWriteLock<T>(op: () => Promise<T>): Promise<T> {
    // 事务（伪事务）内：连接已被 withTransactionAsync 长持唯一写锁，直接执行即可（避免重入死锁）。
    if (this.txLockHeld) return op();
    return this.withLock(this.writeState, op);
  }

  async withTransactionAsync<T>(fn: () => Promise<T>): Promise<T> {
    // 注意：桌面底层是 tauri-plugin-sql 连接池（sqlx），execute('BEGIN') 不会 pin 连接，
    // 事务内后续写语句会被路由到池中其它空闲连接，与 BEGIN 持锁连接撞 WAL 写锁 → 整批
    // "database is locked"。因此桌面端不建显式事务：仅用 writeState 写锁全局串行化，
    // 原子性由「单条 multi-row SQL 原子」保证（与逐条 upsert 语义等价，见批量写改造记录）。
    await this.acquire(this.writeState);
    this.txLockHeld = true;
    try {
      return await fn();
    } finally {
      this.txLockHeld = false;
      this.release(this.writeState);
    }
  }

  /**
   * 建立数据库连接并设置连接级 PRAGMA（幂等：重复调用无副作用）。
   * 独立于 init() 暴露，供 initApp 在完整初始化前预检「是否需主键 INTEGER 迁移」。
   */
  async connect(): Promise<void> {
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
  }

  async init(): Promise<void> {
    await this.connect();

    // 3. 检测并清理旧数据库（经历过 Rust 迁移的数据库）
    await this.migrateFromOldSchema();

    // 4. 清理历史冗余索引（释放空间，不影响查询）
    try {
      await this.db!.execute('DROP INDEX IF EXISTS idx_episode_media_id;');
      await this.db!.execute('DROP INDEX IF EXISTS idx_episode_source_id;');
      await this.db!.execute('DROP INDEX IF EXISTS idx_play_source_source_id_episode_id;');
    } catch (err) {
      console.error('[DB] 清理冗余索引失败:', err);
    }

    // 5. 执行完整 schema（幂等，全部 IF NOT EXISTS）
    await this.initSchema();

    // 6. 插入默认视频源
    await this.insertDefaultSources();

    // 7. 将历史内置 HTTP 源升级为 HTTPS（iOS ATS 会拦截明文 http）
    await this.upgradeSourceUrlsToHttps();

    // 8. 清理历史超大 failed_items blob（早期版本逐页累积无上限）：仅清理已结束
    //    状态（COMPLETED/FAILED/ABANDONED）的 >128KB 失败明细，绝不动 RUNNING/PENDING
    //    未完成任务（其续采依赖 currentPage/failed_items 等）。
    try {
      await this.db!.execute(
        "UPDATE collect_task SET failed_items = NULL WHERE status IN ('COMPLETED','FAILED','ABANDONED') AND failed_items IS NOT NULL AND length(failed_items) > 131072"
      );
    } catch (err) {
      console.error('[DB] 清理超大 failed_items 失败:', err);
    }

    // 9. 收束 WAL 文件（异常退出可能残留几百 MB WAL，冷启动慢）：非阻塞，失败不阻断启动
    try {
      await this.db!.execute('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch (err) {
      console.error('[DB] WAL checkpoint 失败:', err);
    }
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
   * 主键 INTEGER 化迁移（旧字符串合成主键 → 自增整数主键，最大化缩库 + 老用户无痛升级）。
   *
   * 触发：episode.id 列类型非 INTEGER（历史字符串主键库）。幂等可重入：
   * 每轮尝试前先清理上一轮残留的 _pkv2/映射临时表，崩溃后重启会从零重跑。
   *
   * 合并去重（决定 upsert 唯一键）：
   * - episode 按 (media_id, season_number, episode_number, source_id) 合并：同键旧重复行
   *   （历史语言线路/重采残留）并入保留行，其 play_source 经 ep_map 重映射（实测 45,574 组）；
   * - play_source 按 (episode_id, url) 合并（实测 33 组同源同 URL 重复）。
   * 其余均为无损类型迁移；孤儿引用（当前 0 行）按已验证决策落 0 哨兵兜底。
   *
   * FTS：media_fts 为外部内容表（docid=media.rowid），media 迁移后 rowid 全部重排，
   * 先删虚拟表与同步触发器，由 initSchema 末尾 rebuildFts5() 统一重建。
   *
   * 注意事项：
   * - 桌面端 tauri-plugin-sql 为连接池伪事务，无跨语句原子性；Drop/Rename 阶段理论上
   *   中断可能留下半迁移态（重启重入可自愈到「检测通过」前一步骤），已在留档列明风险。
   * - DROP 顺序严格先子后父，避免依赖 PRAGMA foreign_keys（连接池 per-connection）。
   */
  /**
   * episode.id 列是否已是 INTEGER 主键（迁移完成判定，幂等触发源）。
   * 无 episode 表视为「已完成」（全新库/空库无需迁移）。
   */
  private async isPkIntegerMigrated(): Promise<boolean> {
    const cols = await this.db!.select<{ name: string; type: string }[]>(`PRAGMA table_info(episode)`);
    if (cols.length === 0) return true;
    const idCol = cols.find((c) => c.name === 'id');
    return !!(idCol && idCol.type.toUpperCase() === 'INTEGER');
  }

  /**
   * 检测旧库是否需主键 INTEGER 迁移（供 initApp 提前获知并渲染全屏升级占位页）。
   * 只读表结构，不写任何数据；内部自动建立连接（幂等）。
   */
  async needsPkIntegerMigration(): Promise<boolean> {
    await this.connect();
    return !(await this.isPkIntegerMigrated());
  }

  /**
   * 迁移前磁盘预检：所在盘可用空间需 ≥ 主库文件大小×2（库文件 + 重建期临时表/索引空间），
   * 不足则抛出带可读提示的错误，由 initApp 冒泡至 UI 引导用户清理磁盘后重启重试。
   * 探测失败（如非 Tauri 环境 / command 未注册）仅告警不阻断迁移。
   */
  private async ensureDiskCapacity(): Promise<void> {
    let free: number | null = null;
    let dbBytes = 0;
    try {
      const pcRows = await this.db!.select<{ page_count: number }[]>('PRAGMA page_count');
      const psRows = await this.db!.select<{ page_size: number }[]>('PRAGMA page_size');
      dbBytes = Number(pcRows[0]?.page_count || 0) * Number(psRows[0]?.page_size || 0);
      if (!dbBytes) return;
      const pathModule = await import('@tauri-apps/api/path');
      const { invoke } = await import('@tauri-apps/api/core');
      free = await invoke<number>('disk_free_bytes', { path: await pathModule.appDataDir() });
    } catch (err) {
      console.warn('[DB] 磁盘预检探测失败，跳过：', err instanceof Error ? err.message : String(err));
      return;
    }
    if (free === null) return;
    const need = dbBytes * 2;
    const fmt = (n: number) => `${(n / 1073741824).toFixed(2)}GB`;
    if (free < need) {
      const msg = `磁盘空间不足，无法完成数据库升级：需要约 ${fmt(need)}，当前可用 ${fmt(free)}。请清理磁盘后重启应用重试。`;
      console.error('[DB] ' + msg);
      throw new Error(msg);
    }
    console.warn(`[DB] 磁盘预检通过：可用 ${fmt(free)} ≥ 需要 ${fmt(need)}（库 ${fmt(dbBytes)}×2）`);
  }

  private async migratePkToInteger(): Promise<void> {
    if (await this.isPkIntegerMigrated()) return;

    console.warn('[DB] 检测到旧字符串主键库，开始主键 INTEGER 迁移（590 万行级，预计数分钟内完成，允许中断重试）...');

    // 磁盘预检：不足则拒绝并提示，防大规模重建期间写爆
    await this.ensureDiskCapacity();

    // 可重入：清上一轮残留的临时表（已 rename 成功的表 DROP IF EXISTS 静默跳过）
    for (const t of [
      'media_pkv2', 'episode_pkv2', 'play_source_pkv2',
      'favorite_pkv2', 'impression_pkv2', 'recommend_candidates_pkv2',
      'dislike_pkv2', 'media_change_log_pkv2', 'watch_history_pkv2', 'watch_line_progress_pkv2',
      'm_map', 'ep_map', 'ps_map',
    ]) {
      await this.db!.execute(`DROP TABLE IF EXISTS ${t}`);
    }
    // FTS 先拆除（media 重建期间禁同步；末尾 rebuildFts5 重建）
    await this.db!.execute('DROP TRIGGER IF EXISTS media_ai');
    await this.db!.execute('DROP TRIGGER IF EXISTS media_au');
    await this.db!.execute('DROP TRIGGER IF EXISTS media_ad');
    await this.db!.execute('DROP TABLE IF EXISTS media_fts');

    // ---- 1. media：按 rowid 顺序重建（新 id = 顺序行号），建 m_map ----
    await this.db!.execute(`CREATE TABLE media_pkv2 (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, original_title TEXT, alias TEXT, type TEXT NOT NULL,
      year INTEGER NOT NULL, area TEXT, genre TEXT, director TEXT, cast TEXT, description TEXT,
      poster_url TEXT, backdrop_url TEXT, status TEXT, remarks TEXT, fingerprint TEXT UNIQUE,
      current_episodes INTEGER, total_episodes INTEGER, is_short_drama INTEGER DEFAULT 0,
      duration_check_status TEXT, episode_duration INTEGER, view_count INTEGER DEFAULT 0,
      rating REAL, rating_count INTEGER, rating_source TEXT, rating_updated_at TEXT,
      hidden INTEGER DEFAULT 0, kid_safe INTEGER, personal_score INTEGER DEFAULT 0,
      series_group TEXT, series_season INTEGER, source_updated_at TEXT, vod_id TEXT, created_at TEXT, updated_at TEXT
    )`);
    await this.db!.execute(`INSERT INTO media_pkv2 (
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
    await this.db!.execute('CREATE TABLE m_map (old TEXT PRIMARY KEY, new INTEGER)');
    await this.db!.execute(
      'INSERT INTO m_map SELECT oldm.id, newm.id FROM media oldm JOIN media_pkv2 newm ON oldm.rowid = newm.rowid'
    );

    // ---- 2. episode：业务键合并去重 + media_id 重映射 ----
    await this.db!.execute(`CREATE TABLE episode_pkv2 (
      id INTEGER PRIMARY KEY, media_id INTEGER NOT NULL, season_number INTEGER DEFAULT 1,
      episode_number INTEGER NOT NULL, title TEXT, duration INTEGER, source_id TEXT
    )`);
    await this.db!.execute(`INSERT INTO episode_pkv2 (media_id, season_number, episode_number, title, duration, source_id)
      SELECT m.new, e.season_number, e.episode_number, e.title, e.duration, e.source_id
      FROM episode e JOIN m_map m ON e.media_id = m.old
      GROUP BY e.media_id, e.season_number, e.episode_number, e.source_id`);
    await this.db!.execute('CREATE TABLE ep_map (old TEXT PRIMARY KEY, new INTEGER)');
    await this.db!.execute(`INSERT INTO ep_map
      SELECT e.id, n.id
      FROM episode e
      JOIN m_map m ON e.media_id = m.old
      JOIN episode_pkv2 n
        ON m.new = n.media_id AND e.season_number = n.season_number
       AND e.episode_number = n.episode_number AND COALESCE(e.source_id, '') = COALESCE(n.source_id, '')`);

    // ---- 3. play_source：按 (episode_id,url) 合并去重 + episode_id 重映射，建 ps_map ----
    await this.db!.execute(`CREATE TABLE play_source_pkv2 (
      id INTEGER PRIMARY KEY, episode_id INTEGER NOT NULL, source_id TEXT NOT NULL, source_name TEXT,
      url TEXT NOT NULL, quality TEXT, language TEXT, is_active INTEGER DEFAULT 1,
      fail_count INTEGER DEFAULT 0, last_fail_at TEXT
    )`);
    await this.db!.execute(`INSERT INTO play_source_pkv2 (episode_id, source_id, source_name, url, quality, language, is_active, fail_count, last_fail_at)
      SELECT enew, source_id, source_name, url, quality, language, is_active, fail_count, last_fail_at
      FROM (SELECT ep_map.new AS enew, ps.source_id, ps.source_name, ps.url, ps.quality,
                   ps.language, ps.is_active, ps.fail_count, ps.last_fail_at
            FROM play_source ps JOIN ep_map ON ps.episode_id = ep_map.old)
      GROUP BY enew, url`);
    await this.db!.execute('CREATE TABLE ps_map (old TEXT PRIMARY KEY, new INTEGER)');
    await this.db!.execute(`INSERT INTO ps_map
      SELECT ps.id, n.id
      FROM play_source ps
      JOIN ep_map e ON ps.episode_id = e.old
      JOIN play_source_pkv2 n ON ps.url = n.url AND n.episode_id = e.new`);

    // ---- 4. 小表引用重映射（MEDIA 级：LEFT JOIN m_map；孤儿落 0 哨兵） ----
    await this.db!.execute('CREATE TABLE favorite_pkv2 (id TEXT PRIMARY KEY, media_id INTEGER NOT NULL, created_at TEXT)');
    await this.db!.execute(`INSERT INTO favorite_pkv2 (id, media_id, created_at)
      SELECT f.id, COALESCE(m.new, 0), f.created_at FROM favorite f LEFT JOIN m_map m ON f.media_id = m.old`);

    await this.db!.execute('CREATE TABLE impression_pkv2 (media_id INTEGER PRIMARY KEY, shown_count INTEGER DEFAULT 1, last_shown_at TEXT)');
    await this.db!.execute(`INSERT INTO impression_pkv2 (media_id, shown_count, last_shown_at)
      SELECT COALESCE(m.new, 0), SUM(i.shown_count), MAX(i.last_shown_at)
      FROM impression i LEFT JOIN m_map m ON i.media_id = m.old
      GROUP BY COALESCE(m.new, 0)`);

    await this.db!.execute('CREATE TABLE recommend_candidates_pkv2 (media_id INTEGER PRIMARY KEY, position INTEGER, score INTEGER DEFAULT 0, genre_group TEXT)');
    await this.db!.execute(`INSERT INTO recommend_candidates_pkv2 (media_id, position, score, genre_group)
      SELECT COALESCE(m.new, 0), MAX(c.position), MAX(c.score), MAX(c.genre_group)
      FROM recommend_candidates c LEFT JOIN m_map m ON c.media_id = m.old
      GROUP BY COALESCE(m.new, 0)`);

    await this.db!.execute('CREATE TABLE dislike_pkv2 (media_id INTEGER PRIMARY KEY, created_at TEXT)');
    await this.db!.execute(`INSERT INTO dislike_pkv2 (media_id, created_at)
      SELECT COALESCE(m.new, 0), MAX(d.created_at)
      FROM dislike d LEFT JOIN m_map m ON d.media_id = m.old
      GROUP BY COALESCE(m.new, 0)`);

    await this.db!.execute('CREATE TABLE media_change_log_pkv2 (media_id INTEGER PRIMARY KEY, change_type TEXT NOT NULL, created_at TEXT)');
    await this.db!.execute(`INSERT INTO media_change_log_pkv2 (media_id, change_type, created_at)
      SELECT COALESCE(m.new, 0), MAX(ch.change_type), MAX(ch.created_at)
      FROM media_change_log ch LEFT JOIN m_map m ON ch.media_id = m.old
      GROUP BY COALESCE(m.new, 0)`);

    // watch_history / watch_line_progress：media/episode/play_source 三键重映射（孤儿落 0 哨兵）；
    // watch_history 主键 id 按与写入路径一致的 wh_<mid>_<eid||0> 重拼，OR REPLACE 防同键多行
    await this.db!.execute(`CREATE TABLE watch_history_pkv2 (
      id TEXT PRIMARY KEY, media_id INTEGER NOT NULL, episode_id INTEGER, progress INTEGER DEFAULT 0,
      duration INTEGER DEFAULT 0, source_id TEXT, play_source_id INTEGER, updated_at TEXT
    )`);
    await this.db!.execute(`INSERT OR REPLACE INTO watch_history_pkv2 (id, media_id, episode_id, progress, duration, source_id, play_source_id, updated_at)
      SELECT 'wh_' || COALESCE(m.new, 0) || '_' || COALESCE(e.new, 0),
             COALESCE(m.new, 0), COALESCE(e.new, 0), w.progress, w.duration, w.source_id,
             COALESCE(p.new, 0), w.updated_at
      FROM watch_history w
      LEFT JOIN m_map m ON w.media_id = m.old
      LEFT JOIN ep_map e ON w.episode_id = e.old
      LEFT JOIN ps_map p ON w.play_source_id = p.old`);

    await this.db!.execute(`CREATE TABLE watch_line_progress_pkv2 (
      media_id INTEGER NOT NULL, episode_id INTEGER, play_source_id INTEGER, source_id TEXT,
      progress INTEGER DEFAULT 0, duration INTEGER DEFAULT 0, updated_at TEXT,
      PRIMARY KEY (media_id, episode_id, play_source_id)
    )`);
    await this.db!.execute(`INSERT OR REPLACE INTO watch_line_progress_pkv2 (media_id, episode_id, play_source_id, source_id, progress, duration, updated_at)
      SELECT COALESCE(m.new, 0), COALESCE(e.new, 0), COALESCE(p.new, 0), w.source_id, w.progress, w.duration, w.updated_at
      FROM watch_line_progress w
      LEFT JOIN m_map m ON w.media_id = m.old
      LEFT JOIN ep_map e ON w.episode_id = e.old
      LEFT JOIN ps_map p ON w.play_source_id = p.old`);

    // ---- 5. swap：先子后父避免外键约束冲突；DROP 自动连带原索引，交由 initSchema 恢复 ----
    await this.db!.execute('DROP TABLE play_source');
    await this.db!.execute('ALTER TABLE play_source_pkv2 RENAME TO play_source');
    await this.db!.execute('DROP TABLE episode');
    await this.db!.execute('ALTER TABLE episode_pkv2 RENAME TO episode');
    await this.db!.execute('DROP TABLE media');
    await this.db!.execute('ALTER TABLE media_pkv2 RENAME TO media');
    await this.db!.execute('DROP TABLE favorite');
    await this.db!.execute('ALTER TABLE favorite_pkv2 RENAME TO favorite');
    await this.db!.execute('DROP TABLE impression');
    await this.db!.execute('ALTER TABLE impression_pkv2 RENAME TO impression');
    await this.db!.execute('DROP TABLE recommend_candidates');
    await this.db!.execute('ALTER TABLE recommend_candidates_pkv2 RENAME TO recommend_candidates');
    await this.db!.execute('DROP TABLE dislike');
    await this.db!.execute('ALTER TABLE dislike_pkv2 RENAME TO dislike');
    await this.db!.execute('DROP TABLE media_change_log');
    await this.db!.execute('ALTER TABLE media_change_log_pkv2 RENAME TO media_change_log');
    await this.db!.execute('DROP TABLE watch_history');
    await this.db!.execute('ALTER TABLE watch_history_pkv2 RENAME TO watch_history');
    await this.db!.execute('DROP TABLE watch_line_progress');
    await this.db!.execute('ALTER TABLE watch_line_progress_pkv2 RENAME TO watch_line_progress');
    await this.db!.execute('DROP TABLE m_map');
    await this.db!.execute('DROP TABLE ep_map');
    await this.db!.execute('DROP TABLE ps_map');

    // 迁移全程产生大量空页（DROP 旧表页未回收），VACUUM 一次性归还磁盘，
    // 否则升级后库文件反而膨胀（实测 5.9GB 旧库迁移后回收前 8.3GB → 真空后 1.3GB）。
    // 失败不阻断：仅损失缩库收益。
    try {
      await this.db!.execute('VACUUM');
    } catch (e) {
      console.warn('[DB] VACUUM 失败（缩库跳过）:', e);
    }

    console.warn('[DB] 主键 INTEGER 迁移完成（索引与 FTS 由 initSchema 后半段重建）');
  }

  /**
   * 使用共享 schema（schema.ts）执行幂等 DDL，确保所有表、FTS5、触发器、索引存在。
   * 对于全新数据库：创建所有结构。
   * 对于已清理的旧数据库：重新创建所有结构。
   * 对于已完整的数据库：全部 IF NOT EXISTS 跳过，无副作用。
   */
  private async initSchema(): Promise<void> {
    // 主键 INTEGER 化迁移（老库字符串主键 → 自增整数主键，最大化缩库）。必须在
    // SCHEMA_SQL / FTS 之前执行：新库幂等跳过，只有 episode.id 仍为 TEXT 的历史库触发。
    await this.migratePkToInteger();

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

    // 清理已废弃采集日志表 collection_log（幂等，仅对曾建过该表的历史库生效；
    // SCHEMA_SQL 已不再创建，此处确保升级用户同步删除）
    try {
      await this.db!.execute('DROP TABLE IF EXISTS collection_log');
    } catch (e) {
      console.warn('Drop collection_log failed:', e);
    }

    // 清理已废弃推荐快照表 recommend_snapshot（旧推荐机制残留；SCHEMA_SQL
    // 已不再创建，写入链已整体移除，此处确保升级用户同步删除）
    try {
      await this.db!.execute('DROP TABLE IF EXISTS recommend_snapshot');
    } catch (e) {
      console.warn('Drop recommend_snapshot failed:', e);
    }

    // 清理早期遗留孤儿表 voice_config（历史库曾建、全代码无引用；SCHEMA_SQL
    // 已不再创建，此处确保升级用户同步删除）
    try {
      await this.db!.execute('DROP TABLE IF EXISTS voice_config');
    } catch (e) {
      console.warn('Drop voice_config failed:', e);
    }

    // 增量迁移：为已有 media 表补齐 series_group / series_season 列
    await this.addColumnIfMissing('media', 'series_group', 'TEXT');
    await this.addColumnIfMissing('media', 'series_season', 'INTEGER');
    // 增量迁移：为已有 media 表补齐源侧更新时间列（用于采集时跳过未变更条目）
    await this.addColumnIfMissing('media', 'source_updated_at', 'TEXT');
    await this.addColumnIfMissing('media', 'vod_id', 'TEXT');
    // 增量迁移：为已有 media 表补齐评分相关列
    await this.addColumnIfMissing('media', 'rating', 'REAL');
    await this.addColumnIfMissing('media', 'rating_count', 'INTEGER');
    await this.addColumnIfMissing('media', 'rating_source', 'TEXT');
    await this.addColumnIfMissing('media', 'rating_updated_at', 'TEXT');
    // 增量迁移：为已有 media 表补齐「越看越懂你」推荐分列
    await this.addColumnIfMissing('media', 'personal_score', 'INTEGER');
    // 清理历史 CMS 评分补充数据（幂等，评分只保留豆瓣抓取结果）
    // 一次性数据清理：标记已存在则跳过。历史 CMS 评分只清理一次（已有库 0 匹配时
    // WHERE rating_source='CMS' 无法走索引，冷启动仍会全表扫约 12s），避免每次启动全表扫。
    const ratingFixedRows = await this.db!.select<{ value: string }[]>(
      "SELECT value FROM system_config WHERE key = 'db.cmsRatingCleaned'"
    );
    if (ratingFixedRows.length === 0) {
      await this.db!.execute(
        `UPDATE media SET rating = NULL, rating_count = NULL, rating_source = NULL, rating_updated_at = NULL WHERE rating_source = 'CMS'`
      );
      const now = new Date().toISOString();
      await this.db!.execute(
        "INSERT INTO system_config (key, value, value_type, created_at, updated_at) VALUES ('db.cmsRatingCleaned', '1', 'string', ?, ?)",
        [now, now]
      );
    }
    // 增量迁移：为已有 video_source 表补齐健康检查相关列
    await this.addColumnIfMissing('video_source', 'last_success_at', 'TEXT');
    await this.addColumnIfMissing('video_source', 'avg_response_time', 'INTEGER');
    // 增量迁移：为已有 video_source 表补齐增量采集时间列
    await this.addColumnIfMissing('video_source', 'last_incremental_collected_at', 'TEXT');
    // 增量迁移：为已有 watch_history 表补齐播放源/播放线路列（续播按「同源同线路」判定）
    await this.addColumnIfMissing('watch_history', 'source_id', 'TEXT');
    // 增量迁移：为已有 play_source 表补齐语言列（多语言版本合并的语言层数据承载）
    await this.addColumnIfMissing('play_source', 'language', 'TEXT');
    await this.addColumnIfMissing('watch_history', 'play_source_id', 'TEXT');

    // 删除 video_source 表的 rate_limit 列（重建表）
    await this.dropColumnIfExists('video_source', 'rate_limit');

    // 始终重建 FTS5：确保虚拟表和辅助表状态一致，不受历史损坏影响。
    // 分词器升级（trigram，支持中文子串搜索）：旧库 FTS 用默认分词器，MATCH 无法命中子串，
    // 以 system_config 标记 db.ftsTokenizer 判定，仅首次强制重建一次，之后零成本。
    const ftsTokenizerRows = await this.db!.select<{ value: string }[]>(
      "SELECT value FROM system_config WHERE key = 'db.ftsTokenizer'"
    );
    const ftsIsTrigram = ftsTokenizerRows.length > 0 && ftsTokenizerRows[0].value === 'trigram';
    await this.rebuildFts5(!ftsIsTrigram);
    if (!ftsIsTrigram) {
      const now = new Date().toISOString();
      await this.db!.execute(
        "INSERT OR REPLACE INTO system_config (key, value, value_type, created_at, updated_at) VALUES ('db.ftsTokenizer', 'trigram', 'string', ?, ?)",
        [now, now]
      );
    }

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

    // 增量迁移：为已有 collect_task 表补齐失败条目记录列（精准重试用）
    await this.addColumnIfMissing('collect_task', 'failed_items', 'TEXT');

    // 增量迁移：为已有 media 表补齐儿童适龄标记列
    await this.addColumnIfMissing('media', 'kid_safe', 'INTEGER');
    // 列在 SCHEMA_SQL 执行后才补上，那之后必须显式补索引（旧库 SCHEMA_SQL 中的
    // CREATE INDEX idx_media_kid_safe 会因列不存在而失败跳过）
    await this.db!.execute('CREATE INDEX IF NOT EXISTS idx_media_kid_safe ON media(kid_safe)');
    // 初始化儿童模式开关缓存（启动时读一次，作为查询层过滤的唯一依据）
    const kidModeRows = await this.db!.select<{ value: string }[]>(
      "SELECT value FROM system_config WHERE key = 'parental.kidMode'"
    );
    this.kidModeActive = kidModeRows.length > 0 && kidModeRows[0].value === '1';

    // 收藏根因修复：清理历史重复收藏行 + 建立 media_id UNIQUE 索引（幂等，每次启动重跑无害）
    for (const stmt of splitSqlStatements(FAVORITE_UNIQUE_MIGRATE_SQL)) {
      try {
        await this.db!.execute(stmt);
      } catch (e) {
        console.warn('Favorite unique migration failed:', stmt, e);
      }
    }

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
    // 一次性数据修复：标记已存在则跳过（历史坏数据只修一次，避免每次启动全表扫 LIKE）
    const doneRows = await this.db!.select<{ value: string }[]>(
      "SELECT value FROM system_config WHERE key = 'db.genreFixDone'"
    );
    if (doneRows.length > 0) return;

    const now = new Date().toISOString();
    const probe = await this.db!.select<{ id: number }[]>(
      "SELECT id, genre FROM media WHERE genre IS NOT NULL AND genre LIKE '%[\"%' AND genre LIKE '%,%' LIMIT 1"
    );
    if (probe.length === 0) {
      await this.db!.execute(
        "INSERT INTO system_config (key, value, value_type, created_at, updated_at) VALUES ('db.genreFixDone', '1', 'string', ?, ?)",
        [now, now]
      );
      return;
    }

    const rows = await this.db!.select<{ id: number; genre: string }[]>(
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
    await this.db!.execute(
      "INSERT INTO system_config (key, value, value_type, created_at, updated_at) VALUES ('db.genreFixDone', '1', 'string', ?, ?)",
      [now, now]
    );
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
  private async rebuildFts5(force = false): Promise<void> {
    // ── 阶段 1：检测 FTS5 是否可用 ──
    // 用 rowid LIMIT 1 探测（2ms）而非 count(*)（约 14s 全扫 23 万行 FTS 索引）：
    // FTS5 损坏时同样抛错进入修复分支，语义等价但启动零成本。
    // force=true（分词器升级为 trigram）时跳过探测，直接走重建。
    if (!force) {
      try {
        await this.db!.execute('SELECT rowid FROM media_fts LIMIT 1');
        return; // FTS5 正常，跳过重建
      } catch {
        // FTS5 不可用，继续修复
      }
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
        content_rowid='rowid',
        tokenize='trigram'
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
  async getKidModeActive(): Promise<boolean> {
    return this.kidModeActive;
  }

  async setKidModeActive(on: boolean): Promise<void> {
    const now = new Date().toISOString();
    await this.db!.execute(
      `INSERT INTO system_config (key, value, value_type, created_at, updated_at)
       VALUES ('parental.kidMode', ?, 'string', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [on ? '1' : '0', now, now]
    );
    this.kidModeActive = on;
  }

  async getMediaById(id: number): Promise<Media | null> {
    const rows = await this.db!.select<any[]>('SELECT * FROM media WHERE id = ?', [id]);
    if (!rows[0]) return null;
    // 儿童模式下隐藏非适龄内容，保证收藏/历史等经单条直查的入口同样生效
    if (this.kidModeActive && rows[0].kid_safe !== 1) return null;
    return rowToMedia(rows[0]);
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
    // 用「推荐排序」必须能翻出所有符合筛选条件的视频（与抖音只给推荐 feed 不同的产品语义），
    // 候选表只决定头部的个性化顺序；推荐外内容以新度承接，任何页/深翻都不会漏片。
    // 实现：候选表（~3k 行）全取后分批 PK 拉全列，再由 mediaMatchesFilters 在 JS 侧等价筛选
    // 并保持 position 序（带筛选条件的 IN/JOIN 在真库上被优化器以 22.6 万行 media 大表驱动，
    // 实测 11-52s；仅 IN 大列表则必走 PK 探测，毫秒级）。
    if (params.sort === 'recommend') {
      const { where, qp } = buildWhere('');
      const { where: whereM, qp: qpM } = buildWhere('m');
      // 全部符合筛选条件的 media 总数（推荐/最新/其它排序一致）
      let total: number;
      if (params.knownTotal !== undefined) {
        total = params.knownTotal;
      } else {
        total =
          (await this.db!.select<{ count: number }[]>(
            `SELECT COUNT(*) as count FROM media${where}`,
            qp
          ))[0]?.count ?? 0;
      }
      const totalPages = Math.ceil(total / pageSize);
      // 候选∩筛选：保持候选表 position 序，JS 侧等价筛选（避免优化器转大表扫描）。
      // 同筛选键 120s 内复用有序候选视图，翻页只对 view 切片，无需重复全量过滤。
      const cacheKey = `${this.kidModeActive ? 'k1' : 'k0'}|${params.type ?? ''}|${params.year ?? ''}|${params.area ?? ''}|${params.genre ?? ''}|${params.subType ?? ''}|${params.isShortDrama !== undefined ? (params.isShortDrama ? 's1' : 's0') : ''}`;
      let view = this.recommendViewCache && this.recommendViewCache.key === cacheKey && Date.now() - this.recommendViewCache.at < 120000
        ? this.recommendViewCache.view
        : null;
      if (!view) {
        const candAll = await this.db!.select<{ media_id: number }[]>(
          `SELECT media_id FROM recommend_candidates ORDER BY position`
        );
        const candRows = new Map<number, any>();
        const PK_BATCH = 400;
        for (let i = 0; i < candAll.length; i += PK_BATCH) {
          const chunk = candAll.slice(i, i + PK_BATCH).map((r) => r.media_id);
          const hit = await this.db!.select<any[]>(
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
      let items: any[] = [];
      if (slice.length > 0) {
        const rows = await this.db!.select<any[]>(
          `SELECT * FROM media WHERE id IN (${slice.map(() => '?').join(',')})`,
          slice
        );
        const byId = new Map(rows.map((r) => [r.id, r]));
        items = slice.map((id) => byId.get(id)).filter(Boolean) as any[];
      }
      // 候选段不足一页时，以候选外全量按 updated_at 兜底补齐（保证每页可翻满）
      if (items.length < pageSize) {
        const tailRows = await this.db!.select<any[]>(
          `SELECT * FROM media m${whereM} AND NOT EXISTS (SELECT 1 FROM recommend_candidates rc WHERE rc.media_id = m.id)
           ORDER BY m.updated_at DESC LIMIT ? OFFSET ?`,
          [...qpM, pageSize - items.length, Math.max(0, offset - candCnt)]
        );
        items = items.concat(tailRows);
      }
      return { items: items.map(rowToMedia), meta: { page, pageSize, total, totalPages } };
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

    const total =
      params.knownTotal ??
      (await this.db!.select<{ count: number }[]>(
        `SELECT COUNT(*) as count FROM media${where}`,
        qp
      ))[0]?.count ??
      0;
    const totalPages = Math.ceil(total / pageSize);

    const rows = await this.db!.select<any[]>(
      `SELECT * FROM media${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...qp, pageSize, offset]
    );

    return { items: rows.map(rowToMedia), meta: { page, pageSize, total, totalPages } };
  }

  async upsertMedia(media: Media): Promise<void> {
    const now = new Date().toISOString();
    // id 由 INTEGER 主键自动分配（rowid 别名），ON CONFLICT(fingerprint) 冲突时保留已存在 id
    await this.db!.execute(
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
    await this.db!.execute(
      `UPDATE media SET status = ?, current_episodes = ?, total_episodes = ?, updated_at = ? WHERE id = ?`,
      [status, currentEpisodes, totalEpisodes, updatedAt, mediaId]
    );
  }

  async updateSourceSync(mediaId: number, sourceUpdatedAt: string | null, vodId: string | null): Promise<void> {
    await this.db!.execute(`UPDATE media SET source_updated_at = ?, vod_id = ? WHERE id = ?`, [sourceUpdatedAt, vodId, mediaId]);
  }

  async getMediaByVodId(vodId: string): Promise<Media | null> {
    const rows = await this.db!.select<any[]>('SELECT * FROM media WHERE vod_id = ? LIMIT 1', [vodId]);
    return rows[0] ? rowToMedia(rows[0]) : null;
  }

  async updateMediaPoster(mediaId: number, posterUrl: string | null, updatedAt: string): Promise<void> {
    await this.db!.execute(
      `UPDATE media SET poster_url = ?, updated_at = ? WHERE id = ?`,
      [posterUrl, updatedAt, mediaId]
    );
  }

  async updateMediaRating(
    mediaId: number,
    data: { rating: number | null; ratingCount: number | null; source: 'DOUBAN'; updatedAt: string }
  ): Promise<void> {
    await this.db!.execute(
      `UPDATE media SET rating = ?, rating_count = ?, rating_source = ?, rating_updated_at = ? WHERE id = ?`,
      [data.rating, data.ratingCount, data.source, data.updatedAt, mediaId]
    );
  }

  async incrementViewCount(id: number): Promise<void> {
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
      const countRows = await this.db!.select<{ count: number }[]>(
        `SELECT COUNT(*) as count FROM media_fts f JOIN media m ON m.rowid = f.rowid${whereClause}`,
        queryParams
      );
      const total = countRows[0]?.count || 0;
      const totalPages = Math.ceil(total / pageSize);

      const rows = await this.db!.select<any[]>(
        `SELECT m.* FROM media_fts f JOIN media m ON m.rowid = f.rowid
         ${whereClause}
         ORDER BY m.updated_at DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, pageSize, offset]
      );
      return { items: rows.map(rowToMedia), meta: { page, pageSize, total, totalPages } };
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
       ORDER BY m.updated_at DESC
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
    if (this.kidModeActive) {
      whereClause += ' AND kid_safe = 1';
    }
    const params: any[] = [];
    if (type) {
      whereClause += ' AND type = ?';
      params.push(type);
    }
    if (firstOnly) {
      const rows = await this.db!.select<{ genre: string }[]>(
        `SELECT DISTINCT genre FROM media ${whereClause}`,
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
    if (this.kidModeActive) {
      whereClause += ' AND kid_safe = 1';
    }
    const params: any[] = [];
    if (type) {
      whereClause += ' AND type = ?';
      params.push(type);
    }
    const dislikedRows = await this.db!.select<{ count: number }[]>(
      'SELECT COUNT(*) as count FROM dislike'
    );
    if ((dislikedRows[0]?.count || 0) > 0) {
      whereClause += ' AND id NOT IN (SELECT media_id FROM dislike)';
    }
    const rows = await this.db!.select<{ year: number }[]>(
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
    const rows = await this.db!.select<{ area: string }[]>(
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
    const rows = await this.db!.select<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM media ${whereClause}`,
      params
    );
    return (rows[0]?.count || 0) > 0;
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
    const rows = await this.db!.select<any[]>(sql, params);
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
    const rows = await this.db!.select<any[]>(sql, params);
    return rows.map(rowToVideoSource);
  }

  async getEpisodeById(id: number): Promise<Episode | null> {
    const rows = await this.db!.select<any[]>('SELECT * FROM episode WHERE id = ?', [id]);
    return rows[0] ? rowToEpisode(rows[0]) : null;
  }

  async upsertEpisode(episode: Episode): Promise<number> {
    await this.db!.execute(
      `INSERT INTO episode (media_id, season_number, episode_number, title, duration, source_id)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(media_id, season_number, episode_number, source_id) DO UPDATE SET
         title = excluded.title,
         duration = excluded.duration`,
      [episode.mediaId, episode.seasonNumber, episode.episodeNumber, episode.title || null, episode.duration || null, episode.sourceId || null]
    );
    // id 由 INTEGER 主键（rowid）分配；按业务键回读（source_id 以空串归一，NULL 视同 ''）
    const rows = await this.db!.select<{ id: number }[]>(
      `SELECT id FROM episode
       WHERE media_id = ? AND season_number = ? AND episode_number = ?
         AND COALESCE(source_id, '') = COALESCE(?, '')
       LIMIT 1`,
      [episode.mediaId, episode.seasonNumber, episode.episodeNumber, episode.sourceId || null]
    );
    return rows[0]?.id ?? 0;
  }

  async upsertEpisodesBatch(episodes: Episode[]): Promise<Map<string, number>> {
    const CHUNK = 100;
    for (let i = 0; i < episodes.length; i += CHUNK) {
      const chunk = episodes.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
      const params: unknown[] = [];
      for (const e of chunk) {
        params.push(e.mediaId, e.seasonNumber, e.episodeNumber, e.title || null, e.duration || null, e.sourceId || null);
      }
      await this.db!.execute(
        `INSERT INTO episode (media_id, season_number, episode_number, title, duration, source_id)
         VALUES ${placeholders}
         ON CONFLICT(media_id, season_number, episode_number, source_id) DO UPDATE SET
           title = excluded.title,
           duration = excluded.duration`,
        params
      );
    }
    // 统一回读本批次涉及的 media 全量 episode，构造 `season:ep:sourceId` → id 映射
    const mediaIds = Array.from(new Set(episodes.map((e) => e.mediaId)));
    const map = new Map<string, number>();
    if (mediaIds.length === 0) return map;
    const rows = await this.db!.select<
      { id: number; media_id: number; season_number: number; episode_number: number; source_id: string | null }[]
    >(
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
    await this.db!.execute('UPDATE episode SET duration = ? WHERE id = ?', [duration ?? null, episodeId]);
  }

  async deleteEpisodesByMediaIdAndSourceId(mediaId: number, sourceId: string): Promise<void> {
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

  async deleteMediaCompletely(mediaId: number): Promise<void> {
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

    const mediaWithoutPlaySource = await this.db!.select<{ id: number }[]>(
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
    // 指纹跳过：hidden_genre 未变化则无需重扫 media（避免每次启动 20 万行全表扫 12s+）
    const genreRows = await this.db!.select<{ sub_type: string }[]>(
      'SELECT sub_type FROM hidden_genre ORDER BY sub_type'
    );
    const fingerprint = JSON.stringify(genreRows.map((r) => r.sub_type));
    const cfgRows = await this.db!.select<{ value: string }[]>(
      "SELECT value FROM system_config WHERE key = 'db.hiddenGenreFingerprint'"
    );
    if (cfgRows.length > 0 && cfgRows[0].value === fingerprint) return 0;

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
    const now = new Date().toISOString();
    await this.db!.execute(
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
    const rows = await this.db!.select<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM media${whereClause}`,
      params
    );
    return rows[0]?.count || 0;
  }

  async getSeasonsByMediaId(mediaId: number): Promise<number[]> {
    const rows = await this.db!.select<{ season_number: number }[]>(
      'SELECT DISTINCT season_number FROM episode WHERE media_id = ? ORDER BY season_number ASC',
      [mediaId]
    );
    return rows.map(row => row.season_number);
  }

  // —— PlaySource DAO ——
  async getPlaySourcesByEpisodeId(episodeId: number): Promise<PlaySource[]> {
    const rows = await this.db!.select<any[]>('SELECT * FROM play_source WHERE episode_id = ?', [episodeId]);
    return rows.map(rowToPlaySource);
  }

  async hasVersionEpisodes(mediaId: number, sourceId: string): Promise<boolean> {
    const rows = await this.db!.select<{ r: number }[]>(
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
    const rows = await this.db!.select<{ url: string }[]>(
      `SELECT ps.url FROM play_source ps
       JOIN episode e ON e.id = ps.episode_id
       WHERE e.media_id = ? AND e.source_id = ?`,
      [mediaId, sourceId]
    );
    return rows.map((r) => r.url);
  }

  async getPlaySourceLanguagesByMedia(mediaId: number): Promise<{ language: string; episodeId: number; sourceId: string }[]> {
    const rows = await this.db!.select<{ language: string; episode_id: number; source_id: string }[]>(
      `SELECT DISTINCT ps.language, e.id AS episode_id, e.source_id
       FROM play_source ps
       JOIN episode e ON e.id = ps.episode_id
       WHERE e.media_id = ? AND ps.language IS NOT NULL AND ps.language <> ''`,
      [mediaId]
    );
    return rows.map((r) => ({ language: r.language, episodeId: r.episode_id, sourceId: r.source_id }));
  }

  async upsertPlaySource(playSource: PlaySource): Promise<void> {
    await this.db!.execute(
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
      const params: unknown[] = [];
      for (const p of chunk) {
        params.push(p.episodeId, p.sourceId, p.sourceName || null, p.url, p.quality || null, p.language || null, 1, 0, null);
      }
      await this.db!.execute(
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

  async isFavorite(mediaId: number): Promise<boolean> {
    const rows = await this.db!.select<{ count: number }[]>('SELECT COUNT(*) as count FROM favorite WHERE media_id = ?', [mediaId]);
    return (rows[0]?.count || 0) > 0;
  }

  async addFavorite(mediaId: number): Promise<void> {
    const now = new Date().toISOString();
    const id = `fav_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    // INSERT OR IGNORE + uq_favorite_media_id UNIQUE 索引兜底：同一 media 重复收藏静默忽略
    await this.db!.execute('INSERT OR IGNORE INTO favorite (id, media_id, created_at) VALUES (?, ?, ?)', [id, mediaId, now]);
  }

  async removeFavorite(mediaId: number): Promise<void> {
    await this.db!.execute('DELETE FROM favorite WHERE media_id = ?', [mediaId]);
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

  async getWatchHistoryByEpisodeId(mediaId: number, episodeId: number): Promise<WatchHistory | null> {
    const rows = await this.db!.select<any[]>(
      'SELECT * FROM watch_history WHERE media_id = ? AND episode_id = ? ORDER BY updated_at DESC LIMIT 1',
      [mediaId, episodeId]
    );
    return rows[0] ? rowToWatchHistory(rows[0]) : null;
  }

  async getAllWatchHistoryByMediaId(mediaId: number): Promise<WatchHistory[]> {
    const rows = await this.db!.select<any[]>(
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
    await this.db!.execute(
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
      await this.db!.execute('DELETE FROM watch_history');
      await this.db!.execute('DELETE FROM watch_line_progress');
    }

    async deleteWatchHistory(mediaId: number): Promise<void> {
      await this.db!.execute('DELETE FROM watch_history WHERE media_id = ?', [mediaId]);
      await this.db!.execute('DELETE FROM watch_line_progress WHERE media_id = ?', [mediaId]);
    }

    // —— WatchLineProgress DAO ——
    async getWatchLineProgressByPlaySource(mediaId: number, episodeId: number, playSourceId: number): Promise<WatchHistory | null> {
      const rows = await this.db!.select<any[]>(
        'SELECT * FROM watch_line_progress WHERE media_id = ? AND episode_id = ? AND play_source_id = ? LIMIT 1',
        [mediaId, episodeId, playSourceId]
      );
      return rows[0] ? rowToWatchHistory(rows[0]) : null;
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

  async recordImpressions(items: { mediaId: number; shownAt: string }[]): Promise<number[]> {
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
    const rows = await this.db!.select<{ media_id: number }[]>(
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

  async replaceRecommendationCandidates(rows: {
    mediaId: number;
    position: number;
    score: number;
    genreGroup: string;
  }[]): Promise<void> {
    await this.db!.execute('DELETE FROM recommend_candidates');
    const batchSize = 300;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const placeholders = batch.map(() => '(?, ?, ?, ?)').join(', ');
      const params: any[] = [];
      for (const r of batch) {
        params.push(r.mediaId, r.position, r.score, r.genreGroup);
      }
      await this.db!.execute(
        `INSERT INTO recommend_candidates (media_id, position, score, genre_group) VALUES ${placeholders}`,
        params
      );
    }
  }

  async resetRecommendationData(): Promise<void> {
    await this.db!.execute('DELETE FROM impression');
    await this.db!.execute('DELETE FROM user_interest_tag');
    await this.db!.execute('DELETE FROM recommend_candidates');
    await this.db!.execute('UPDATE media SET personal_score = 0');
  }

  async getDislikedMediaDetail(): Promise<{ mediaId: number; title: string; createdAt: string }[]> {
    const rows = await this.db!.select<{ media_id: number; title: string; created_at: string }[]>(
      `SELECT d.media_id, COALESCE(m.title, '') AS title, COALESCE(d.created_at, '') AS created_at
       FROM dislike d LEFT JOIN media m ON m.id = d.media_id
       ORDER BY d.created_at DESC`
    );
    return rows.map((r) => ({ mediaId: r.media_id, title: r.title, createdAt: r.created_at }));
  }

  async addDislike(mediaId: number): Promise<void> {
    await this.db!.execute(
      'INSERT INTO dislike (media_id, created_at) VALUES (?, ?) ON CONFLICT(media_id) DO UPDATE SET created_at = excluded.created_at',
      [mediaId, new Date().toISOString()]
    );
  }

  async removeDislike(mediaId: number): Promise<void> {
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
    const rows = await this.db!.select<any[]>(
      'SELECT * FROM collect_task WHERE task_id = ?',
      [taskId]
    );
    if (rows.length === 0) return null;
    return rowToCollectTask(rows[0]);
  }

  async getAllCollectTasks(): Promise<CollectTask[]> {
    const t0 = Date.now();
    const rows = await this.db!.select<any[]>(
      'SELECT * FROM collect_task ORDER BY created_at DESC'
    );
    const dt = Date.now() - t0;
    if (dt > 50) console.error(`[CollectTask] listQuery desktop dt=${dt}ms rows=${rows.length}`);
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
    const affected = result?.rowsAffected ?? 0;
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

  // ────────────────────────────────────────────────────────────────
  // 数据库查看工具（只读）
  // 全部走现有 db 读锁与重试，不抢写锁；写语句/多语句一律拦截。
  // ────────────────────────────────────────────────────────────────

  private static readonly INSPECTOR_QUERY_PREFIXES = ['SELECT', 'WITH', 'EXPLAIN'];
  private static readonly INSPECTOR_READONLY_PRAGMAS = new Set([
    'table_info', 'index_list', 'index_info', 'foreign_key_list', 'table_list',
    'database_list', 'page_count', 'page_size', 'journal_mode', 'freelist_count',
    'schema_version', 'user_version', 'compile_options', 'collation_list', 'function_list',
  ]);
  /** 表名/列名标识符白名单：仅允许普通 SQL 标识符，防注入 */
  private static readonly IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

  /**
   * 只读 SQL 查询入口：仅允许 SELECT / WITH / EXPLAIN / 白名单 PRAGMA。
   * 返回 { columns, rows }，边界结果列名取首行 key。
   */
  async runInspectorQuery(sql: string, params?: any[]): Promise<{ columns: string[]; rows: any[][] }> {
    const trimmed = sql.trim().replace(/\s*;+\s*$/, '').trim();
    if (!trimmed) return { columns: [], rows: [] };
    if (trimmed.includes(';')) {
      throw new Error('仅支持单条查询：禁止分号与多语句');
    }
    const upper = trimmed.toUpperCase().replace(/\s+/g, ' ').trim();
    if (upper.startsWith('PRAGMA ')) {
      const m = upper.match(/^PRAGMA\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (!m || !TauriSqlProvider.INSPECTOR_READONLY_PRAGMAS.has(m[1].toLowerCase())) {
        throw new Error(`PRAGMA "${m?.[1] ?? ''}" 不在只读白名单内`);
      }
    } else if (!TauriSqlProvider.INSPECTOR_QUERY_PREFIXES.some((p) => upper.startsWith(p + ' '))) {
      throw new Error('只读工具：仅允许 SELECT / WITH / EXPLAIN / 白名单 PRAGMA');
    }
    const start = Date.now();
    const rows = await this.db!.select<any[]>(trimmed, params);
    const columns = rows[0] ? Object.keys(rows[0]) : [];
    return { columns, rows: rows.map((r) => columns.map((c) => r[c])) };
  }

  /**
   * 库概览：全部表（含 FTS 虚拟表/辅助表/视图）+ 行数 + 主库 page 信息与大小。
   */
  async getInspectorOverview(): Promise<{
    tables: { name: string; kind: 'table' | 'view' | 'fts' | 'shadow'; rowCount: number }[];
    pageSize: number;
    pageCount: number;
    dbSizeBytes: number;
    journalMode: string;
  }> {
    const objs = await this.db!.select<{ name: string; type: string; sql: string | null }[]>(
      "SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    const tables = objs.map((o) => {
      let kind: 'table' | 'view' | 'fts' | 'shadow' = 'table';
      if (o.type === 'view') kind = 'view';
      else if (o.sql === null) kind = 'shadow';
      else if (o.sql.toUpperCase().includes('CREATE VIRTUAL TABLE')) kind = 'fts';
      return { name: o.name, kind, rowCount: 0 };
    });
    // 并行统计行数（读锁并发 6 限流，安全仅读）。
    // FTS5 辅助表跳过计数（内部 xCount 不可靠），虚拟表/大表沿用超时兜底，避免拖垮整个概览。
    await Promise.all(
      tables.map(async (t) => {
        if (t.kind === 'shadow') { t.rowCount = -1; return; }
        const countSql = `SELECT COUNT(*) AS c FROM "${t.name}"`;
        const timeout = new Promise<{ c: number }[]>((resolve) =>
          setTimeout(() => resolve([{ c: -1 }]), 15000)
        );
        try {
          const rows = await Promise.race<{ c: number }[]>([
            this.db!.select<{ c: number }[]>(countSql).catch(() => [{ c: -1 }] as { c: number }[]),
            timeout,
          ]);
          t.rowCount = rows[0]?.c ?? -1;
        } catch {
          t.rowCount = -1;
        }
      })
    );
    const [pageSize, pageCount, journalMode] = await Promise.all([
      this.db!.select<{ page_size: number }[]>('SELECT * FROM pragma_page_size').then((r) => r[0]?.page_size ?? 4096).catch(() => 4096),
      this.db!.select<{ page_count: number }[]>('SELECT * FROM pragma_page_count').then((r) => r[0]?.page_count ?? 0).catch(() => 0),
      this.db!.select<{ journal_mode: string }[]>('PRAGMA journal_mode').then((r) => r[0]?.journal_mode ?? 'unknown').catch(() => 'unknown'),
    ]);
    return { tables, pageSize, pageCount, dbSizeBytes: pageSize * pageCount, journalMode };
  }

  /**
   * 单表详情：列（PRAGMA table_info）+ 索引（含索引列）+ 外键 + 触发器。
   * 表名必须通过合法标识符校验，否则抛错（防注入）。
   */
  async getInspectorTableDetail(tableName: string): Promise<{
    columns: { cid: number; name: string; type: string; notnull: number; dflt_value: any; pk: number }[];
    indexes: { seq: number; name: string; unique: number; origin: string; partial: number; cols: string[] }[];
    foreignKeys: { id: number; seq: number; table: string; from: string; to: string | null; on_update: string; on_delete: string; match: string }[];
    triggers: { name: string; sql: string | null }[];
  }> {
    if (!TauriSqlProvider.IDENTIFIER_RE.test(tableName)) {
      throw new Error('非法表名');
    }
    const columns = await this.db!.select<any[]>(`PRAGMA table_info('${tableName}')`);
    const indexesRaw = await this.db!.select<any[]>(`PRAGMA index_list('${tableName}')`);
    const indexes = await Promise.all(
      indexesRaw.map(async (idx) => {
        const info = await this.db!.select<any[]>(`PRAGMA index_info('${idx.name}')`);
        return {
          seq: idx.seq, name: idx.name, unique: idx.unique, origin: idx.origin,
          partial: idx.partial, cols: info.map((r) => r.name),
        };
      })
    );
    const foreignKeys = await this.db!.select<any[]>(`PRAGMA foreign_key_list('${tableName}')`);
    const triggers = await this.db!.select<{ name: string; sql: string | null }[]>(
      "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? ORDER BY name",
      [tableName]
    );
    return { columns, indexes, foreignKeys, triggers };
  }

  /**
   * 单表数据分页浏览：默认按 rowid 稳定排序，避免深页无确定性。
   * 表名/排序列均需通过标识符白名单校验。
   */
  async getInspectorTableData(
    tableName: string,
    page: number,
    pageSize: number,
    orderCol?: string
  ): Promise<{ columns: string[]; rows: any[][]; rowCount: number; page: number; pageSize: number; totalPages: number }> {
    if (!TauriSqlProvider.IDENTIFIER_RE.test(tableName)) {
      throw new Error('非法表名');
    }
    if (orderCol && !TauriSqlProvider.IDENTIFIER_RE.test(orderCol)) {
      throw new Error('非法排序列');
    }
    const offset = (page - 1) * pageSize;
    const orderBy = orderCol ? `"${orderCol}"` : 'rowid';
    const [countRows, dataRows] = await Promise.all([
      this.db!.select<{ c: number }[]>(`SELECT COUNT(*) AS c FROM "${tableName}"`).catch(() => [{ c: -1 } as any]),
      this.db!.select<any[]>(
        `SELECT * FROM "${tableName}" ORDER BY ${orderBy} ASC LIMIT ? OFFSET ?`,
        [pageSize, offset]
      ),
    ]);
    const rowCount = countRows[0]?.c ?? -1;
    // 空结果时以表结构列兜底（避免首行无列名可显示）
    let columns: string[] = dataRows[0] ? Object.keys(dataRows[0]) : [];
    if (columns.length === 0) {
      const cols = await this.db!.select<any[]>(`PRAGMA table_info('${tableName}')`);
      columns = cols.map((c) => c.name);
    }
    return {
      columns,
      rows: dataRows.map((r) => columns.map((c) => r[c])),
      rowCount,
      page,
      pageSize,
      totalPages: rowCount <= 0 ? 1 : Math.ceil(rowCount / pageSize),
    };
  }
}
