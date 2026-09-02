import type { ChangeLog, RemoteChange, SyncConfig, SyncPayload, SyncResult } from '../types';
import type { DatabaseProvider } from '../db/provider';
import type { CloudProvider } from './cloudProvider';
import { SYNC_ROOT, SYNC_DIRS, cloudPath } from './cloudProvider';
import { buildPayload } from './changeTracker';
import { shouldApply } from './conflictResolver';
import { categoryEnabled } from './categories';

const PUSH_CHUNK = 200;
const PULL_FILE_LIMIT = 50;
const DAY_MS = 24 * 3600 * 1000;
/** 周期重建全量备份的触发量（本轮 push+pull 变更数） */
const BACKUP_REBUILD_MIN_CHANGES = 1000;
/** 备份文件 schema 版本（2.9bis-8）：未来 schema 演进时自增，不兼容则跳过恢复 */
export const BACKUP_SCHEMA_VERSION = 1;
/** 同步表白名单（2.12 11 表；episode/play_source 作为 media 子集随行，不独立出队） */
const BACKUP_TABLES = ['media', 'video_source', 'episode', 'play_source', 'favorite', 'dislike', 'watch_history', 'watch_line_progress', 'system_config', 'hidden_genre', 'user_interest_tag'] as const;
/** restore 时独立逐行落地的表（episode/play_source 由 media 子集重建消费） */
const RESTORE_ROW_TABLES = ['video_source', 'favorite', 'dislike', 'watch_history', 'watch_line_progress', 'system_config', 'hidden_genre', 'user_interest_tag'] as const;
const SYSTEM_EXCLUDED_KEYS = ['device_id', 'sync_config'];

export interface PullAppliedResult {
  applied: number;
  processed: number;
}

/** 解析备份/载荷等云端 JSON 失败时的统一错误 */
export class SyncError extends Error {}

function recordKeyOf(table: string, row: Record<string, unknown>): string {
  switch (table) {
    case 'favorite':
    case 'dislike':
    case 'hidden_genre':
      return String(row.media_id ?? row.sub_type ?? '');
    case 'system_config':
      return String(row.key ?? '');
    case 'watch_history':
      return String(row.id ?? '');
    case 'watch_line_progress':
      return `${row.media_id}:${row.episode_id}:${row.play_source_id}`;
    case 'user_interest_tag':
      return `${row.tag}:${row.tag_type}`;
    case 'media':
      return String(row.fingerprint ?? row.id ?? '');
    case 'video_source':
      return String(row.code ?? row.id ?? '');
    default:
      return String(row.id ?? '');
  }
}

function subtreeSourceIds(episodes: any[]): string[] {
  const ids = new Set<string>();
  for (const ep of episodes) if (ep.source_id) ids.add(ep.source_id);
  return Array.from(ids);
}

export class SyncEngine {
  constructor(private db: DatabaseProvider, private cloud: CloudProvider) {}

  /** 完整一轮：ensureDirs → 首备/周期重建 → pull → push → purge */
  async syncNow(): Promise<SyncResult> {
    const config = await this.db.getSyncConfig();
    if (!config?.enabled) return { pushed: 0, pulled: 0, applied: 0 };
    const deviceId = await this.db.getDeviceId();
    if (!deviceId) return { pushed: 0, pulled: 0, applied: 0 };

    const changesRoot = `${SYNC_ROOT}/${SYNC_DIRS.changes}`;
    await this.cloud.ensurePath(`${changesRoot}/${deviceId}`);
    await this.cloud.ensurePath(cloudPath('backups', deviceId));

    const firstEnable = !config.lastBackupAt;
    if (firstEnable) {
      await this.uploadBackup(deviceId);
      await this.enqueueAllForSync(deviceId);
      await this.touchLastBackupAt();
    }

    const pull = await this.pull(config, deviceId, changesRoot);
    const push = await this.push(config, deviceId);

    const total = push.pushed + pull.applied;
    const lastBackupTs = config.lastBackupAt ? new Date(config.lastBackupAt).getTime() : 0;
    if ((config.lastBackupAt != null && Date.now() - lastBackupTs >= DAY_MS) || total >= BACKUP_REBUILD_MIN_CHANGES) {
      await this.uploadBackup(deviceId);
      await this.touchLastBackupAt();
    }

    await this.db.purgeSyncedChanges(Date.now() - 7 * DAY_MS);
    return { pushed: push.pushed, pulled: pull.applied, applied: pull.applied };
  }

  /** 推送：unsynced id ASC 分片 ≤200/片，大子集 media 单行独占一文件 */
  async push(config: SyncConfig, deviceId: string): Promise<{ pushed: number }> {
    const rows = await this.db.getUnsyncedChanges();
    if (!rows.length) return { pushed: 0 };

    // 过滤关闭类（保险，类关闭时已清积压）
    const active = rows.filter((r) => categoryEnabled(config.categories, r.tableName));
    const payloads = await this.chunkRows(active);
    let pushed = 0;
    let seq = 0;
    for (const chunk of payloads) {
      const { changes, pruneIds } = await buildPayload(chunk, this.db, deviceId);
      const allIds = chunk.map((r) => r.id);
      if (!changes.length) {
        await this.markSyncedRetry(allIds);
        continue;
      }
      const file = `${Date.now()}_${seq++}.json`;
      await this.cloud.writeJson(cloudPath('changes', deviceId, file), {
        deviceId,
        timestamp: Date.now(),
        changes,
      });
      await this.markSyncedRetry(allIds);
      pushed += changes.length;
      void pruneIds;
    }
    return { pushed };
  }

  /** 拉取：其它设备目录文件单轮 ≤50，GET→apply→DELETE；404 跳过 */
  async pull(config: SyncConfig, deviceId: string, changesRoot: string): Promise<PullAppliedResult> {
    const dirs = await this.cloud.listFiles(changesRoot);
    let applied = 0;
    let processed = 0;
    for (const dir of dirs) {
      if (dir === deviceId) continue; // 跳过自己防回声
      const files = await this.cloud.listFiles(`${changesRoot}/${dir}`);
      for (const name of files) {
        if (processed >= PULL_FILE_LIMIT) return { applied, processed };
        const path = `${changesRoot}/${dir}/${name}`;
        const payload = (await this.cloud.readJson(path)) as SyncPayload | null;
        if (payload == null) continue; // 404 = 已被其它设备消费，非错误（2.9.8）
        const n = await this.apply(config, payload, deviceId);
        await this.cloud.deleteFile(path);
        applied += n;
        processed++;
      }
    }
    return { applied, processed };
  }

  /**
   * 应用一个云端文件（二阶段 + 分类过滤 + 类回声清理）。
   * 文件级原子性说明（偏离）：媒体子集重建自身含事务，嵌套全局 BEGIN 会触发
   * "cannot start a transaction within a transaction"，故本层采用「两阶段顺序 +
   * 逐条 apply，任一条失败即整体抛错不消费文件（保留重试）」的等效应力（幂等 upsert
   * 兜底跨轮重放）。失败文件保留云端，与「全部成功才标记消费」效果一致。
   */
  async apply(config: SyncConfig, payload: SyncPayload, localDeviceId: string): Promise<number> {
    const sinceId = await this.db.getMaxChangeLogId();
    const deletes: RemoteChange[] = [];
    const upserts: RemoteChange[] = [];
    for (const c of payload.changes) {
      const ch: RemoteChange = { ...c, _remoteTs: c.timestamp ?? payload.timestamp };
      if (!categoryEnabled(config.categories, ch.table)) continue;
      if (ch.table === 'system_config' && SYSTEM_EXCLUDED_KEYS.includes(ch.recordId)) continue;
      const localTs = await this.db.getLastChangeTime(ch.table, ch.recordId);
      if (!shouldApply({ remote: ch, localLastTs: localTs, localExists: localTs != null, localDeviceId })) continue;
      if (ch.operation === 'DELETE') deletes.push(ch);
      else upserts.push(ch);
    }
    let applied = 0;
    for (const ch of [...deletes, ...upserts]) {
      await this.db.applyRemoteChange(ch.table, ch.recordId, ch.operation, ch.data ?? null);
      await this.db.setEchoTimestamp(sinceId, ch.table, ch.recordId, ch.timestamp, localDeviceId);
      applied++;
    }
    await this.db.clearEchoChanges(sinceId);
    return applied;
  }

  /** 首次启用入队存量（8 表，media/episode/play_source 不入队，见 II-5） */
  async enqueueAllForSync(deviceId: string): Promise<void> {
    const now = Date.now();
    const stmts: string[] = [
      `INSERT INTO change_log (table_name, record_id, operation, device_id, timestamp)
         SELECT 'favorite', media_id, 'INSERT', ?, ? FROM favorite`,
      `INSERT INTO change_log (table_name, record_id, operation, device_id, timestamp)
         SELECT 'dislike', media_id, 'INSERT', ?, ? FROM dislike`,
      `INSERT INTO change_log (table_name, record_id, operation, device_id, timestamp)
         SELECT 'watch_history', id, 'INSERT', ?, ? FROM watch_history`,
      `INSERT INTO change_log (table_name, record_id, operation, device_id, timestamp)
         SELECT 'watch_line_progress', media_id || ':' || episode_id || ':' || play_source_id, 'INSERT', ?, ? FROM watch_line_progress`,
      `INSERT INTO change_log (table_name, record_id, operation, device_id, timestamp)
         SELECT 'hidden_genre', sub_type, 'INSERT', ?, ? FROM hidden_genre`,
      `INSERT INTO change_log (table_name, record_id, operation, device_id, timestamp)
         SELECT 'user_interest_tag', tag || ':' || tag_type, 'INSERT', ?, ? FROM user_interest_tag`,
      `INSERT INTO change_log (table_name, record_id, operation, device_id, timestamp)
         SELECT 'system_config', key, 'INSERT', ?, ? FROM system_config WHERE key NOT IN (?, ?)`,
      `INSERT INTO change_log (table_name, record_id, operation, device_id, timestamp)
         SELECT 'video_source', COALESCE(code, id), 'INSERT', ?, ? FROM video_source`,
    ];
    for (const sql of stmts) {
      const params = sql.includes('WHERE key NOT IN')
        ? [deviceId, now, ...SYSTEM_EXCLUDED_KEYS]
        : [deviceId, now];
      await this.db.execute(sql, params);
    }
  }

  /** 全量备份（2.9bis-8 元信息 + 11 表逐行 + 派生态排除 + 轮转仅 1 份） */
  async uploadBackup(deviceId: string): Promise<void> {
    const tables: Record<string, unknown[]> = {};
    for (const table of BACKUP_TABLES) {
      const rows: any[] = await this.db.select<any>(`SELECT * FROM ${table}`, []);
      let kept = rows;
      if (table === 'media') kept = rows.map(stripCol('personal_score'));
      else if (table === 'video_source') kept = rows.map(stripCol('last_collected_at'));
      else if (table === 'system_config') kept = rows.filter((r) => !SYSTEM_EXCLUDED_KEYS.includes(r.key));
      tables[table] = kept;
    }
    const payload = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion: '1.0.0',
      createdAt: new Date().toISOString(),
      deviceId,
      tables,
    };
    await this.cloud.writeJson(cloudPath('backups', deviceId, 'backup.json'), payload);
  }

  /** 从备份恢复（空备份/离线由调用方静默处理；仅落地开启类，关闭类跳过） */
  async restoreFromBackup(deviceId: string, config: SyncConfig): Promise<number> {
    const payload = (await this.cloud.readJson(cloudPath('backups', deviceId, 'backup.json'))) as any;
    if (!payload || payload.schemaVersion !== BACKUP_SCHEMA_VERSION) return 0; // 2.9bis-8 不兼容跳过
    const tables = payload.tables ?? {};
    const episodesRows: any[] = tables.episode ?? [];
    const psRows: any[] = tables.play_source ?? [];
    const sinceId = await this.db.getMaxChangeLogId();

    // media 先恢复（子集重建），其它独立表其后；episode/play_source 由 media 消费
    const mediaRows: any[] = tables.media ?? [];
    const ordered: any[] = [...mediaRows];
    for (const table of RESTORE_ROW_TABLES) {
      for (const row of tables[table] ?? []) ordered.push({ __table: table, __row: row });
    }

    let applied = 0;
    for (const item of ordered) {
      const table = item.__table ?? 'media';
      const row = item.__row ?? item;
      if (!categoryEnabled(config.categories, table)) continue;
      if (table === 'system_config' && SYSTEM_EXCLUDED_KEYS.includes(row.key)) continue;
      const base = Object.fromEntries(Object.entries(row).filter(([k]) => k !== '__table' && k !== '__row'));
      let data: any = base;
      if (table === 'media') {
        // 恢复对媒体走 fingerprint 归并 + 本端子集重建（2.9bis-9/II-5）
        const es = episodesRows.filter((e) => e.media_id === base.id);
        const ps = psRows.filter((p) => es.some((e) => e.id === p.episode_id));
        data = { ...base, subtree: { remoteMediaId: base.id, sourceIds: subtreeSourceIds(es), episodes: es, playSources: ps } };
      }
      const recordId = base[table === 'media' ? 'fingerprint' : recordKeyOf(table, base)];
      await this.db.applyRemoteChange(table, String(recordId), 'INSERT', data);
      applied++;
    }
    await this.db.clearEchoChanges(sinceId);
    return applied;
  }

  /** 清理 7 天前已同步历史（保留每记录最后一条） */
  async purgeSyncedChanges(beforeTs?: number): Promise<number> {
    return this.db.purgeSyncedChanges(beforeTs ?? Date.now() - 7 * DAY_MS);
  }

  async deviceId(): Promise<string | null> {
    return this.db.getDeviceId();
  }

  async touchLastBackupAt(): Promise<void> {
    const config = await this.db.getSyncConfig();
    if (!config) return;
    await this.db.setSyncConfig({ ...config, lastBackupAt: new Date().toISOString() });
  }

  private async chunkRows(rows: ChangeLog[]): Promise<ChangeLog[][]> {
    const result: ChangeLog[][] = [];
    let cur: ChangeLog[] = [];
    for (const row of rows) {
      if (row.tableName === 'media') {
        if (cur.length) { result.push(cur); cur = []; }
        result.push([row]); // 媒体行独占（避免 >2MB 子集拖累同文件其它行）
        continue;
      }
      cur.push(row);
      if (cur.length >= PUSH_CHUNK) { result.push(cur); cur = []; }
    }
    if (cur.length) result.push(cur);
    return result;
  }

  private async markSyncedRetry(ids: number[]): Promise<void> {
    const attempts = 3;
    for (let i = 0; i < attempts; i++) {
      try {
        await this.db.markChangesSynced(ids);
        return;
      } catch (e) {
        if (i === attempts - 1) throw e;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  }
}

function stripCol(col: string) {
  return (row: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) if (k !== col) out[k] = v;
    return out;
  };
}