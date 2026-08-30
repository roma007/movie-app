import { getProvider } from '../init';
import { resolveDefaultPlayTarget } from '@movie-app/core';
import type { Media, MediaNavState } from '@movie-app/core';

/**
 * 点击卡片后直接进入播放页：解析默认播放目标（续播/首集 + 首个线路）。
 * 详情页已移除，解析失败不再回退详情页。
 */
export async function openMediaPlay(
  navigate: (to: string, opts?: { state?: unknown; replace?: boolean }) => void,
  media: Media,
  navigateState?: MediaNavState,
  opts?: { replace?: boolean },
): Promise<void> {
  try {
    const provider = getProvider();
    const target = await resolveDefaultPlayTarget(provider, media);
    if (target) {
      const lineQuery = target.playSourceId ? `&line=${encodeURIComponent(target.playSourceId)}` : '';
      navigate(`/play/${target.episodeId}?sourceId=${encodeURIComponent(target.sourceId)}${lineQuery}`, {
        state: navigateState,
        replace: opts?.replace,
      });
    }
  } catch {
    // 解析失败无动作
  }
}
