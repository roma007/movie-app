import { TauriSqlProvider } from './db/tauriSqlProvider';
import { createAppStore, setHttpClient, setVideoFetchFn, backfillSeriesGroup, reclassifyShortDramaMovies, repairDeadPosterUrls, mergeDuplicateSeriesMedia, getCurrentStoreApiVersion, getStoreApiVersion, type AppStore, type AppState, type HttpClient } from '@movie-app/core';

let _provider: TauriSqlProvider | null = null;
let _store: AppStore | null = null;
let _initPromise: Promise<void> | null = null;
let _hasColdStarted = false;

async function logToDb(_message: string, _level: 'info' | 'error' = 'info'): Promise<void> {
  // DiagnosticLogViewer removed; logs no longer written to system_config
}

function logToConsole(message: string): void {
  console.log(`[MOVIE-APP] ${message}`);
}

// 主窗口刷新后 store 重置会让 pipActive/session 丢失。若 PIP 独立窗口（label `pip`）
// 仍存活，此处在启动阶段（UI 渲染前、无 openPlayback 并发）预置 pipActive=true，
// 让主窗口保持暂停并显示 PIP 占位遮罩，消除「播放页与 PIP 双流」竞态。
async function probePipAlive(): Promise<boolean> {
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const pipWin = await WebviewWindow.getByLabel('pip');
    if (!pipWin) return false;
    const { usePlayerStore } = await import('./stores/playerStore');
    usePlayerStore.getState().setPipActive(true);
    logToConsole('检测到 PIP 窗口仍存活，主窗口保持暂停（恢复 PIP 模式）');
    return true;
  } catch {
    return false;
  }
}

async function createTauriHttpClient(): Promise<HttpClient> {
  logToConsole('>>> createTauriHttpClient started');
  
  let clientType = 'unknown';
  
  try {
    logToConsole('>>> Trying to import @tauri-apps/plugin-http');
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    logToConsole('>>> Successfully imported @tauri-apps/plugin-http');
    clientType = 'tauri';
    
    return {
      async get(url: string, options?: { headers?: Record<string, string>; timeout?: number; signal?: AbortSignal }) {
        logToConsole(`HTTP GET (tauri): ${url}`);
        
        const timeout = options?.timeout || 15000;

        const fetchPromise = (async () => {
          const response = await tauriFetch(url, {
            method: 'GET',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              ...options?.headers,
            },
            connectTimeout: timeout,
          });

          logToConsole(`HTTP RESPONSE (tauri): status=${response.status}, ok=${response.ok}`);

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const data = await response.json();
          logToConsole(`HTTP DATA (tauri): parsed OK, list length: ${data.list?.length || 0}`);

          return { data, status: response.status };
        })();

        const timeoutPromise = new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error('请求超时')), timeout);

          if (options?.signal) {
            if (options.signal.aborted) {
              clearTimeout(timer);
              reject(new DOMException('The operation was aborted.', 'AbortError'));
              return;
            }
            options.signal.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            }, { once: true });
          }
        });

        return Promise.race([fetchPromise, timeoutPromise]);
      },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logToConsole(`>>> Tauri HTTP 插件加载失败: ${errorMsg}`);
    logToConsole('>>> Falling back to native fetch (may have CORS issues)');
    clientType = 'native-fetch';
    
    return {
      async get(url: string, options?: { headers?: Record<string, string>; timeout?: number }) {
        logToConsole(`HTTP GET (native-fetch): ${url}`);
        
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
          
          logToConsole(`HTTP RESPONSE (native-fetch): status=${response.status}, type=${response.type}, ok=${response.ok}`);
          
          if (response.type === 'opaque') {
            logToConsole('HTTP ERROR (native-fetch): CORS blocked - opaque response');
            throw new Error('CORS blocked - 无法访问外部API。请检查网络连接或防火墙设置。');
          }
          
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          
          const data = await response.json();
          logToConsole(`HTTP DATA (native-fetch): parsed OK`);
          
          return {
            data,
            status: response.status,
          };
        } catch (error) {
          clearTimeout(timeoutId);
          const fetchErrorMsg = error instanceof Error ? error.message : String(error);
          logToConsole(`HTTP ERROR (native-fetch): ${fetchErrorMsg}`);
          
          if (fetchErrorMsg.includes('CORS') || fetchErrorMsg.includes('opaque')) {
            throw new Error('CORS错误 - 无法访问外部API。这通常是因为Tauri HTTP插件加载失败。请尝试重新安装应用。');
          }
          if (fetchErrorMsg.includes('Failed to fetch') || fetchErrorMsg.includes('NetworkError')) {
            throw new Error('网络错误 - 无法连接到服务器。请检查网络连接。');
          }
          throw error;
        }
      },
    };
  } finally {
    logToConsole(`>>> HTTP Client type: ${clientType}`);
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
        const { pooledVideoFetch } = await import('./components/player/pooledFetch');
        setVideoFetchFn(pooledVideoFetch as typeof fetch);
        report('Step 1b: Video fetch (pooled) 配置完成');
      } catch {
        report('Step 1b: pooled fetch 不可用，使用 native fetch');
      }

      report('Step 2: 创建 TauriSqlProvider...');
      _provider = new TauriSqlProvider();
      report('Step 2: TauriSqlProvider 创建完成');
      
      report('Step 3: 初始化数据库...');
      await _provider.init();
      report('Step 3: TauriSqlProvider 初始化完成');
      await logToDb('Initialized TauriSqlProvider');

      try {
        const updated = await backfillSeriesGroup(_provider);
        if (updated > 0) await logToDb(`Backfilled series_group for ${updated} media`);
        report(`Step 3b: 回填系列字段完成（${updated} 条）`);
      } catch (err) {
        const errMsg = `回填系列字段失败: ${err instanceof Error ? err.message : String(err)}`;
        console.error(errMsg);
        await logToDb(errMsg, 'error');
      }

      try {
        const reclassified = await reclassifyShortDramaMovies(_provider);
        if (reclassified > 0) await logToDb(`Reclassified ${reclassified} short-drama media to TV`);
        report(`Step 3d: 短剧类型修复完成（${reclassified} 条）`);
      } catch (err) {
        const errMsg = `短剧类型修复失败: ${err instanceof Error ? err.message : String(err)}`;
        console.error(errMsg);
        await logToDb(errMsg, 'error');
      }

      try {
        const { replaced } = await repairDeadPosterUrls(_provider);
        if (replaced > 0) await logToDb(`Repaired ${replaced} dead poster urls`);
        report(`Step 3e: 失效封面修复完成（${replaced} 条）`);
      } catch (err) {
        const errMsg = `失效封面修复失败: ${err instanceof Error ? err.message : String(err)}`;
        console.error(errMsg);
        await logToDb(errMsg, 'error');
      }

      try {
        const { merged, removed } = await mergeDuplicateSeriesMedia(_provider);
        if (merged > 0) await logToDb(`Merged ${merged} duplicate series (removed ${removed} rows)`);
        report(`Step 3f: 同系列重复合并完成（${merged} 组 / 删除 ${removed} 条）`);
      } catch (err) {
        const errMsg = `同系列重复合并失败: ${err instanceof Error ? err.message : String(err)}`;
        console.error(errMsg);
        await logToDb(errMsg, 'error');
      }
      
      report('Step 4: 创建 AppStore...');
      _store = createAppStore(_provider);
      report('Step 4: AppStore 创建完成');
      await logToDb('Created AppStore');

      report('Step 4a: 探测 PIP 窗口存活（刷新恢复场景）...');
      await probePipAlive();
      report('Step 4a: PIP 存活探测完成');

      report('Step 4b: 清理僵尸采集任务...');
      const staleCount = await _store.getState().resetStaleTasks();
      if (staleCount > 0) {
        await logToDb(`Reset ${staleCount} stale collect tasks on startup`);
      }
      report(`Step 4b: 清理完成（${staleCount} 个僵尸任务）`);

      report('Step 4c: 启动自动增量采集调度器...');
      try {
        await _store.getState().startAutoCollect();
        // 延迟触发启动采集，等待网络与界面稳定
        setTimeout(() => {
          _store?.getState().maybeRunAutoCollect('startup').catch(err => {
            console.error('[AutoCollect] 启动自动采集失败:', err);
          });
        }, 5000);
        report('Step 4c: 自动增量采集调度器已启动');
      } catch (err) {
        const errMsg = `启动自动增量采集失败: ${err instanceof Error ? err.message : String(err)}`;
        console.error(errMsg);
        await logToDb(errMsg, 'error');
      }

      report('Step 4d: 重建「越看越懂你」推荐分（异步）...');
      // 异步执行推荐重算，不阻塞启动流程
      setTimeout(() => {
        _store?.getState().flushRecommendationRecompute().then((changed) => {
          if (changed > 0) console.log(`[INIT] 推荐分重建完成（${changed} 条变化）`);
        }).catch((err) => {
          console.error('[INIT] 推荐分重建失败:', err);
        });
      }, 3000);

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
  // 开发期 HMR 替换 createStore.ts 后，旧 _store 单例缺少新 API，重载窗口重建
  const current = getCurrentStoreApiVersion();
  if (typeof current === 'string' && getStoreApiVersion(_store) !== current) {
    if (import.meta.env.DEV) {
      window.location.reload();
    }
  }
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