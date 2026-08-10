import { getHttpClient } from '../utils/httpClient';
import { normalizer } from '../utils/normalizer';
import type { DatabaseProvider } from '../db/provider';
import type { MediaType } from '../types';

const DOUBAN_SEARCH_URL = 'https://m.douban.com/rexxar/api/v2/search';
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

/** 豆瓣接口按需低频调用，单次会话内最多请求次数，防止触发反爬。 */
const SESSION_REQUEST_LIMIT = 200;
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;

let sessionRequestCount = 0;

export interface DoubanRating {
  value: number;
  count: number;
}

interface DoubanTarget {
  title?: string;
  year?: string | number;
  rating?: { value?: number; count?: number };
}

function doubanTypeFromMediaType(type: MediaType): string {
  switch (type) {
    case 'MOVIE':
      return 'movie';
    case 'ANIME':
      return 'anime';
    case 'TV':
    case 'VARIETY':
    case 'DOCUMENTARY':
    default:
      return 'tv';
  }
}

/** 归一化标题用于匹配：简体化、去空格、去季数后缀（第X季 / season N / S1）、去「剧场版」等后缀。 */
async function normalizeTitleForMatch(title: string): Promise<string> {
  if (!title) return '';
  const simplified = await normalizer.toSimplified(title);
  return simplified
    .toLowerCase()
    .replace(/《|》/g, '')
    .replace(/\s+/g, '')
    .replace(/第[一二三四五六七八九十百千\d]+季$/g, '')
    .replace(/season\s*\d+$/g, '')
    .replace(/s\d+$/g, '')
    .replace(/剧场版$/g, '')
    .replace(/电影版$/g, '')
    .trim();
}

function extractYear(raw: string | number | undefined): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const match = String(raw).match(/(\d{4})/);
  return match ? parseInt(match[1], 10) : null;
}

function isUsableRating(rating?: DoubanRating): boolean {
  return !!rating && typeof rating.value === 'number' && rating.value > 0 && rating.count > 0;
}

/** 从候选列表里挑选与本地影片匹配的一条，返回其豆瓣评分。 */
async function pickBestMatch(
  targets: DoubanTarget[],
  title: string,
  year: number
): Promise<DoubanRating | null> {
  const norm = await normalizeTitleForMatch(title);
  if (!norm) return null;

  const yearNum = year > 0 ? year : null;

  const scored = targets
    .map(target => {
      const targetTitle = target.title || '';
      const targetNorm = targetTitle ? norm : '';
      const targetYear = extractYear(target.year);
      const rating = target.rating as DoubanRating | undefined;

      let titleScore = 0;
      if (targetNorm && targetNorm === norm) {
        titleScore = 100;
      } else if (targetNorm) {
        const longer = targetNorm.length >= norm.length ? targetNorm : norm;
        const shorter = targetNorm.length >= norm.length ? norm : targetNorm;
        if (shorter.length >= 2 && longer.includes(shorter)) {
          titleScore = Math.min(80, 40 + shorter.length * 2);
        }
      }

      if (titleScore === 0) return null;

      let yearScore = 0;
      if (yearNum !== null && targetYear !== null) {
        if (targetYear === yearNum) yearScore = 20;
        else if (Math.abs(targetYear - yearNum) <= 1) yearScore = 8;
        else return null;
      } else if (yearNum === null && targetYear !== null) {
        // 本地未知年份时仍可接受，但降权
        yearScore = 4;
      } else {
        yearScore = 10;
      }

      const count = isUsableRating(rating) ? (rating as DoubanRating).count : 0;
      return { target, score: titleScore + yearScore + Math.min(20, count / 100000), count };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && x.count > 0)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || !isUsableRating(best.target.rating as DoubanRating)) return null;
  return best.target.rating as DoubanRating;
}

/**
 * 豆瓣移动端搜索接口（无需 key）：
 * GET /rexxar/api/v2/search?q=<title>&start=0&count=10&type=<movie|tv|anime>
 * 需携带 Referer + 移动端 UA，返回 subjects.items[].target.rating。
 */
export async function fetchDoubanRating(
  title: string,
  year: number,
  type: MediaType
): Promise<DoubanRating | null> {
  if (sessionRequestCount >= SESSION_REQUEST_LIMIT) return null;
  const client = getHttpClient();
  const headers = {
    Referer: 'https://m.douban.com/',
    'User-Agent': MOBILE_UA,
    Accept: 'application/json, text/plain, */*',
  };

  const types = [doubanTypeFromMediaType(type), null];
  for (const t of types) {
    if (sessionRequestCount >= SESSION_REQUEST_LIMIT) return null;
    sessionRequestCount++;

    const params = new URLSearchParams({ q: title, start: '0', count: '10' });
    if (t) params.set('type', t);
    const url = `${DOUBAN_SEARCH_URL}?${params.toString()}`;

    try {
      const response = await client.get(url, { headers, timeout: 15000, mode: 'cors' });
      const targets: DoubanTarget[] = response.data?.subjects?.items?.map((s: any) => s.target || {}) || [];
      const match = await pickBestMatch(targets, title, year);
      if (match) return match;
    } catch {
      // 单次失败静默，交给调用方决定是否缓存
    }
  }
  return null;
}

/** 判断本地是否已有可用且未过期的豆瓣评分缓存。 */
export function hasFreshDoubanRating(
  media: { rating?: number | null; ratingSource?: string | null; ratingUpdatedAt?: string | null }
): boolean {
  if (!media.rating || media.ratingSource !== 'DOUBAN') return false;
  if (!media.ratingUpdatedAt) return false;
  const ts = new Date(media.ratingUpdatedAt).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < CACHE_TTL_MS;
}

/**
 * 评分服务：按需从豆瓣抓取并写入数据库缓存。
 * 详情页打开时调用 getOrFetchRating，命中缓存直接返回，否则查豆瓣后落库。
 */
export class RatingService {
  constructor(private db: DatabaseProvider) {}

  async getOrFetchRating(mediaId: string, title: string, year: number, type: MediaType): Promise<DoubanRating | null> {
    const media = await this.db.getMediaById(mediaId);
    if (!media) return null;

    if (hasFreshDoubanRating(media)) {
      return { value: media.rating!, count: media.ratingCount || 0 };
    }

    const rating = await fetchDoubanRating(title, year, type);
    if (rating) {
      await this.db.updateMediaRating(mediaId, {
        rating: rating.value,
        ratingCount: rating.count,
        source: 'DOUBAN',
        updatedAt: new Date().toISOString(),
      });
    }
    return rating;
  }
}
