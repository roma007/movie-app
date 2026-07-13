import { getVideoFetchFn } from '@movie-app/core';

/**
 * 自定义 hls.js Loader，通过 Tauri 的 fetch（@tauri-apps/plugin-http）
 * 在 Rust 后端发起 HTTP 请求，绕过浏览器 CORS 限制。
 *
 * 从 VideoPlayer.tsx 抽取为独立模块，避免每次渲染重新定义类。
 * getVideoFetchFn() 在 doLoad() 内部调用，保证拿到最新注入的 fetch。
 */
export class TauriLoader {
  private context: any;
  private callbacks: any;
  private stats: any;
  private cancelled: boolean;

  constructor() {
    this.cancelled = false;
    this.stats = {
      trequest: 0,
      tfirst: 0,
      tload: 0,
      loaded: 0,
      total: 0,
      retry: 0,
      aborted: false,
      bwEstimate: 0,
      loading: {
        start: 0,
        first: 0,
        end: 0,
      },
      parsing: {
        start: 0,
        end: 0,
      },
      buffering: {
        start: 0,
        end: 0,
      },
    };
  }

  load(context: any, _config: any, callbacks: any): void {
    this.context = context;
    this.callbacks = callbacks;
    this.stats.loading.start = performance.now();
    this.stats.trequest = this.stats.loading.start;
    this.doLoad();
  }

  async doLoad(): Promise<void> {
    const videoFetchFn = getVideoFetchFn();
    if (!videoFetchFn) {
      console.error('[TauriLoader] videoFetchFn 未注入，无法加载');
      if (this.callbacks && this.callbacks.onError) {
        this.callbacks.onError(
          { code: 0, text: 'videoFetchFn 未注入' },
          this.context,
          this.stats,
        );
      }
      return;
    }

    try {
      console.log(`[TauriLoader] 开始加载: ${this.context.url}`);
      console.log(`[TauriLoader] context type: ${this.context.type}, responseType: ${this.context.responseType}`);
      const response = await (videoFetchFn as any)(this.context.url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          Referer: new URL(this.context.url).origin,
        },
      });
      console.log(`[TauriLoader] 请求完成: status=${response.status}, ok=${response.ok}`);
      if (this.cancelled) return;

      const now = performance.now();
      this.stats.loading.first = now;

      const isM3U8 =
        this.context.url.toLowerCase().includes('.m3u8') ||
        (this.context.type && this.context.type.toString().toLowerCase().includes('manifest'));

      let data: string | Uint8Array;
      if (isM3U8) {
        data = await response.text();
        console.log(`[TauriLoader] 文本格式完成: length=${data.length} chars`);
      } else {
        const arrayBuffer = await response.arrayBuffer();
        data = new Uint8Array(arrayBuffer);
        console.log(`[TauriLoader] 二进制格式完成: length=${data.byteLength} bytes`);
      }
      if (this.cancelled) return;

      const endTime = performance.now();
      this.stats.loading.end = endTime;
      this.stats.tfirst = this.stats.loading.first - this.stats.loading.start;
      this.stats.tload = this.stats.loading.end - this.stats.loading.start;
      this.stats.loaded = typeof data === 'string' ? data.length : data.byteLength;
      this.stats.total = this.stats.loaded;

      const responseData = {
        url: response.url || this.context.url,
        data,
        code: response.status,
        headers: response.headers || {},
      };

      if (this.callbacks && this.callbacks.onSuccess) {
        this.callbacks.onSuccess(responseData, this.stats, this.context);
      }
    } catch (err) {
      console.error(
        `[TauriLoader] 加载失败: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
      if (this.cancelled) return;
      if (this.callbacks && this.callbacks.onError) {
        this.callbacks.onError(
          {
            code: 0,
            text: err instanceof Error ? err.message : '加载失败',
          },
          this.context,
          this.stats,
        );
      }
    }
  }

  abort(): void {
    this.cancelled = true;
  }

  destroy(): void {
    this.cancelled = true;
  }
}
