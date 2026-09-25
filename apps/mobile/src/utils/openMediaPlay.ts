import { getProvider } from '../init';
import { resolveDefaultPlayTarget } from '@movie-app/core';
import type { Media } from '@movie-app/core';

/**
 * 播放来源上下文：决定播放页上下滑切换的行为。
 * - list/search/recommend：按 mediaIds 有序列表顺序切换，边界处随机（当前类型）。
 * - random：每次随机（当前类型）；无 mediaIds。
 */
export interface PlayContext {
  type: 'list' | 'search' | 'recommend' | 'random';
  mediaIds?: number[];
  currentIndex?: number;
}

/**
 * 点击卡片后直接进播放页：解析默认播放目标（续播/首集 + 首个线路），
 * 解析失败则回退到详情页。
 * ctx：来源列表上下文（分类/搜索/推荐按序切换；首页等不传则随机）。
 */
export async function openMediaPlay(
  navigation: any,
  media: Media,
  ctx?: PlayContext,
): Promise<void> {
  try {
    const provider = getProvider();
    const target = await resolveDefaultPlayTarget(provider, media);
    if (target) {
      navigation.navigate('Play', {
        episodeId: target.episodeId,
        mediaId: media.id,
        sourceId: target.sourceId,
        playSourceId: target.playSourceId ?? null,
        title: media.title,
        playContext: ctx ?? null,
      });
    }
  } catch {
    // 解析失败无动作（详情页已移除）
  }
}