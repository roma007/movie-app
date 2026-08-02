import { File, Directory, Paths } from 'expo-file-system';
import { buildPosterCacheFilename, type BackgroundImageCache } from '@movie-app/core';

const CACHE_DIR_NAME = 'bg-cache';

function cacheDir(): Directory {
  return new Directory(Paths.cache, CACHE_DIR_NAME);
}

/**
 * 移动端分类页背景图缓存实现。
 * 存于缓存目录 bg-cache/，文件名 bg_{mediaId}.{ext}，与视频 id 关联；
 * getLocal 仅命中缓存不触网；download 走网络下载并落盘。
 */
export const mobileBackgroundImageCache: BackgroundImageCache = {
  async getLocal(mediaId: string, posterUrl: string): Promise<string | null> {
    try {
      const dir = cacheDir();
      if (!dir.exists) return null;
      const file = new File(dir, buildPosterCacheFilename(mediaId, posterUrl));
      return file.exists ? file.uri : null;
    } catch (err) {
      console.error('[posterCache] 查询本地背景图失败:', err);
      return null;
    }
  },

  async download(mediaId: string, posterUrl: string): Promise<string | null> {
    try {
      const dir = cacheDir();
      if (!dir.exists) {
        dir.create({ intermediates: true, idempotent: true });
      }
      const file = new File(dir, buildPosterCacheFilename(mediaId, posterUrl));
      await File.downloadFileAsync(posterUrl, file, { idempotent: true });
      return file.uri;
    } catch (err) {
      console.error('[posterCache] 下载背景图失败:', err);
      return null;
    }
  },

  async clearAll(): Promise<void> {
    try {
      const dir = cacheDir();
      if (dir.exists) dir.delete();
    } catch (err) {
      console.error('[posterCache] 清空背景图缓存失败:', err);
    }
  },
};
