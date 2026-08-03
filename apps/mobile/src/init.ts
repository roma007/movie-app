import { ExpoSqliteProvider } from './db/expoSqliteProvider';
import { createAppStore, CollectorService, backfillSeriesGroup, reclassifyShortDramaMovies, type AppStore, type AppState } from '@movie-app/core';

/**
 * 单例容器挂在 globalThis 上，保证 RN Fast Refresh（模块重执行）后单例不丢失。
 * 若使用模块级变量，Metro Fast Refresh 重执行 init.ts 时 _store/_initPromise 会被重置
 * 而 App 组件不会重新挂载（ready 仍为 true），触发
 * "initApp() must be called before getStore()"。
 */
const SINGLETONS_KEY = '__MOVIE_APP_SINGLETONS__';

interface AppSingletons {
  provider: ExpoSqliteProvider | null;
  store: AppStore | null;
  collector: CollectorService | null;
  initPromise: Promise<void> | null;
}

function getSingletons(): AppSingletons {
  const g = globalThis as any;
  if (!g[SINGLETONS_KEY]) {
    g[SINGLETONS_KEY] = { provider: null, store: null, collector: null, initPromise: null };
  }
  return g[SINGLETONS_KEY];
}

/**
 * 初始化应用：创建 DatabaseProvider → 建表 → 注入 store 和 collector。
 * 幂等：多次调用返回同一个 Promise。
 */
export async function initApp(): Promise<void> {
  const s = getSingletons();
  if (s.initPromise) return s.initPromise;
  s.initPromise = (async () => {
    const provider = new ExpoSqliteProvider();
    await provider.init();
    s.provider = provider;
    try {
      const removed = await provider.deleteNonMediaPlaySources();
      if (removed > 0) {
        console.log(`[INIT] 清理了 ${removed} 条非媒体播放地址`);
      }
    } catch (err) {
      console.error('[INIT] 清理非媒体播放地址失败:', err);
    }
    try {
      const updated = await backfillSeriesGroup(provider);
      if (updated > 0) console.log(`[INIT] 回填了 ${updated} 个 media 的系列字段`);
    } catch (err) {
      console.error('[INIT] 回填系列字段失败:', err);
    }
    try {
      const reclassified = await reclassifyShortDramaMovies(provider);
      if (reclassified > 0) console.log(`[INIT] 修复了 ${reclassified} 个误分类短剧`);
    } catch (err) {
      console.error('[INIT] 短剧类型修复失败:', err);
    }
    const store = createAppStore(provider);
    const collector = new CollectorService(provider);
    s.store = store;
    s.collector = collector;

    // 清理僵尸采集任务（应用重启后残留的 RUNNING/PENDING 任务）
    try {
      const staleCount = await store.getState().resetStaleTasks();
      if (staleCount > 0) {
        console.log(`[INIT] 清理了 ${staleCount} 个僵尸采集任务`);
      }
    } catch (err) {
      console.error('[INIT] 清理僵尸任务失败:', err);
    }

    // 启动自动增量采集调度器（移动端定时器在后台会被挂起，额外依赖 AppState 回前台触发）
    try {
      await store.getState().startAutoCollect();
      store.getState().maybeRunAutoCollect('startup').catch((err) => {
        console.error('[INIT] 启动自动采集失败:', err);
      });
    } catch (err) {
      console.error('[INIT] 启动自动增量采集调度器失败:', err);
    }
  })();
  return s.initPromise;
}

export function getStore(): AppStore {
  const store = getSingletons().store;
  if (!store) throw new Error('initApp() must be called before getStore()');
  return store;
}

export function getCollector(): CollectorService {
  const collector = getSingletons().collector;
  if (!collector) throw new Error('initApp() must be called before getCollector()');
  return collector;
}

export function getProvider(): ExpoSqliteProvider {
  const provider = getSingletons().provider;
  if (!provider) throw new Error('initApp() must be called before getProvider()');
  return provider;
}

export type { AppState };
