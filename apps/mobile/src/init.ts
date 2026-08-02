import { ExpoSqliteProvider } from './db/expoSqliteProvider';
import { createAppStore, CollectorService, setBackgroundImageCache, backfillSeriesGroup, type AppStore, type AppState } from '@movie-app/core';
import { mobileBackgroundImageCache } from './services/posterCache';

let _provider: ExpoSqliteProvider | null = null;
let _store: AppStore | null = null;
let _collector: CollectorService | null = null;
let _initPromise: Promise<void> | null = null;

/**
 * 初始化应用：创建 DatabaseProvider → 建表 → 注入 store 和 collector。
 * 幂等：多次调用返回同一个 Promise。
 */
export async function initApp(): Promise<void> {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    _provider = new ExpoSqliteProvider();
    await _provider.init();
    setBackgroundImageCache(mobileBackgroundImageCache);
    try {
      const removed = await _provider.deleteNonMediaPlaySources();
      if (removed > 0) {
        console.log(`[INIT] 清理了 ${removed} 条非媒体播放地址`);
      }
    } catch (err) {
      console.error('[INIT] 清理非媒体播放地址失败:', err);
    }
    try {
      const updated = await backfillSeriesGroup(_provider);
      if (updated > 0) console.log(`[INIT] 回填了 ${updated} 个 media 的系列字段`);
    } catch (err) {
      console.error('[INIT] 回填系列字段失败:', err);
    }
    _store = createAppStore(_provider);
    _collector = new CollectorService(_provider);

    // 清理僵尸采集任务（应用重启后残留的 RUNNING/PENDING 任务）
    try {
      const staleCount = await _store.getState().resetStaleTasks();
      if (staleCount > 0) {
        console.log(`[INIT] 清理了 ${staleCount} 个僵尸采集任务`);
      }
    } catch (err) {
      console.error('[INIT] 清理僵尸任务失败:', err);
    }

    // 启动自动增量采集调度器（移动端定时器在后台会被挂起，额外依赖 AppState 回前台触发）
    try {
      await _store.getState().startAutoCollect();
      _store.getState().maybeRunAutoCollect('startup').catch((err) => {
        console.error('[INIT] 启动自动采集失败:', err);
      });
    } catch (err) {
      console.error('[INIT] 启动自动增量采集调度器失败:', err);
    }
  })();
  return _initPromise;
}

export function getStore(): AppStore {
  if (!_store) throw new Error('initApp() must be called before getStore()');
  return _store;
}

export function getCollector(): CollectorService {
  if (!_collector) throw new Error('initApp() must be called before getCollector()');
  return _collector;
}

export function getProvider(): ExpoSqliteProvider {
  if (!_provider) throw new Error('initApp() must be called before getProvider()');
  return _provider;
}

export type { AppState };
