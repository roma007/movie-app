import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { buildPosterCacheFilename, type BackgroundImageCache } from '@movie-app/core';

/**
 * 桌面端分类页背景图缓存实现。
 * 本地文件存于 app_data_dir()/bg-cache/，经 convertFileSrc 转为 asset:// URL 供 CSS background 加载。
 * getLocal 仅命中缓存不触网；download 走 Rust 命令下载并落盘。
 */
export const desktopBackgroundImageCache: BackgroundImageCache = {
  async getLocal(mediaId: string, posterUrl: string): Promise<string | null> {
    try {
      const filename = buildPosterCacheFilename(mediaId, posterUrl);
      const localPath = await invoke<string | null>('poster_cache_path', { filename });
      if (!localPath) return null;
      return convertFileSrc(localPath);
    } catch (err) {
      console.error('[posterCache] 查询本地背景图失败:', err);
      return null;
    }
  },

  async download(mediaId: string, posterUrl: string): Promise<string | null> {
    try {
      const filename = buildPosterCacheFilename(mediaId, posterUrl);
      const localPath = await invoke<string>('download_poster', { url: posterUrl, filename });
      if (!localPath) return null;
      return convertFileSrc(localPath);
    } catch (err) {
      console.error('[posterCache] 下载背景图失败:', err);
      return null;
    }
  },

  async clearAll(): Promise<void> {
    try {
      await invoke('clear_poster_cache');
    } catch (err) {
      console.error('[posterCache] 清空背景图缓存失败:', err);
    }
  },
};
