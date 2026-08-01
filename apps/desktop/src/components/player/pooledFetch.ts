/**
 * 通过 Tauri 常驻连接池命令 `video_fetch` 发起视频资源请求。
 *
 * Rust 侧持有全局 reqwest::Client（连接复用/keep-alive），
 * 与 plugin-http 的 fetch（每次新建客户端）相比，慢源场景下省去每片握手开销。
 */

export interface VideoFetchRawResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: ArrayBuffer;
}

function normalizeBytes(data: unknown): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  if (data instanceof Uint8Array) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  }
  if (Array.isArray(data)) return Uint8Array.from(data).buffer;
  throw new Error('unexpected raw IPC payload: ' + Object.prototype.toString.call(data));
}

function parseRawFrame(buf: ArrayBuffer): VideoFetchRawResult {
  if (buf.byteLength < 6) throw new Error(`frame too small: ${buf.byteLength}`);
  const view = new DataView(buf);
  const status = view.getUint16(0, true);
  const hdrLen = view.getUint32(2, true);
  if (6 + hdrLen > buf.byteLength) throw new Error(`frame header overflow: ${hdrLen}`);
  const hdrJson = new TextDecoder().decode(new Uint8Array(buf, 6, hdrLen));
  const headers = JSON.parse(hdrJson) as Record<string, string>;
  const body = buf.slice(6 + hdrLen);
  return { status, statusText: '', headers, body };
}

/**
 * 调用 Rust 的 `video_fetch` 命令。invoke 不可用（如浏览器开发环境）时抛出，
 * 由调用方决定回退策略。
 */
export async function invokeVideoFetch(
  url: string,
  headers?: Record<string, string>,
  range?: string,
): Promise<VideoFetchRawResult> {
  const { invoke } = await import('@tauri-apps/api/core');
  const raw = await invoke('video_fetch', {
    url,
    headers: headers ?? null,
    range: range ?? null,
  });
  return parseRawFrame(normalizeBytes(raw));
}

function sanitizeFetchHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (lower === 'user-agent' || lower === 'referer') continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 是否运行在 Tauri webview 内（纯浏览器 dev 环境无 __TAURI_INTERNALS__）。 */
export function isTauriRuntime(): boolean {
  try {
    return typeof window !== 'undefined' && typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';
  } catch {
    return false;
  }
}

/** 预热源域名连接：Rust 侧发 Range 小请求建立到该 host 的 keep-alive 连接。 */
export async function invokePrewarm(url: string): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('prewarm', { url });
  } catch {}
}

/**
 * fetch 兼容包装：返回标准 Response，供 setVideoFetchFn 注入
 * （hlsProbe / 时长探测等共享逻辑直接受益于连接复用）。
 *
 * - 纯浏览器 dev 环境：直接走原生 fetch（剔除 UA/Referer 避免 CORS 预检 405）。
 * - Tauri 环境：走 Rust 连接池；失败直接抛错（探测函数自带 catch，
 *   播放路径交 hls.js 重试），不再回退——无 CORS 源的浏览器回退必死。
 */
export async function pooledVideoFetch(
  url: string,
  options?: { headers?: Record<string, string>; method?: string },
): Promise<Response> {
  const method = options?.method || 'GET';
  if (method !== 'GET') {
    return fetch(url, options as RequestInit);
  }
  if (!isTauriRuntime()) {
    return fetch(url, { method, headers: sanitizeFetchHeaders(options?.headers) });
  }
  const range = options?.headers?.Range;
  const res = await invokeVideoFetch(url, options?.headers, range);
  const body = res.body;
  const headers = new Headers();
  for (const [k, v] of Object.entries(res.headers)) {
    headers.set(k, v);
  }
  return new Response(body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}
