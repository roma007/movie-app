import { invokeVideoFetch, invokePrewarm, isTauriRuntime } from './pooledFetch';

export interface FetchResult {
  ok: boolean;
  status: number;
  statusText: string;
  data: ArrayBuffer;
}

/** 预取并发数 */
const CONCURRENCY = 3;
/** 预取水位（秒）：保持领先播放器约 120 秒的媒体数据 */
const WATERMARK_SECONDS = 120;
/** 缓存字节预算（LRU） */
const BYTE_BUDGET = 256 * 1024 * 1024;
/** 分片缓存 TTL（VOD 分片是静态内容） */
const CACHE_TTL_MS = 60 * 60 * 1000;
/** 预取失败后每个分片最多额外重试次数 */
const MAX_FRAG_RETRIES = 2;
/** 分片重试退避基数（ms）：1000 → 2000 */
const FRAG_RETRY_BASE_MS = 1000;
/** 同一源在窗口内连续失败达到该阈值 → 降级（不再占用预取并发） */
const DEGRADE_THRESHOLD = 3;
/** 连续失败计入降级的时间窗（ms） */
const DEGRADE_WINDOW_MS = 30_000;
/** A/B 调试开关：localStorage 置 '1' 关闭预取（仍走连接池） */
const DISABLE_KEY = 'movie-app-prefetch-disabled';

interface CachedEntry {
  data: ArrayBuffer;
  size: number;
  at: number;
}

interface Segment {
  url: string;
  duration: number;
}

function defaultHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  };
  try {
    const referer = new URL(url).origin;
    if (referer) headers['Referer'] = referer;
  } catch {}
  return headers;
}

function safeResolve(line: string, baseUrl: string): string {
  try {
    return new URL(line, baseUrl).href;
  } catch {
    return line;
  }
}

function parsePlaylist(text: string, baseUrl: string): { hasExtInf: boolean; segments: Segment[]; nextResourceUrl?: string } {
  const lines = text.split('\n');
  const segments: Segment[] = [];
  let hasExtInf = false;
  let pendingDuration = 0;
  for (const raw of lines) {
    const line = raw.trim();
    const inf = line.match(/#EXTINF:([\d.]+)/);
    if (inf) {
      hasExtInf = true;
      pendingDuration = parseFloat(inf[1]);
      continue;
    }
    if (line && !line.startsWith('#')) {
      const segUrl = line.startsWith('http') ? line : safeResolve(line, baseUrl);
      segments.push({ url: segUrl, duration: pendingDuration || 0 });
      pendingDuration = 0;
    }
  }
  return { hasExtInf, segments, nextResourceUrl: segments[0]?.url };
}

class PrefetchManager {
  private cache = new Map<string, CachedEntry>();
  private cacheBytes = 0;
  private inflight = new Map<string, Promise<FetchResult>>();
  private segments: Segment[] = [];
  private manifestUrl = '';
  private frontier = 0;
  private playerIndex = 0;
  private activePrefetch = 0;
  private scheduling = false;
  /** 分片级退避：key → { 已重试次数, 下次可重试时间 } */
  private fragRetries = new Map<string, { retries: number; nextAt: number }>();
  /** 源级健康：host → { 连续失败次数, 最近失败时间 } */
  private sourceHealth = new Map<string, { consecutive: number; lastFailAt: number }>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** 已预热的 host（去重，避免每次清单刷新都重复预热） */
  private prewarmedHosts = new Set<string>();

  private isDisabled(): boolean {
    try {
      return localStorage.getItem(DISABLE_KEY) === '1';
    } catch {
      return false;
    }
  }

  private log(...args: unknown[]): void {
    if (this.isDisabled()) return;
    console.log('[Prefetch]', ...args);
  }

  private cacheKey(url: string, start: number, end: number): string {
    return `${url}#${start}-${end}`;
  }

  private async networkFetch(url: string, headers: Record<string, string>, range?: string): Promise<FetchResult> {
    if (!isTauriRuntime()) {
      const resp = await fetch(url, {
        method: 'GET',
        headers: range ? { Range: range } : undefined,
      });
      const data = await resp.arrayBuffer();
      return { ok: resp.ok, status: resp.status, statusText: resp.statusText, data };
    }
    const res = await invokeVideoFetch(url, headers, range);
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      statusText: res.statusText,
      data: res.body,
    };
  }

  /** 清单请求：始终走连接池拉最新，不走缓存（LIVE 需要刷新） */
  fetchPlaylist(url: string): Promise<FetchResult> {
    return this.networkFetch(url, defaultHeaders(url));
  }

  private store(key: string, data: ArrayBuffer): void {
    const size = data.byteLength;
    this.cache.set(key, { data, size, at: Date.now() });
    this.cacheBytes += size;
    while (this.cacheBytes > BYTE_BUDGET && this.cache.size > 0) {
      let oldestKey: string | null = null;
      let oldestAt = Infinity;
      for (const [k, v] of this.cache) {
        if (v.at < oldestAt) {
          oldestAt = v.at;
          oldestKey = k;
        }
      }
      if (oldestKey === null) break;
      const evicted = this.cache.get(oldestKey)!;
      this.cacheBytes -= evicted.size;
      this.cache.delete(oldestKey);
    }
  }

  /** 去重 + 缓存写入的底层抓取。预取与播放器共用，同一分片不会双拉。 */
  private fetchAndCache(url: string, start: number, end: number): Promise<FetchResult> {
    const key = this.cacheKey(url, start, end);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      cached.at = Date.now();
      this.log('cache-hit', url.slice(0, 80));
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', data: cached.data });
    }
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const range = start || end ? `bytes=${start}-${end ? end - 1 : ''}` : undefined;
    const p = this.networkFetch(url, defaultHeaders(url), range)
      .then((res) => {
        if (res.ok) {
          this.store(key, res.data);
          this.onSuccess(url);
        }
        return res;
      })
      .catch((err) => {
        this.onFailure(key, url);
        throw err;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, p);
    return p;
  }

  private hostOf(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  }

  /** 分片失败：记录分片级退避 + 源级连续失败，并安排退避到期后继续预取。 */
  private onFailure(key: string, url: string): void {
    const now = Date.now();
    const prev = this.fragRetries.get(key);
    const retries = (prev?.retries ?? 0) + 1;
    this.fragRetries.set(key, {
      retries,
      nextAt: now + FRAG_RETRY_BASE_MS * 2 ** (retries - 1),
    });
    if (retries <= MAX_FRAG_RETRIES) {
      this.scheduleRetry(this.fragRetries.get(key)!.nextAt - now);
    }

    const host = this.hostOf(url);
    if (!host) return;
    const sh = this.sourceHealth.get(host);
    const consecutive = sh && now - sh.lastFailAt <= DEGRADE_WINDOW_MS ? sh.consecutive + 1 : 1;
    this.sourceHealth.set(host, { consecutive, lastFailAt: now });
    if (consecutive === DEGRADE_THRESHOLD) {
      this.log(`源降级: ${host} 连续失败 ${consecutive} 次，暂停预取其分片`);
    }
  }

  /** 分片成功：清除该分片退避，并恢复该源健康计数。 */
  private onSuccess(url: string): void {
    const now = Date.now();
    this.fragRetries.delete(this.cacheKey(url, 0, 0));
    const host = this.hostOf(url);
    if (!host) return;
    const sh = this.sourceHealth.get(host);
    if (sh && now - sh.lastFailAt <= DEGRADE_WINDOW_MS) {
      sh.consecutive = 0;
    }
  }

  private isDegraded(url: string): boolean {
    const host = this.hostOf(url);
    if (!host) return false;
    const sh = this.sourceHealth.get(host);
    if (!sh) return false;
    if (Date.now() - sh.lastFailAt > DEGRADE_WINDOW_MS) return false;
    return sh.consecutive >= DEGRADE_THRESHOLD;
  }

  private scheduleRetry(delayMs: number): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.ensurePrefetch();
    }, Math.max(delayMs, 0));
  }

  /** 播放器请求分片（hls.js loader 调用）。命中缓存秒回，未命中走连接池。 */
  fetchSegment(url: string, start: number, end: number): Promise<FetchResult> {
    const res = this.fetchAndCache(url, start, end);
    this.onPlayerSegment(url, start);
    return res;
  }

  private onPlayerSegment(url: string, _start: number): void {
    if (this.isDisabled() || this.segments.length === 0) return;
    const idx = this.segments.findIndex((s) => s.url === url);
    if (idx === -1) return;
    const prev = this.playerIndex;
    this.playerIndex = idx;
    if (idx < prev) {
      this.log(`播放器倒退到 seg[${idx}]（上次 ${prev}），重置前沿`);
      this.frontier = idx;
    } else if (idx > this.frontier) {
      this.log(`播放器跳到前沿之后的 seg[${idx}]（前沿 ${this.frontier}），重置前沿`);
      this.frontier = idx;
    }
    this.ensurePrefetch();
  }

  /** 清单解析后的播种与预取推进。 */
  onManifestLoaded(url: string, text: string): void {
    const parsed = parsePlaylist(text, url);
    this.prewarmNext(url, parsed.nextResourceUrl);
    if (!parsed.hasExtInf) {
      this.log('master playlist，跳过预取播种');
      return;
    }
    if (this.manifestUrl === url && this.segments.length > 0) {
      const known = new Set(this.segments.map((s) => s.url));
      const added = parsed.segments.filter((s) => !known.has(s.url));
      if (added.length > 0) {
        this.log(`清单刷新，追加 ${added.length} 个新分片`);
        this.segments.push(...added);
      }
    } else {
      this.manifestUrl = url;
      this.segments = parsed.segments;
      this.frontier = 0;
      this.playerIndex = 0;
    }
    const totalDuration = this.segments.reduce((acc, s) => acc + s.duration, 0);
    this.log(`已解析 ${this.segments.length} 个分片（约 ${(totalDuration / 60).toFixed(1)} 分钟）`);
    this.ensurePrefetch();
  }

  /** 清单里下一个资源（master→variant / variant→分片）若跨 host，提前预热该源连接。 */
  private prewarmNext(manifestUrl: string, nextResourceUrl?: string): void {
    const nextHost = this.hostOf(nextResourceUrl ?? '');
    if (!nextHost) return;
    const curHost = this.hostOf(manifestUrl);
    if (nextHost === curHost) return;
    if (this.prewarmedHosts.has(nextHost)) return;
    this.prewarmedHosts.add(nextHost);
    this.log(`预热连接: ${nextHost}`);
    void invokePrewarm(nextResourceUrl!);
  }

  private ensurePrefetch(): void {
    if (this.isDisabled() || this.scheduling) return;
    this.scheduling = true;
    try {
      // 水位上限：playerIndex 之后累计约 WATERMARK_SECONDS 的媒体时长
      let target = this.segments.length;
      let dur = 0;
      for (let i = this.playerIndex; i < this.segments.length; i++) {
        dur += this.segments[i].duration;
        if (dur >= WATERMARK_SECONDS) {
          target = i;
          break;
        }
      }
      while (this.activePrefetch < CONCURRENCY && this.frontier < target) {
        const seg = this.segments[this.frontier];
        const key = this.cacheKey(seg.url, 0, 0);
        if (!this.cache.has(key) && !this.inflight.has(key)) {
          const fr = this.fragRetries.get(key);
          if (fr) {
            if (fr.retries > MAX_FRAG_RETRIES) {
              this.frontier++;
              continue;
            }
            if (fr.nextAt > Date.now()) {
              this.scheduleRetry(fr.nextAt - Date.now());
              break;
            }
          }
          if (this.isDegraded(seg.url)) {
            this.frontier++;
            continue;
          }
          this.activePrefetch++;
          this.log(`预取 seg[${this.frontier}]（inflight=${this.activePrefetch}/${CONCURRENCY}）`, seg.url.slice(0, 80));
          this.fetchAndCache(seg.url, 0, 0)
            .catch(() => {})
            .finally(() => {
              this.activePrefetch--;
              this.ensurePrefetch();
            });
        }
        this.frontier++;
      }
    } finally {
      this.scheduling = false;
    }
  }

  /** 切换剧集/线路/退出播放页时清空会话与缓存。 */
  reset(): void {
    this.segments = [];
    this.manifestUrl = '';
    this.frontier = 0;
    this.playerIndex = 0;
    this.activePrefetch = 0;
    this.scheduling = false;
    this.cache.clear();
    this.cacheBytes = 0;
    this.inflight.clear();
    this.fragRetries.clear();
    this.sourceHealth.clear();
    this.prewarmedHosts.clear();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.log('已重置');
  }
}

export const prefetchManager = new PrefetchManager();
