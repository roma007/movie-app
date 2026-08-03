import type { DatabaseProvider } from '../db/provider';
import { isKnownDeadPosterUrl, isUsablePosterUrl } from '../utils/posterHost';

/**
 * 一次性存量修复：把已知失效图床（如 vod.dyttimage.com）的封面，
 * 替换为同一系列（series_group + series_season）下其它记录的有效封面。
 * 无同组可替代的保留原值（界面 onError 兜底显示占位图）。
 * 用 system_config 键做守卫，整库只会执行一次；无候选时为空操作。
 */
const REPAIR_FLAG = 'data.repairDeadPostersV1';

interface PosterRow {
  id: string;
  poster_url: string | null;
  series_group: string | null;
  series_season: number | null;
}

export async function repairDeadPosterUrls(db: DatabaseProvider): Promise<{ replaced: number }> {
  const flag = await db.selectOne<{ value: string }>('SELECT value FROM system_config WHERE key = ?', [REPAIR_FLAG]);
  if (flag) return { replaced: 0 };

  const rows = await db.select<PosterRow>(
    `SELECT id, poster_url, series_group, series_season FROM media
     WHERE poster_url IS NOT NULL AND poster_url != ''`
  );

  let replaced = 0;
  const now = new Date().toISOString();
  for (const row of rows) {
    if (!isKnownDeadPosterUrl(row.poster_url)) continue;
    if (!row.series_group || row.series_season == null) continue;

    const siblings = await db.select<PosterRow>(
      `SELECT id, poster_url FROM media
       WHERE series_group = ? AND series_season = ? AND id != ? AND poster_url IS NOT NULL AND poster_url != ''`,
      [row.series_group, row.series_season, row.id]
    );
    const replacement = siblings.map(s => s.poster_url).find(p => isUsablePosterUrl(p));
    if (!replacement) continue;

    await db.updateMediaPoster(row.id, replacement, now);
    replaced++;
  }

  await db.execute(
    `INSERT INTO system_config (key, value, value_type, created_at, updated_at)
     VALUES (?, '1', 'string', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [REPAIR_FLAG, now, now]
  );

  return { replaced };
}

/** 同系列去重合并：相同 series_group + 季 + 类型 + 名称的重复记录合并为一条。 */
const MERGE_FLAG = 'data.mergeSeriesDuplicatesV1';

interface MediaRow {
  id: string;
  title: string;
  poster_url: string | null;
  series_group: string;
  series_season: number;
  type: string;
  view_count: number;
  current_episodes: number | null;
  total_episodes: number | null;
  status: string | null;
}

/** 去空格归一化，用于跨源标题比对（如 "末日地堡第三季" 与 "末日地堡 第三季"） */
function normalizeCompareTitle(title: string): string {
  return (title || '').toLowerCase().replace(/[\s\u3000]+/g, '').trim();
}

function pickKeepRow(group: MediaRow[]): MediaRow {
  const sorted = [...group].sort((a, b) => {
    const aOk = isUsablePosterUrl(a.poster_url) ? 1 : 0;
    const bOk = isUsablePosterUrl(b.poster_url) ? 1 : 0;
    if (aOk !== bOk) return bOk - aOk;
    const aEps = a.current_episodes ?? 0;
    const bEps = b.current_episodes ?? 0;
    if (aEps !== bEps) return bEps - aEps;
    if (a.view_count !== b.view_count) return b.view_count - a.view_count;
    return a.id < b.id ? -1 : 1;
  });
  return sorted[0];
}

export async function mergeDuplicateSeriesMedia(db: DatabaseProvider): Promise<{ merged: number; removed: number }> {
  const flag = await db.selectOne<{ value: string }>('SELECT value FROM system_config WHERE key = ?', [MERGE_FLAG]);
  if (flag) return { merged: 0, removed: 0 };

  const rows = await db.select<MediaRow>(
    `SELECT id, title, poster_url, series_group, series_season, type,
            view_count, current_episodes, total_episodes, status
     FROM media
     WHERE series_group IS NOT NULL AND series_season IS NOT NULL`
  );

  const groups = new Map<string, MediaRow[]>();
  for (const row of rows) {
    const key = `${row.series_group}|${row.series_season}|${row.type}|${normalizeCompareTitle(row.title)}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  let merged = 0;
  let removed = 0;
  const now = new Date().toISOString();

  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    const keep = pickKeepRow(group);
    const dups = group.filter(r => r.id !== keep.id);

    for (const dup of dups) {
      // 集数（含各源播放地址）重挂到保留记录，id 不变故 play_source 不受影响
      await db.execute('UPDATE episode SET media_id = ? WHERE media_id = ?', [keep.id, dup.id]);
      await db.execute('UPDATE watch_history SET media_id = ? WHERE media_id = ?', [keep.id, dup.id]);

      const dupFav = await db.selectOne<{ id: string }>('SELECT id FROM favorite WHERE media_id = ?', [dup.id]);
      const keepFav = await db.selectOne<{ id: string }>('SELECT id FROM favorite WHERE media_id = ?', [keep.id]);
      if (dupFav && !keepFav) {
        await db.execute(
          'INSERT INTO favorite (id, media_id, created_at) VALUES (?, ?, ?)',
          [`fav_${keep.id}_${Date.now()}`, keep.id, now]
        );
      }

      await db.execute('DELETE FROM media WHERE id = ?', [dup.id]);
      removed++;
    }

    // 合并后收敛封面与集数/状态：封面优先取同组可用图
    const bestPoster = group.map(r => r.poster_url).find(p => isUsablePosterUrl(p)) ?? null;
    if (bestPoster && !isUsablePosterUrl(keep.poster_url) && keep.poster_url !== bestPoster) {
      await db.updateMediaPoster(keep.id, bestPoster, now);
    }

    const bestCurrent = Math.max(...group.map(r => r.current_episodes ?? 0)) || null;
    const bestTotal = Math.max(...group.map(r => r.total_episodes ?? 0)) || null;
    const statusRank: Record<string, number> = { COMPLETED: 3, ONGOING: 2, PUBLISHED: 1 };
    const bestStatus = group
      .filter(r => r.status)
      .sort((a, b) => (statusRank[b.status!] || 0) - (statusRank[a.status!] || 0))[0]?.status ?? null;
    if (
      bestCurrent !== (keep.current_episodes ?? 0) ||
      bestTotal !== (keep.total_episodes ?? 0) ||
      (bestStatus && bestStatus !== keep.status)
    ) {
      await db.updateMediaStatusAndEpisodes(keep.id, bestStatus ?? 'PUBLISHED', bestCurrent, bestTotal, now);
    }
    merged++;
  }

  await db.execute(
    `INSERT INTO system_config (key, value, value_type, created_at, updated_at)
     VALUES (?, '1', 'string', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [MERGE_FLAG, now, now]
  );

  return { merged, removed };
}
