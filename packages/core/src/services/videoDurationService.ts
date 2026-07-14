/**
 * 可注入的 fetch 函数类型（与原生 fetch 签名兼容）。
 * 桌面端 Tauri 通过 @tauri-apps/plugin-http 的 fetch 绕过 CORS，
 * 移动端 Expo 直接使用原生 fetch（无 CORS 限制）。
 */
type FetchFn = (url: string, options?: any) => Promise<Response>;

let videoFetchFn: FetchFn | null = null;

/**
 * 设置视频资源 fetch 函数（桌面端 init 时注入 Tauri fetch）。
 */
export function setVideoFetchFn(fn: FetchFn): void {
  videoFetchFn = fn;
}

/**
 * 获取视频资源 fetch 函数。
 */
export function getVideoFetchFn(): FetchFn | null {
  return videoFetchFn;
}

export class VideoDurationService {
  /**
   * 从 m3u8 播放列表中解析总时长（秒）。
   * 支持 master playlist 和 media playlist：
   * - media playlist：累加所有 #EXTINF 行的时长
   * - master playlist：取第一个 variant playlist 的 URL 递归请求
   */
  async getDurationFromM3U8(url: string, logger?: (msg: string) => void): Promise<number | null> {
    const start = Date.now();
    const log = (msg: string) => {
      console.log(msg);
      logger?.(msg);
    };
    try {
      const fetchFn = videoFetchFn || fetch.bind(globalThis);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      log(`[M3U8探测] 开始请求 ${url.slice(0, 100)}`);

      const response = await fetchFn(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          Referer: new URL(url).origin,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        log(`[M3U8探测] HTTP ${response.status} (${Date.now() - start}ms) ${url.slice(0, 100)}`);
        return null;
      }

      const buffer = await response.text();
      if (!buffer) {
        log(`[M3U8探测] 空内容 (${Date.now() - start}ms) ${url.slice(0, 100)}`);
        return null;
      }

      log(`[M3U8探测] 收到 ${buffer.length} 字节 (${Date.now() - start}ms) ${url.slice(0, 100)}`);

      // 先尝试直接解析 #EXTINF（media playlist）
      let totalDuration = 0;
      let hasExtInf = false;
      const lines = buffer.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        const durationMatch = trimmed.match(/#EXTINF:([\d\.]+)/);
        if (durationMatch) {
          hasExtInf = true;
          totalDuration += parseFloat(durationMatch[1]);
        }
      }

      if (hasExtInf && totalDuration > 0) {
        log(`[M3U8探测] 成功 ${(totalDuration / 60).toFixed(1)}分钟 (${Date.now() - start}ms) ${url.slice(0, 100)}`);
        return Math.round(totalDuration);
      }

      // 如果是 master playlist，找第一个 variant playlist URL 递归请求
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const variantUrl = trimmed.startsWith('http')
            ? trimmed
            : new URL(trimmed, url).href;
          log(`[M3U8探测] master playlist → 变体 ${variantUrl.slice(0, 100)}`);
          return this.getDurationFromM3U8(variantUrl, logger);
        }
      }

      log(`[M3U8探测] 无EXTINF也无变体 (${Date.now() - start}ms) ${url.slice(0, 100)}`);
      return null;
    } catch (err: any) {
      const elapsed = Date.now() - start;
      const reason = err?.name === 'AbortError' ? 'timeout(30s)' : err?.message || 'unknown';
      log(`[M3U8探测] 失败 ${reason} (${elapsed}ms) ${url.slice(0, 100)}`);
      return null;
    }
  }

  async getDurationsFromUrls(urls: string[]): Promise<(number | null)[]> {
    const start = Date.now();
    const promises = urls.map(url => this.getDurationFromM3U8(url));
    const results = await Promise.all(promises);
    const success = results.filter(r => r !== null).length;
    console.log(`[M3U8探测] 批量完成 ${success}/${urls.length}集成功 (${Date.now() - start}ms)`);
    return results;
  }
}
