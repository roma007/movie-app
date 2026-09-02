import type { RemoteChange, SyncProviderType } from '../types';
import { getGlobalCloudFetch } from './cloudFetch';
import type { CloudProvider } from './cloudProvider';

/** Graph 文件不存在（404 = 已被其它设备消费，非错误） */
export class NotFoundError extends Error {
  constructor(path: string) {
    super(`云端文件不存在: ${path}`);
    this.name = 'NotFoundError';
  }
}

export interface OneDriveProviderDeps {
  /** Azure client_id（P2 占位常量，配置缺失时设置页提示不可用） */
  clientId: string;
  getTokens(): Promise<import('../types').OAuthTokens | null>;
  refreshTokens(): Promise<import('../types').OAuthTokens | null>;
  clearTokens?(): Promise<void>;
}

const GRAPH = 'https://graph.microsoft.com/v1.0';
/** 单飞刷新互斥（2026-09-02 审视：并发 401 只允许一个发起刷新） */
let refreshPromise: Promise<import('../types').OAuthTokens | null> | null = null;

function encodePathSegments(path: string): string {
  return path.split('/').map((seg) => encodeURIComponent(seg)).join('/');
}

export class OneDriveProvider implements CloudProvider {
  readonly type: SyncProviderType = 'onedrive';

  constructor(private deps: OneDriveProviderDeps) {}

  async ensurePath(path: string): Promise<void> {
    const segments = `${path}`.split('/').filter(Boolean);
    let acc = '';
    for (const seg of segments) {
      acc = acc ? `${acc}/${seg}` : seg;
      await this.createFolder(acc).catch((e) => {
        // 409 = 已存在，幂等忽略；其它错误上抛
        if (!(e instanceof GraphConflictError)) throw e;
      });
    }
  }

  async listFiles(dirPath: string): Promise<string[]> {
    const names: string[] = [];
    let url: string | null = `${GRAPH}/me/drive/special/approot:/${encodePathSegments(dirPath)}:/children`;
    while (url) {
      const res = await this.request('GET', url);
      const body = res as any;
      for (const item of body?.value ?? []) names.push(item.name);
      url = null;
      const link: string | undefined = body?.['@odata.nextLink'];
      if (link) url = link; // 2.9bis-2 分页
    }
    return names;
  }

  async readJson(path: string): Promise<unknown | null> {
    try {
      const text = await this.request('GET', `${GRAPH}/me/drive/special/approot:/${encodePathSegments(path)}:/content`, undefined, true);
      return JSON.parse(text as string);
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  }

  async writeJson(path: string, value: unknown): Promise<void> {
    const body = JSON.stringify(value);
    await this.request(
      'PUT',
      `${GRAPH}/me/drive/special/approot:/${encodePathSegments(path)}:/content`,
      { headers: { 'Content-Type': 'application/json' } },
      false,
      body
    );
  }

  async deleteFile(path: string): Promise<void> {
    try {
      await this.request('DELETE', `${GRAPH}/me/drive/special/approot:/${encodePathSegments(path)}:`);
    } catch (e) {
      if (e instanceof NotFoundError) return; // 已删视为成功
      throw e;
    }
  }

  // —— Graph 细节 ——

  private async createFolder(path: string): Promise<void> {
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const name = path.slice(path.lastIndexOf('/') + 1);
    const url = `${GRAPH}/me/drive/special/approot:/${encodePathSegments(parent)}:/children`;
    await this.request(
      'POST',
      url,
      { headers: { 'Content-Type': 'application/json' } },
      false,
      JSON.stringify({ name, folder: {} })
    );
  }

  private async request(
    method: string,
    url: string,
    init?: { headers?: Record<string, string> },
    rawText = false,
    body?: string
  ): Promise<object | string> {
    const withAuth = async (attempt = 1): Promise<object | string> => {
      const tokens = await this.deps.getTokens();
      if (!tokens?.accessToken) throw new Error('未登录 OneDrive（无访问令牌）');
      const fetchImpl = getGlobalCloudFetch();
      const res = await fetchImpl(url, {
        method,
        headers: { Authorization: `Bearer ${tokens.accessToken}`, ...(init?.headers ?? {}) },
        body: body as any,
      });
      if (res.status === 401 && attempt === 1) {
        // 刷新一次 → 重放（2.9.7）；单飞互斥
        const refreshed = await this.singleFlightRefresh();
        if (refreshed) return withAuth(2);
        throw new Error('OneDrive 令牌刷新失败，请重新登录');
      }
      if (res.status === 404) {
        const path = (url.includes(':/') ? url.slice(url.lastIndexOf(':/') + 2) : url);
        throw new NotFoundError(path);
      }
      if (res.status === 409) throw new GraphConflictError();
      if (res.status === 429) {
        const retryAfter = Number(res.headers?.get?.('retry-after') ?? '5') || 5;
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        return withAuth(attempt);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Graph ${method} ${res.status}: ${text.slice(0, 200)}`);
      }
      if (rawText) return res.text();
      return res.json();
    };
    return withAuth();
  }

  private async singleFlightRefresh() {
    if (!refreshPromise) {
      refreshPromise = this.deps
        .refreshTokens()
        .finally(() => { refreshPromise = null; });
    }
    return refreshPromise;
  }
}

/** Graph 409 冲突（目录/文件已存在，幂等场景忽略） */
export class GraphConflictError extends Error {
  constructor() {
    super('Graph resource conflict (409)');
    this.name = 'GraphConflictError';
  }
}