export interface HttpClient {
  get(url: string, options?: HttpOptions): Promise<HttpResponse>;
}

export interface HttpOptions {
  headers?: Record<string, string>;
  timeout?: number;
  signal?: AbortSignal;
}

export interface HttpResponse {
  data: any;
  status: number;
}

let httpClient: HttpClient | null = null;

export function getHttpClient(): HttpClient {
  if (httpClient) return httpClient;
  
  httpClient = createDefaultHttpClient();
  return httpClient;
}

export function setHttpClient(client: HttpClient): void {
  httpClient = client;
}

function createDefaultHttpClient(): HttpClient {
  console.log('[HTTP Client] 使用原生 fetch (可能有CORS限制)');
  
  return {
    async get(url: string, options?: HttpOptions): Promise<HttpResponse> {
      console.log(`[HTTP Client] GET: ${url}`);
      
      const controller = new AbortController();
      const timeout = options?.timeout || 15000;
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // 合并外部 signal（如取消请求）和内部超时 signal
      if (options?.signal) {
        if (options.signal.aborted) {
          clearTimeout(timeoutId);
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
        options.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
      
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            ...options?.headers,
          },
          signal: controller.signal,
          mode: 'no-cors',
        });
        
        clearTimeout(timeoutId);
        
        console.log(`[HTTP Client] Response: status=${response.status}, type=${response.type}, ok=${response.ok}`);
        
        if (response.type === 'opaque') {
          console.error('[HTTP Client] CORS错误: 收到不透明响应，无法读取数据');
          throw new Error('CORS blocked - 无法访问外部API。请检查网络连接或防火墙设置。');
        }
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log(`[HTTP Client] 成功: ${response.status}, 数据长度: ${JSON.stringify(data).length}`);
        
        return {
          data,
          status: response.status,
        };
      } catch (error) {
        clearTimeout(timeoutId);
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[HTTP Client] 错误: ${errorMsg}`);
        
        // 提供更友好的错误信息
        if (errorMsg.includes('CORS') || errorMsg.includes('opaque')) {
          throw new Error('CORS错误 - 无法访问外部API。Tauri HTTP插件可能未正确加载。');
        }
        if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
          throw new Error('网络错误 - 无法连接到服务器。请检查网络连接。');
        }
        if (errorMsg.includes('abort') || errorMsg.includes('timeout')) {
          throw new Error('请求超时 - 服务器响应时间过长。');
        }
        throw error;
      }
    },
  };
}