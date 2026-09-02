/**
 * 注入式云 fetch（桌面端初始化注入 Tauri plugin-http，教训 3）。
 * 默认使用全局 fetch（移动端直接可用）。独立文件避免 factory↔provider 循环依赖。
 */
export type CloudFetch = (input: any, init?: any) => Promise<Response>;

let globalCloudFetch: CloudFetch | null = null;

export function setGlobalCloudFetch(fn: CloudFetch): void {
  globalCloudFetch = fn;
}

export function getGlobalCloudFetch(): CloudFetch {
  return globalCloudFetch ?? ((input, init) => globalThis.fetch(input, init));
}