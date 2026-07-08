import { ExpoSqliteProvider } from './db/expoSqliteProvider';
import { createAppStore, CollectorService, type AppStore, type AppState } from '@movie-app/core';

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
    _store = createAppStore(_provider);
    _collector = new CollectorService(_provider);
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
