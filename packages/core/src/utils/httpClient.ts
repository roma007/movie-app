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
  console.log('=== 使用原生 fetch ===');
  
  return {
    async get(url: string, options?: HttpOptions): Promise<HttpResponse> {
      console.log(`HTTP GET: ${url}`);
      
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
        
        if (response.type === 'opaque') {
          console.warn('HTTP RESPONSE: opaque (CORS blocked)');
          throw new Error('CORS blocked - opaque response');
        }
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log(`HTTP RESPONSE: ${response.status}, data length: ${JSON.stringify(data).length}`);
        
        return {
          data,
          status: response.status,
        };
      } catch (error) {
        clearTimeout(timeoutId);
        console.error(`HTTP ERROR (native fetch): ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    },
  };
}