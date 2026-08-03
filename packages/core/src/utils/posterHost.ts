/**
 * 海报图床健康判定工具。
 * 采集到的封面 URL 来自各视频源的 vod_pic 字段，图片 CDN 可能随时失效
 * （如 vod.dyttimage.com 已整站连接被重置）。这里维护一个已知失效图床清单，
 * 用于采集择优 / 存量修复，避免展示破图。
 */

/** 已知失效的图片 CDN 域名（全库大量封面来自这些域名且当前已无法访问） */
export const DEAD_IMAGE_HOSTS: string[] = ['vod.dyttimage.com'];

/** 提取 URL 的 hostname；非法/空返回 null */
export function extractImageHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    return host || null;
  } catch {
    return null;
  }
}

/** 封面 URL 是否属于已知失效图床 */
export function isKnownDeadPosterUrl(url: string | null | undefined): boolean {
  const host = extractImageHost(url);
  if (!host) return false;
  return DEAD_IMAGE_HOSTS.includes(host.toLowerCase());
}

/** 封面 URL 是否可视为有效：http(s)、非空、且不在失效图床清单 */
export function isUsablePosterUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const host = extractImageHost(url);
  if (!host) return false;
  return /^https?:$/i.test(new URL(url).protocol) && !DEAD_IMAGE_HOSTS.includes(host.toLowerCase());
}
