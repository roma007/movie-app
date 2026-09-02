import type { ChangeLog, RemoteChange } from '../types';
import type { DatabaseProvider } from '../db/provider';
import type { MediaSubtreeSnapshot } from '../db/provider';

/**
 * 载荷组装（II-3，复用清单 C/D/I、教训 5）。
 * - 非 DELETE：现读行快照；无源行（重建型表等）→ 丢弃该变更（prune）
 * - DELETE：保留，data=null（供远端删除）
 * - media INSERT/UPDATE：现读行 + 子集快照附入 data.subtree（2.12 采集数据策略定案）
 */
export interface BuiltPayload {
  changes: RemoteChange[];
  /** 应被直接标记已同步的行 id（无源行裁剪，复用清单 I） */
  pruneIds: number[];
}

function subtreeSourceIds(episodes: any[]): string[] {
  const ids = new Set<string>();
  for (const ep of episodes) if (ep.source_id) ids.add(ep.source_id);
  return Array.from(ids);
}

export async function buildPayload(rows: ChangeLog[], db: DatabaseProvider, deviceId: string): Promise<BuiltPayload> {
  const changes: RemoteChange[] = [];
  const pruneIds: number[] = [];
  for (const r of rows) {
    if (r.operation === 'DELETE') {
      changes.push({
        table: r.tableName,
        recordId: r.recordId,
        operation: r.operation,
        timestamp: r.timestamp,
        data: null,
        deviceId,
      });
      continue;
    }
    const row = await db.readSyncRecord(r.tableName, r.recordId);
    if (!row) {
      pruneIds.push(r.id);
      continue;
    }
    if (r.tableName === 'media') {
      const subtree = await db.readMediaSubtree(row.id);
      row.subtree = {
        remoteMediaId: row.id,
        sourceIds: subtreeSourceIds(subtree.episodes),
        episodes: subtree.episodes,
        playSources: subtree.playSources,
      };
    }
    changes.push({
      table: r.tableName,
      recordId: r.recordId,
      operation: r.operation,
      timestamp: r.timestamp,
      data: row,
      deviceId,
    });
  }
  return { changes, pruneIds };
}