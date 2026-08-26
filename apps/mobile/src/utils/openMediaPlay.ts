import { getProvider } from '../init';
import { resolveDefaultPlayTarget } from '@movie-app/core';
import type { Media } from '@movie-app/core';

/**
 * 点击卡片后直接进播放页：解析默认播放目标（续播/首集 + 首个线路），
 * 解析失败则回退到详情页。
 */
export async function openMediaPlay(navigation: any, media: Media): Promise<void> {
  try {
    const provider = getProvider();
    const target = await resolveDefaultPlayTarget(provider, media);
    if (target) {
      navigation.navigate('Play', {
        episodeId: target.episodeId,
        mediaId: media.id,
        sourceId: target.sourceId,
        title: media.title,
      });
      return;
    }
  } catch {
    // 解析失败回退到详情页
  }
  navigation.navigate('Detail', { id: media.id });
}
