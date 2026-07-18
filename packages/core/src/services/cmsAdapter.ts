import { getHttpClient, type HttpClient } from '../utils/httpClient';
import { TokenBucket } from '../utils/tokenBucket';
import type { CMSMediaItem, CMSListResponse } from '../types';

const MAX_RETRIES = 3;

export class CMSAdapter {
  private readonly baseUrl: string;
  private readonly client: HttpClient;
  private readonly bucket: TokenBucket;
  private readonly maxRetries: number;

  constructor(baseUrl: string, rateLimitLevel: number = 2) {
    this.baseUrl = baseUrl;
    this.maxRetries = MAX_RETRIES;
    this.client = getHttpClient();
    const delayMs = this.levelToDelay(rateLimitLevel);
    this.bucket = new TokenBucket(1000 / delayMs);
  }

  private levelToDelay(level: number): number {
    const delays: Record<number, number> = {
      1: 2000,
      2: 1000,
      3: 700,
      4: 500,
      5: 400,
      6: 300,
      7: 250,
      8: 200,
      9: 150,
      10: 100,
    };
    return delays[level] || 1000;
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return message.includes('timeout') || 
             message.includes('network') || 
             message.includes('econnaborted') || 
             message.includes('etimedout') ||
             message.includes('500') ||
             message.includes('502') ||
             message.includes('503') ||
             message.includes('504');
    }
    return false;
  }

  private async requestWithRetry(url: string, signal?: AbortSignal): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        await this.bucket.acquire();
        const response = await this.client.get(url, { signal, timeout: 30000 });
        return response.data;
      } catch (error: any) {
        lastError = error;
        if (!this.isRetryableError(error)) {
          throw error;
        }
        if (attempt < this.maxRetries - 1) {
          const baseDelay = Math.pow(2, attempt) * 1000;
          const jitter = Math.random() * 500;
          const delay = baseDelay + jitter;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  async getList(page: number = 1, size: number = 20, hours?: number, signal?: AbortSignal): Promise<CMSListResponse> {
    let url = `${this.baseUrl}?ac=list&pg=${page}&limit=${size}`;
    if (hours !== undefined && hours > 0) {
      url += `&h=${hours}`;
    }
    return this.requestWithRetry(url, signal);
  }

  async search(keyword: string, page: number = 1, signal?: AbortSignal): Promise<CMSListResponse> {
    const encodedKeyword = encodeURIComponent(keyword);
    const url = `${this.baseUrl}?ac=videolist&wd=${encodedKeyword}&pg=${page}`;
    return this.requestWithRetry(url, signal);
  }

  async getDetail(ids: string, signal?: AbortSignal): Promise<CMSListResponse> {
    const url = `${this.baseUrl}?ac=detail&ids=${ids}`;
    return this.requestWithRetry(url, signal);
  }

  async getTypes(signal?: AbortSignal): Promise<any> {
    const url = `${this.baseUrl}?ac=types`;
    return this.requestWithRetry(url, signal);
  }
}