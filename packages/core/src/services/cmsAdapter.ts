import { getHttpClient, type HttpClient } from '../utils/httpClient';
import type { CMSMediaItem, CMSListResponse } from '../types';

const MAX_RETRIES = 3;

export class CMSAdapter {
  private readonly baseUrl: string;
  private readonly client: HttpClient;
  private readonly maxRetries: number;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.maxRetries = MAX_RETRIES;
    this.client = getHttpClient();
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
             message.includes('504') ||
             message.includes('429') ||
             message.includes('too many requests');
    }
    return false;
  }

  private async requestWithRetry(url: string, signal?: AbortSignal): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.client.get(url, { signal, timeout: 30000 });
        return response.data;
      } catch (error: any) {
        lastError = error;
        if (!this.isRetryableError(error)) {
          throw error;
        }
        if (attempt < this.maxRetries - 1) {
          const isRateLimit = error?.message?.includes('429') || error?.message?.includes('too many requests');
          const baseDelay = isRateLimit ? 5000 : Math.pow(2, attempt) * 1000;
          const jitter = Math.random() * (isRateLimit ? 2000 : 500);
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