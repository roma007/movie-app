import type { DatabaseProvider } from '../db/provider';
import { normalizer } from '../utils/normalizer';

export async function backfillSeriesGroup(db: DatabaseProvider): Promise<number> {
  const rows = await db.select<{ id: string; fingerprint: string; series_group: string | null; series_season: number | null }>(
    `SELECT id, fingerprint, series_group, series_season FROM media`
  );
  if (rows.length === 0) return 0;

  let updated = 0;
  for (const row of rows) {
    const seriesGroup = normalizer.extractSeriesGroup(row.fingerprint);
    const seriesSeason = normalizer.extractSeriesSeason(row.fingerprint);
    if (seriesGroup === row.series_group && seriesSeason === row.series_season) continue;
    await db.execute(`UPDATE media SET series_group = ?, series_season = ? WHERE id = ?`, [seriesGroup, seriesSeason, row.id]);
    updated++;
  }
  return updated;
}
