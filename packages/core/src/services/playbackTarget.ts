import type { DatabaseProvider } from '../db/provider';
import type { Media, WatchHistory } from '../types';

export interface DefaultPlayTarget {
  episodeId: string;
  sourceId: string;
  playSourceId?: string | null;
}

/**
 * 解析点击卡片后默认播放的目标（集 + 线路），实现「精准续播」。
 *
 * 优先级：
 * 1. 续播：取「最近观看的集」（按各集最新观看记录的 updatedAt 取最大者）：
 *    - 该集未看完（progress > 0 且未到片尾 nearEnd）→ 直接续播该集；
 *    - 该集已看完（nearEnd）→ 续到按季/集序号排序的下一集；没有下一集则重播该集。
 *    该集的源/线路按观看记录的 sourceId/playSourceId 精确匹配（与 openPlayback 的
 *    续播时间戳恢复逻辑一致），匹配不到则回退到首个有 url 的线路。
 * 2. 无任何进度记录时取第一季第一集，源取首个有 url 的线路。
 *
 * 说明：按「最近观看」而非「进度最大」选集，避免已追到第 N 集后因早期某一集
 * 断在看了一半（进度最大但未看完）而从老集续播。
 *
 * 返回 null 表示该媒体无可播放的集或线路。
 */
export async function resolveDefaultPlayTarget(
  provider: DatabaseProvider,
  media: Media,
): Promise<DefaultPlayTarget | null> {
  const episodes = await provider.getEpisodesByMediaId(media.id);
  if (!episodes || episodes.length === 0) return null;

  const sorted = [...episodes].sort(
    (a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber,
  );

  let chosen: (typeof sorted)[number] | null = null;
  let preferredSourceId: string | null = null;
  let preferredPlaySourceId: string | null = null;

  try {
    const history = await provider.getAllWatchHistoryByMediaId(media.id);
    const lastByEpisode = new Map<string, WatchHistory>();
    for (const h of history) {
      if (!h.episodeId || h.episodeId === media.id) continue;
      if (h.progress <= 0) continue;
      const prev = lastByEpisode.get(h.episodeId);
      if (!prev || h.updatedAt > prev.updatedAt) lastByEpisode.set(h.episodeId, h);
    }
    const latest = [...lastByEpisode.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    )[0];
    if (latest) {
      const latestEp = sorted.find((e) => e.id === latest.episodeId);
      if (latestEp) {
        const nearEnd = latest.duration > 0 && latest.progress >= latest.duration - 5;
        if (!nearEnd) {
          chosen = latestEp;
        } else {
          const idx = sorted.indexOf(latestEp);
          chosen = sorted[idx + 1] ?? latestEp;
        }
      }
    }
    if (chosen) {
      const prefer = lastByEpisode.get(chosen.id);
      if (prefer) {
        preferredSourceId = prefer.sourceId ?? null;
        preferredPlaySourceId = prefer.playSourceId ?? null;
      }
    }
  } catch {
    // 续播解析失败不影响默认播放首集
  }

  if (!chosen) chosen = sorted[0];

  const chosenSources = await provider.getPlaySourcesByEpisodeId(chosen.id);
  const chosenPick =
    (preferredPlaySourceId && chosenSources.find((s) => s.url && s.id === preferredPlaySourceId)) ||
    (preferredSourceId && chosenSources.find((s) => s.url && s.sourceId === preferredSourceId)) ||
    chosenSources.find((s) => s.url) ||
    chosenSources[0];
  if (chosenPick) {
    return { episodeId: chosen.id, sourceId: chosenPick.sourceId, playSourceId: chosenPick.id };
  }

  for (const ep of sorted) {
    if (ep.id === chosen.id) continue;
    const sources = await provider.getPlaySourcesByEpisodeId(ep.id);
    const src = sources.find((s) => s.url) ?? sources[0];
    if (src) return { episodeId: ep.id, sourceId: src.sourceId, playSourceId: src.id };
  }

  return null;
}
