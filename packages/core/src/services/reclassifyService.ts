import type { DatabaseProvider } from '../db/provider';

const FLAG_KEY = 'data.reclassifyShortDramaV1';

interface ReclassifyRow {
  id: string;
  remarks: string | null;
}

function parseEpisodesFromRemarks(remarks: string | null): { current: number | null; total: number | null } {
  if (!remarks) return { current: null, total: null };
  const totalMatch = remarks.match(/全\s*(\d+)\s*集/) || remarks.match(/共\s*(\d+)\s*集/);
  const currentMatch = remarks.match(/更新至\s*(\d+)\s*集/) || remarks.match(/第\s*(\d+)\s*集/);
  const total = totalMatch ? parseInt(totalMatch[1], 10) : null;
  let current = currentMatch ? parseInt(currentMatch[1], 10) : null;
  if (total != null && current == null) current = total;
  return { current, total };
}

/**
 * 一次性存量修复：把被 AI 漫剧/短剧规则误归为 MOVIE 的多集短剧改为 TV。
 * 根因：mapType 曾对 isAiDrama 无条件返回 MOVIE，导致"全N集"的短剧被归为电影。
 * 修复范围保守：仅处理 type='MOVIE' 且 genre 含"漫剧/短剧" 且集数>1 的记录。
 * 用 system_config 键做守卫，整库只会执行一次；无候选时为空操作。
 */
export async function reclassifyShortDramaMovies(db: DatabaseProvider): Promise<number> {
  const flag = await db.selectOne<{ value: string }>('SELECT value FROM system_config WHERE key = ?', [FLAG_KEY]);
  if (flag) return 0;

  const rows = await db.select<ReclassifyRow>(
    `SELECT m.id, m.remarks
     FROM media m
     JOIN episode e ON e.media_id = m.id
     WHERE m.type = 'MOVIE'
       AND (m.genre LIKE '%漫剧%' OR m.genre LIKE '%短剧%')
     GROUP BY m.id
     HAVING COUNT(e.id) > 1`
  );

  let updated = 0;
  const now = new Date().toISOString();
  for (const row of rows) {
    const { current, total } = parseEpisodesFromRemarks(row.remarks);
    await db.execute(
      `UPDATE media
       SET type = 'TV', is_short_drama = 1,
           current_episodes = ?, total_episodes = ?, updated_at = ?
       WHERE id = ?`,
      [current, total, now, row.id]
    );
    updated++;
  }

  await db.execute(
    `INSERT INTO system_config (key, value, value_type, created_at, updated_at)
     VALUES (?, '1', 'string', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [FLAG_KEY, now, now]
  );

  return updated;
}
