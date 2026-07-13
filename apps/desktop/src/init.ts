import { TauriSqlProvider } from './db/tauriSqlProvider';
import { createAppStore, setHttpClient, setVideoFetchFn, type AppStore, type AppState, type HttpClient } from '@movie-app/core';

let _provider: TauriSqlProvider | null = null;
let _store: AppStore | null = null;
let _initPromise: Promise<void> | null = null;
let _hasColdStarted = false;

async function logToDb(message: string, level: 'info' | 'error' = 'info'): Promise<void> {
  if (!_provider) return;
  try {
    const now = new Date().toISOString();
    await _provider.execute(
      'INSERT INTO system_config (key, value, value_type, remark, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [`log_${Date.now()}`, message, 'string', level, now, now]
    );
  } catch {
    // 忽略日志写入失败
  }
}

function logToConsole(message: string): void {
  console.log(`[MOVIE-APP] ${message}`);
}

async function createTauriHttpClient(): Promise<HttpClient> {
  logToConsole('>>> createTauriHttpClient started');
  
  try {
    logToConsole('>>> Trying to import @tauri-apps/plugin-http');
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    logToConsole('>>> Successfully imported @tauri-apps/plugin-http');
    
    return {
      async get(url: string, options?: { headers?: Record<string, string>; timeout?: number }) {
        logToConsole(`HTTP GET: ${url}`);
        
        const response = await tauriFetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            ...options?.headers,
          },
          connectTimeout: options?.timeout || 15000,
        });
        
        const data = await response.json();
        logToConsole(`HTTP RESPONSE: ${response.status}, list length: ${data.list?.length || 0}`);
        
        return {
          data,
          status: response.status,
        };
      },
    };
  } catch (error) {
    logToConsole(`>>> Tauri HTTP 插件加载失败: ${error instanceof Error ? error.message : String(error)}`);
    logToConsole('>>> Falling back to native fetch');
    
    return {
      async get(url: string, options?: { headers?: Record<string, string>; timeout?: number }) {
        logToConsole(`HTTP GET (native): ${url}`);
        
        const controller = new AbortController();
        const timeout = options?.timeout || 15000;
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        try {
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              ...options?.headers,
            },
            signal: controller.signal,
          });
          
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          
          const data = await response.json();
          logToConsole(`HTTP RESPONSE (native): ${response.status}`);
          
          return {
            data,
            status: response.status,
          };
        } catch (error) {
          clearTimeout(timeoutId);
          logToConsole(`HTTP ERROR (native): ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        }
      },
    };
  }
}

export async function initApp(onProgress?: (step: string) => void): Promise<void> {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const startTime = Date.now();
    console.log('=== initApp started ===');
    
    const report = (step: string) => {
      console.log(`[INIT] ${step}`);
      onProgress?.(step);
    };
    
    try {
      report('Step 1: 创建 HTTP Client...');
      const httpClient = await createTauriHttpClient();
      setHttpClient(httpClient);
      report('Step 1: HTTP Client 配置完成');

      try {
        const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
        setVideoFetchFn(tauriFetch as typeof fetch);
        report('Step 1b: Video fetch (Tauri) 配置完成');
      } catch {
        report('Step 1b: Tauri fetch 不可用，使用 native fetch');
      }
      
      report('Step 2: 创建 TauriSqlProvider...');
      _provider = new TauriSqlProvider();
      report('Step 2: TauriSqlProvider 创建完成');
      
      report('Step 3: 初始化数据库...');
      await _provider.init();
      report('Step 3: TauriSqlProvider 初始化完成');
      await logToDb('Initialized TauriSqlProvider');
      
      report('Step 4: 创建 AppStore...');
      _store = createAppStore(_provider);
      report('Step 4: AppStore 创建完成');
      await logToDb('Created AppStore');

      report('Step 4b: 清理僵尸采集任务...');
      const staleCount = await _store.getState().resetStaleTasks();
      if (staleCount > 0) {
        await logToDb(`Reset ${staleCount} stale collect tasks on startup`);
      }
      report(`Step 4b: 清理完成（${staleCount} 个僵尸任务）`);

      const elapsed = Date.now() - startTime;
      report(`=== initApp 完成 (${elapsed}ms) ===`);
      await logToDb(`initApp completed (${elapsed}ms)`);
      
//       // testCollect().catch(err => {
//         console.log(`testCollect error: ${err instanceof Error ? err.message : String(err)}`);
//       });
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const errorMsg = `initApp failed (${elapsed}ms): ${error instanceof Error ? error.message : String(error)}`;
      console.error(errorMsg);
      if (_provider) {
        await logToDb(errorMsg, 'error');
        if (error instanceof Error && error.stack) {
          await logToDb(`Stack trace: ${error.stack}`, 'error');
        }
      }
      throw error;
    }
  })();
  return _initPromise;
}

export function getStore(): AppStore {
  if (!_store) throw new Error('initApp() must be called before getStore()');
  return _store;
}

export function getProvider(): TauriSqlProvider {
  if (!_provider) throw new Error('initApp() must be called before getProvider()');
  return _provider;
}

export function getCollector() {
  return {
    collectLatest: async (page: number = 1, pageSize: number = 20) => {
      if (!_store) throw new Error('Store not initialized');
      await _store.getState().collectLatest();
      return _store.getState().mediaList;
    },
    collectByKeyword: async (keyword: string) => {
      if (!_store) throw new Error('Store not initialized');
      await _store.getState().collectByKeyword(keyword);
      return _store.getState().mediaList;
    },
  };
}

export type { AppState };

export async function testCollect(): Promise<void> {
  const msg = '=== testCollect started ===';
  logToConsole(msg);
  await logToDb(msg);
  
  try {
    if (!_store) {
      const errMsg = 'Store not initialized';
      logToConsole(errMsg);
      await logToDb(errMsg, 'error');
      return;
    }
    
    logToConsole('Calling collectLatest...');
    await logToDb('Calling collectLatest...');
    
    await _store.getState().collectLatest();
    
    const mediaList = _store.getState().mediaList;
    const resultMsg = `Collect completed, got ${mediaList.length} items`;
    logToConsole(resultMsg);
    await logToDb(resultMsg);
    
    if (mediaList.length > 0) {
      logToConsole(`First item: ${mediaList[0].title}, year: ${mediaList[0].year}`);
    }
  } catch (error) {
    const errorMsg = `Collect failed: ${error instanceof Error ? error.message : String(error)}`;
    logToConsole(errorMsg);
    if (_provider) {
      await logToDb(errorMsg, 'error');
    }
  }
  
  const completeMsg = '=== testCollect completed ===';
  logToConsole(completeMsg);
  await logToDb(completeMsg);
}