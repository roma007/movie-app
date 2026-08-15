import { ExpoSqliteProvider } from './db/expoSqliteProvider';
import { DevSettings } from 'react-native';
import { createAppStore, CollectorService, backfillSeriesGroup, reclassifyShortDramaMovies, repairDeadPosterUrls, mergeDuplicateSeriesMedia, getCurrentStoreApiVersion, getStoreApiVersion, type AppStore, type AppState } from '@movie-app/core';

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
    try {
      const { replaced } = await repairDeadPosterUrls(provider);
      if (replaced > 0) console.log(`[INIT] 修复了 ${replaced} 条失效封面`);
    } catch (err) {
      console.error('[INIT] 失效封面修复失败:', err);
    }
    try {
      const { merged, removed } = await mergeDuplicateSeriesMedia(provider);
      if (merged > 0) console.log(`[INIT] 合并了 ${merged} 组同系列重复（删除 ${removed} 条）`);
    } catch (err) {
      console.error('[INIT] 同系列重复合并失败:', err);
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

    // 「越看越懂你」：启动时重建一次推荐分（后台执行，不阻塞首屏）
    try {
      setTimeout(() => {
        store.getState().flushRecommendationRecompute().then((changed) => {
          if (changed > 0) console.log(`[INIT] 推荐分重建完成（${changed} 条变化）`);
        }).catch((err) => {
          console.error('[INIT] 推荐分重建失败:', err);
        });
      }, 3000);
    } catch (err) {
      console.error('[INIT] 启动推荐分重建调度失败:', err);
    }
  })();
  return s.initPromise;
}

export function getStore(): AppStore {
  const store = getSingletons().store;
  if (!store) throw new Error('initApp() must be called before getStore()');
  // store 单例由 globalThis 承载，Fast Refresh 不会重建它。若 core 的 store API 版本已升级
  //（createStore.ts 被热更新替换），旧单例缺少新方法，须整包重载重建。
  const current = getCurrentStoreApiVersion();
  if (typeof current === 'string' && getStoreApiVersion(store) !== current) {
    if (__DEV__) {
      DevSettings.reload();
    }
  }
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
