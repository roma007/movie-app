import { getHttpClient } from '../utils/httpClient';
import { normalizer } from '../utils/normalizer';
import { SystemConfigService } from './systemConfigService';
import type { DatabaseProvider } from '../db/provider';
import type { MediaType } from '../types';

const DOUBAN_SEARCH_URL = 'https://m.douban.com/rexxar/api/v2/search';
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

/** 豆瓣接口按需低频调用，单次会话内最多请求次数，防止触发反爬。 */
const SESSION_REQUEST_LIMIT = 200;
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
/** TMDB 免费层限速：每 10 秒最多 40 次请求。 */
const TMDB_RATE_LIMIT_PER_10S = 40;
const TMDB_TIMEOUT_MS = 8000;

/** 豆瓣会话累计请求计数（会话语义，重启归零）。 */
let sessionRequestCount = 0;
/** TMDB 滑动窗口请求时间戳列表，用于 10 秒限速判定。 */
let tmdbRequestTimes: number[] = [];

export interface DoubanRating {
  value: number;
  count: number;
}

/** 从数据库读取 TMDB API Key（未配置返回空串）。 */
async function readTmdbApiKey(db: DatabaseProvider): Promise<string> {
  try {
    const configService = new SystemConfigService(db);
    return (await configService.getString('rating.tmdbApiKey', '')).trim();
  } catch {
    return '';
  }
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

/** TMDB 搜索结果条目结构（movie/tv 字段命名不同）。 */
interface TmdbItem {
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  vote_count?: number;
}

/** 按本地媒体类型返回 TMDB 搜索路径后缀（movie / tv），并返回该条目应读取的标题/原始标题/日期字段名。 */
function tmdbSearchPath(type: MediaType): { path: 'movie' | 'tv'; titleKey: 'title' | 'name'; origKey: 'original_title' | 'original_name'; dateKey: 'release_date' | 'first_air_date' } {
  if (type === 'MOVIE') {
    return { path: 'movie', titleKey: 'title', origKey: 'original_title', dateKey: 'release_date' };
  }
  // TV / ANIME / VARIETY / DOCUMENTARY 均按 TV 处理（TMDB 无独立 anime 端点）
  return { path: 'tv', titleKey: 'name', origKey: 'original_name', dateKey: 'first_air_date' };
}

/** TMDB 滑动窗口限速判定：10 秒内请求数是否已达上限。 */
function tmdbRateLimited(): boolean {
  const now = Date.now();
  tmdbRequestTimes = tmdbRequestTimes.filter(t => now - t < 10000);
  return tmdbRequestTimes.length >= TMDB_RATE_LIMIT_PER_10S;
}

/** 从 TMDB 候选列表挑选与本地影片匹配的一项，返回 { value, count }。独立实现，不触碰豆瓣 pickBestMatch。 */
async function pickBestTmdbMatch(items: TmdbItem[], type: MediaType, title: string, year: number): Promise<DoubanRating | null> {
  const norm = await normalizeTitleForMatch(title);
  if (!norm) return null;
  const { titleKey, origKey, dateKey } = tmdbSearchPath(type);
  const yearNum = year > 0 ? year : null;

  const scored: { item: TmdbItem; score: number; count: number }[] = [];
  for (const item of items) {
    const value = typeof item.vote_average === 'number' ? item.vote_average : 0;
    const count = typeof item.vote_count === 'number' ? item.vote_count : 0;
    if (!(value > 0) || !(count > 0)) continue;

    const candidateTitles = [
      item[titleKey],
      item[origKey],
      item.original_title,
      item.original_name,
    ].filter((t): t is string => !!t);

    // 先归一化主标题，其次原始标题；取能匹配上且得分最高的标题口径
    let titleMatched = false;
    let titleScore = 0;
    for (const rawTitle of candidateTitles) {
      const targetNorm = await normalizeTitleForMatch(rawTitle);
      if (!targetNorm) continue;
      if (targetNorm === norm) {
        titleScore = 100;
        titleMatched = true;
        break;
      }
      const longer = targetNorm.length >= norm.length ? targetNorm : norm;
      const shorter = targetNorm.length >= norm.length ? norm : targetNorm;
      if (shorter.length >= 2 && longer.includes(shorter)) {
        const s = Math.min(80, 40 + shorter.length * 2);
        if (s > titleScore) {
          titleScore = s;
          titleMatched = true;
        }
      }
    }
    if (!titleMatched) continue;

    const targetYear = extractYear(item[dateKey]);
    let yearScore = 0;
    if (yearNum !== null && targetYear !== null) {
      if (targetYear === yearNum) yearScore = 20;
      else if (Math.abs(targetYear - yearNum) <= 1) yearScore = 8;
      else continue;
    } else if (yearNum === null && targetYear !== null) {
      yearScore = 4;
    } else {
      yearScore = 10;
    }

    scored.push({ item, score: titleScore + yearScore + Math.min(20, count / 100000), count });
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) return null;
  return { value: (best.item.vote_average as number), count: best.count };
}

/**
 * 从 TMDB 搜索获取评分（需 API Key）。
 * GET /3/search/{movie|tv}?query=&year=&api_key=  →  results[].vote_average / vote_count
 * 用 api_key query 参数认证，规避 Authorization 头在浏览器环境触发 preflight（TMDB 官方 API CORS 不完全支持）。
 */
export async function fetchTmdbRating(apiKey: string, title: string, year: number, type: MediaType): Promise<DoubanRating | null> {
  if (!apiKey || tmdbRateLimited()) return null;
  const { path } = tmdbSearchPath(type);
  const client = getHttpClient();

  const params = new URLSearchParams({ query: title, api_key: apiKey, language: 'zh-CN' });
  if (year > 0) params.set('year', String(year));
  const url = `${TMDB_BASE_URL}/search/${path}?${params.toString()}`;

  tmdbRequestTimes.push(Date.now());
  try {
    const response = await client.get(url, { timeout: TMDB_TIMEOUT_MS });
    const items: TmdbItem[] = Array.isArray(response.data?.results) ? response.data.results : [];
    return await pickBestTmdbMatch(items, type, title, year);
  } catch {
    return null;
  }
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

/** 判断本地是否已有可用且未过期的评分缓存（支持 DOUBAN / TMDB，TTL 同为 7 天）。 */
export function hasFreshDoubanRating(
  media: { rating?: number | null; ratingSource?: string | null; ratingUpdatedAt?: string | null }
): boolean {
  if (!media.rating) return false;
  if (media.ratingSource !== 'DOUBAN' && media.ratingSource !== 'TMDB') return false;
  if (!media.ratingUpdatedAt) return false;
  const ts = new Date(media.ratingUpdatedAt).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < CACHE_TTL_MS;
}

/**
 * 评分服务：按需从豆瓣抓取并写入数据库缓存；豆瓣失败时回退 TMDB。
 * 详情页打开时调用 getOrFetchRating，命中缓存直接返回，否则查豆瓣（→TMDB）后落库。
 */
export class RatingService {
  constructor(private db: DatabaseProvider) {}

  async getOrFetchRating(mediaId: string, title: string, year: number, type: MediaType): Promise<DoubanRating | null> {
    const media = await this.db.getMediaById(mediaId);
    if (!media) return null;

    // 多源缓存命中直接返回（DOUBAN / TMDB 皆 7 天）
    if (hasFreshDoubanRating(media)) {
      return { value: media.rating!, count: media.ratingCount || 0 };
    }

    const now = new Date().toISOString();

    // 豆瓣优先
    const douban = await fetchDoubanRating(title, year, type);
    if (douban) {
      // 豆瓣成功覆盖既有占用（含 TMDB 占位），符合「豆瓣优先」
      await this.db.updateMediaRating(mediaId, {
        rating: douban.value,
        ratingCount: douban.count,
        source: 'DOUBAN',
        updatedAt: now,
      });
      return douban;
    }

    // 短剧豁免 TMDB 回退（竖屏短剧豆瓣/TMDB 均无评分，纯浪费配额）
    if (media.isShortDrama) return null;

    // 未配置 Key 或达限时静默跳过
    const apiKey = await readTmdbApiKey(this.db);
    if (!apiKey) return null;

    const tmdb = await fetchTmdbRating(apiKey, title, year, type);
    if (tmdb) {
      await this.db.updateMediaRating(mediaId, {
        rating: tmdb.value,
        ratingCount: tmdb.count,
        source: 'TMDB',
        updatedAt: now,
      });
      return tmdb;
    }

    return null;
  }
}
