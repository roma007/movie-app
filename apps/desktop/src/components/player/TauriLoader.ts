import { prefetchManager } from './PrefetchManager';

/**
 * 自定义 hls.js Loader：通过 PrefetchManager 走 Rust 常驻连接池（连接复用），
 * 并对 HLS 分片做多路并发预取（命中缓存秒回）。
 *
 * 与旧实现（plugin-http fetch，每次新建客户端、无复用）相比，慢源场景下
 * 省去每片握手开销，并让预取水位持续领先播放器。
 */

function isPlaylist(context: any): boolean {
  if (context.type) return true;
  return /\.m3u8/i.test(context.url || '');
}

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
    this.cancelled = false;
    this.stats.loading.start = performance.now();
    this.stats.trequest = this.stats.loading.start;
    void this.doLoad();
  }

  private fail(text: string, code = 0): void {
    if (this.cancelled) return;
    if (this.callbacks && this.callbacks.onError) {
      this.callbacks.onError({ code, text }, this.context, this.stats);
    }
  }

  private success(url: string, data: string | ArrayBuffer, code: number): void {
    if (this.cancelled) return;
    const now = performance.now();
    this.stats.loading.first = now;
    this.stats.loading.end = now;
    this.stats.tfirst = now - this.stats.loading.start;
    this.stats.tload = now - this.stats.loading.start;
    this.stats.loaded = typeof data === 'string' ? data.length : data.byteLength;
    this.stats.total = this.stats.loaded;
    if (this.callbacks && this.callbacks.onSuccess) {
      this.callbacks.onSuccess({ url, data, code }, this.stats, this.context);
    }
  }

  async doLoad(): Promise<void> {
    const url = this.context.url;
    if (!url) {
      this.fail('empty url');
      return;
    }
    if (isPlaylist(this.context)) {
      await this.loadPlaylist(url);
    } else {
      await this.loadFragment(url);
    }
  }

  private async loadPlaylist(url: string): Promise<void> {
    try {
      const res = await prefetchManager.fetchPlaylist(url);
      if (this.cancelled) return;
      if (!res.ok) {
        this.fail(`HTTP ${res.status} ${res.statusText}`, res.status);
        return;
      }
      const text = new TextDecoder().decode(res.data);
      prefetchManager.onManifestLoaded(url, text);
      this.success(url, text, res.status);
    } catch (err) {
      console.error('[TauriLoader] 清单加载失败', err);
      this.fail(err instanceof Error ? err.message : String(err));
    }
  }

  private async loadFragment(url: string): Promise<void> {
    const start = this.context.rangeStart || 0;
    const end = this.context.rangeEnd || 0;
    try {
      const res = await prefetchManager.fetchSegment(url, start, end);
      if (this.cancelled) return;
      if (!res.ok) {
        this.fail(`HTTP ${res.status} ${res.statusText}`, res.status);
        return;
      }
      this.success(url, res.data, res.status);
    } catch (err) {
      console.error('[TauriLoader] 分片加载失败', url, err);
      this.fail(err instanceof Error ? err.message : String(err));
    }
  }

  abort(): void {
    this.cancelled = true;
  }

  destroy(): void {
    this.cancelled = true;
  }
}
