import type { DatabaseProvider } from '../db/provider';
import type { Media } from '../types';

export interface DefaultPlayTarget {
  episodeId: string;
  sourceId: string;
}

/**
 * 解析点击卡片后默认播放的目标（集 + 线路），实现「精准续播」。
 *
 * 优先级：
 * 1. 续播：媒体存在「未看完且进度 > 0」的剧集时，优先跳到进度最大的那一集；
 *    该集的源/线路按观看记录的 sourceId/playSourceId 精确匹配（与 openPlayback 的
 *    续播时间戳恢复逻辑一致），匹配不到则回退到首个有 url 的线路。
 * 2. 否则取第一季第一集（按 seasonNumber、episodeNumber 排序），源取首个有 url 的线路。
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

  let chosen = sorted[0];
  let preferredSourceId: string | null = null;
  let preferredPlaySourceId: string | null = null;

  try {
    const history = await provider.getAllWatchHistoryByMediaId(media.id);
    const bestByEpisode = new Map<string, { progress: number; sourceId: string | null; playSourceId: string | null }>();
    for (const h of history) {
      if (!h.episodeId || h.episodeId === media.id) continue;
      if (h.progress <= 0) continue;
      const nearEnd = h.duration > 0 && h.progress >= h.duration - 5;
      if (nearEnd) continue;
      const prev = bestByEpisode.get(h.episodeId);
      if (!prev || h.progress > prev.progress) {
        bestByEpisode.set(h.episodeId, {
          progress: h.progress,
          sourceId: h.sourceId ?? null,
          playSourceId: h.playSourceId ?? null,
        });
      }
    }
    let bestEpId: string | null = null;
    let bestProgress = 0;
    for (const [epId, info] of bestByEpisode) {
      if (info.progress > bestProgress) {
        bestProgress = info.progress;
        bestEpId = epId;
      }
    }
    if (bestEpId) {
      const cont = sorted.find((e) => e.id === bestEpId);
      if (cont) {
        chosen = cont;
        const info = bestByEpisode.get(bestEpId);
        preferredSourceId = info?.sourceId ?? null;
        preferredPlaySourceId = info?.playSourceId ?? null;
      }
    }
  } catch {
    // 续播解析失败不影响默认播放首集
  }

  const chosenSources = await provider.getPlaySourcesByEpisodeId(chosen.id);
  const chosenPick =
    (preferredSourceId &&
      (chosenSources.find((s) => s.url && s.sourceId === preferredSourceId) ||
        chosenSources.find((s) => s.url && s.id === preferredPlaySourceId))) ||
    chosenSources.find((s) => s.url) ||
    chosenSources[0];
  if (chosenPick) {
    return { episodeId: chosen.id, sourceId: chosenPick.sourceId };
  }

  for (const ep of sorted) {
    if (ep.id === chosen.id) continue;
    const sources = await provider.getPlaySourcesByEpisodeId(ep.id);
    const src = sources.find((s) => s.url) ?? sources[0];
    if (src) return { episodeId: ep.id, sourceId: src.sourceId };
  }

  return null;
}
