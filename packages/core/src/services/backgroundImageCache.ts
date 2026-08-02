/**
 * 大分类页背景图片本地缓存（平台注入模式，仿 httpClient.ts）。
 *
 * 分类页取首个视频海报作为背景时，先经本缓存命中本地文件，避免每次重复下载；
 * 采集任务启动时由 CollectorService 统一调用 clearAll() 清空，保证新数据下不展示旧图。
 *
 * 文件名规则：bg_{mediaId}.{ext}，ext 由海报 URL 路径推导，与视频 id 强关联，查找确定。
 */

export interface BackgroundImageCache {
  /**
   * 仅命中本地缓存时返回本地可展示 URL（桌面 asset://，移动 file://），无缓存返回 null。
   * 用于「本地视频图」判定：不触发任何网络请求。
   */
  getLocal(mediaId: string, posterUrl: string): Promise<string | null>;
  /**
   * 从网络下载背景图并落盘，返回本地可展示 URL；下载失败返回 null。
   * 用于「网络视频图」判定。
   */
  download(mediaId: string, posterUrl: string): Promise<string | null>;
  /** 清空全部缓存的背景图（采集开始时调用） */
  clearAll(): Promise<void>;
}

let backgroundImageCache: BackgroundImageCache | null = null;

export function setBackgroundImageCache(impl: BackgroundImageCache | null): void {
  backgroundImageCache = impl;
}

export function getBackgroundImageCache(): BackgroundImageCache | null {
  return backgroundImageCache;
}

/**
 * 从海报 URL 推导文件扩展名。
 * @returns 小写扩展名（含点），无扩展名时返回 .jpg
 */
export function extractImageExt(posterUrl: string): string {
  try {
    const pathname = new URL(posterUrl).pathname;
    const match = pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
    if (match) {
      const ext = match[1].toLowerCase();
      if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(ext)) {
        return `.${ext}`;
      }
    }
  } catch {}
  return '.jpg';
}

/**
 * 由媒体 id 与海报地址构造缓存文件名（两端共用，保证命名一致）。
 */
export function buildPosterCacheFilename(mediaId: string, posterUrl: string): string {
  return `bg_${mediaId}${extractImageExt(posterUrl)}`;
}

/**
 * 应用缓存背景图（语义与大分类页一致）：
 * - 未注入缓存实现：直接回调原海报 URL；
 * - 命中本地缓存：立即回调本地 URL（不触网）；
 * - 无本地缓存：下载落盘后回调本地 URL，失败回退原海报 URL。
 * 调用方负责竞态防护（effect 清理时将回调中使用的 cancelled 置 true）。
 */
export function resolveCachedBackgroundUrl(
  mediaId: string,
  posterUrl: string,
  onUrl: (url: string) => void
): void {
  const cache = getBackgroundImageCache();
  if (!cache) {
    onUrl(posterUrl);
    return;
  }
  void (async () => {
    const local = await cache.getLocal(mediaId, posterUrl);
    if (local) {
      onUrl(local);
      return;
    }
    const downloaded = await cache.download(mediaId, posterUrl);
    onUrl(downloaded ?? posterUrl);
  })();
}
