import { getStore } from './init';
import type { AppState } from '@movie-app/core';

/**
 * Zustand store hook（桌面端）。
 * 支持两种用法：
 *   const { mediaList } = useAppStore();              // 返回整个 state
 *   const mediaList = useAppStore(s => s.mediaList);  // 选择器订阅
 * 必须在 initApp() 完成后使用（App.tsx 已确保）。
 */
export function useAppStore<T = AppState>(selector?: (state: AppState) => T): T {
  const store = getStore();
  return selector ? store(selector) : (store as unknown as () => T)();
}

export { getStore, getCollector, initApp } from './init';
