import { create } from 'zustand';
import type { DatabaseProvider } from '../db/provider';
import type { Media, VideoSource, Favorite, WatchHistory, PaginatedMeta, CollectTask } from '../types';
import type { CollectConfig } from '../services/systemConfigService';

export interface AppState {
  mediaList: Media[];
  mediaMeta: PaginatedMeta | null;
  currentMedia: Media | null;
  episodes: any[];
  playSources: any[];
  seasons: number[];
  videoSources: VideoSource[];
  favorites: Favorite[];
  watchHistory: WatchHistory[];
  isLoading: boolean;
  error: string | null;
  collectConfig: CollectConfig | null;
  collectTasks: CollectTask[];
  reprobeProgress: {
    total: number;
    processed: number;
    longDrama: number;
    shortDrama: number;
    failed: number;
    currentMediaTitle: string;
  } | null;
  reprobeMediaCount: number;
  reprobeMediaList: { id: string; title: string }[];

  loadMediaList: (params?: any) => Promise<void>;
  getGenresByType: (type?: string) => Promise<string[]>;
  getSubTypesByType: (type?: string) => Promise<string[]>;
  getYearsByType: (type?: string) => Promise<number[]>;
  getAreasByType: (type?: string) => Promise<string[]>;
  loadMediaDetail: (id: string) => Promise<void>;
  loadEpisodes: (mediaId: string, season?: number) => Promise<void>;
  loadPlaySources: (episodeId: string) => Promise<void>;
  loadSeasons: (mediaId: string) => Promise<void>;
  searchMedia: (keyword: string, params?: {
    page?: number;
    pageSize?: number;
    type?: string;
    year?: number;
    area?: string;
    genre?: string;
  }) => Promise<void>;
  incrementView: (id: string) => Promise<void>;

  loadVideoSources: () => Promise<void>;
  toggleSourceEnabled: (id: string, enabled: boolean) => Promise<void>;
  addVideoSource: (source: VideoSource) => Promise<void>;
  removeVideoSource: (id: string) => Promise<void>;
  reorderSource: (id: string, priority: number) => Promise<void>;
  updateSourceRateLimit: (id: string, rateLimit: number) => Promise<void>;

  loadFavorites: () => Promise<void>;
  checkFavorite: (mediaId: string) => Promise<boolean>;
  toggleFav: (mediaId: string) => Promise<boolean>;

  loadWatchHistory: (page?: number) => Promise<void>;
  saveWatchProgress: (mediaId: string, episodeId: string | null, progress: number, duration: number) => Promise<void>;
  clearHistory: () => Promise<void>;
  removeHistoryItem: (mediaId: string) => Promise<void>;

  loadCollectConfig: () => Promise<void>;
  updateCollectConfig: (config: Partial<CollectConfig>) => Promise<void>;

  collectLatest: () => Promise<void>;
  collectByKeyword: (keyword: string) => Promise<void>;
  collectAll: () => Promise<{ totalCollected: number; totalPages: number }>;
  checkVideoSource: (id: string) => Promise<{ healthy: boolean; responseTime: number }>;
  collectSourceLatest: (sourceCode: string) => Promise<{ success: boolean; taskId: string; collected: number; error?: string }>;
  collectSourceAll: (sourceCode: string) => Promise<{ success: boolean; taskId: string; collected: number; pages: number; error?: string }>;

  loadCollectTasks: () => Promise<void>;
  loadRunningCollectTasks: () => Promise<CollectTask[]>;
  getRunningTaskBySourceCode: (sourceCode: string) => CollectTask | null;
  deleteCollectTask: (taskId: string) => Promise<void>;
  deleteOldTasks: (days: number) => Promise<void>;
  resetStaleTasks: () => Promise<number>;

hasShortDrama: (type?: string) => Promise<boolean>;
  migrateAiDramaToMovie: () => Promise<{ migrated: number }>;
  deleteMediaByGenres: (keywords: string[]) => Promise<{ deleted: number }>;

  getReprobeMediaCount: () => Promise<number>;
  loadReprobeMediaList: () => Promise<void>;
  batchReprobeMedia: () => Promise<{
    total: number;
    longDrama: number;
    shortDrama: number;
    failed: number;
    failedItems: { id: string; title: string }[];
  }>;

  deleteAllMedia: () => Promise<void>;
  deletePlaySourcesBySourceId: (sourceId: string) => Promise<void>;
  deleteMediaWithoutPlaySource: () => Promise<number>;

  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

import { SystemConfigService } from '../services/systemConfigService';
import { CollectorService } from '../services/collectorService';

/**
 * Zustand store 工厂函数（依赖注入 DatabaseProvider）。
 * 移动端和桌面端各自调用 createAppStore(provider) 创建 store 实例。
 */
export function createAppStore(db: DatabaseProvider) {
  const configService = new SystemConfigService(db);
  const collectorService = new CollectorService(db);

  return create<AppState>((set, get) => ({
    mediaList: [],
    mediaMeta: null,
    currentMedia: null,
    episodes: [],
    playSources: [],
    seasons: [],
    videoSources: [],
    favorites: [],
    watchHistory: [],
    isLoading: false,
    error: null,
    collectConfig: null,
    collectTasks: [],
    reprobeProgress: null,
    reprobeMediaCount: 0,
    reprobeMediaList: [],

    loadMediaList: async (params = {}) => {
      console.log(`[STORE] loadMediaList called with params:`, params);
      set({ isLoading: true, error: null });
      try {
        const result = await db.listMedia(params);
        console.log(`[STORE] loadMediaList result: ${result.items.length} items, total: ${result.meta.total}`);
        set({ mediaList: result.items, mediaMeta: result.meta });
      } catch (err: any) {
        console.error(`[STORE] loadMediaList error:`, err);
        set({ error: err.message });
      } finally {
        console.log(`[STORE] loadMediaList finished, isLoading=false`);
        set({ isLoading: false });
      }
    },

    getGenresByType: async (type?: string) => {
      return await db.getGenresByType(type);
    },

    getSubTypesByType: async (type?: string) => {
      return await db.getSubTypesByType(type);
    },

    getYearsByType: async (type?: string) => {
      return await db.getYearsByType(type);
    },

    getAreasByType: async (type?: string) => {
      return await db.getAreasByType(type);
    },

    loadMediaDetail: async (id: string) => {
      set({ isLoading: true, error: null });
      try {
        const media = await db.getMediaById(id);
        set({ currentMedia: media });
      } catch (err: any) {
        set({ error: err.message });
      } finally {
        set({ isLoading: false });
      }
    },

    loadEpisodes: async (mediaId: string, season: number = 1) => {
      try {
        const episodes = await db.getEpisodesByMediaId(mediaId, season);
        set({ episodes });
      } catch (err: any) {
        set({ error: err.message });
      }
    },

    loadPlaySources: async (episodeId: string) => {
      try {
        const sources = await db.getPlaySourcesByEpisodeId(episodeId);
        set({ playSources: sources });
      } catch (err: any) {
        set({ error: err.message });
      }
    },

    loadSeasons: async (mediaId: string) => {
      try {
        const seasons = await db.getSeasonsByMediaId(mediaId);
        set({ seasons });
      } catch (err: any) {
        set({ error: err.message });
      }
    },

    searchMedia: async (keyword: string, params = {}) => {
      set({ isLoading: true, error: null });
      try {
        const result = await db.searchMedia(keyword, params);
        set({ mediaList: result.items });
      } catch (err: any) {
        set({ error: err.message });
      } finally {
        set({ isLoading: false });
      }
    },

    incrementView: async (id: string) => {
      try {
        await db.incrementViewCount(id);
      } catch (err) {
        console.error('增加观看数失败:', err);
      }
    },

    loadVideoSources: async () => {
      try {
        const [sources, countMap] = await Promise.all([
          db.getAllVideoSources(),
          db.getMediaCountBySourceIdMap(),
        ]);
        const sourcesWithCount = sources.map((source) => ({
          ...source,
          mediaCount: countMap.get(source.id) || 0,
        }));
        set({ videoSources: sourcesWithCount });
      } catch (err: any) {
        set({ error: err.message });
      }
    },

    toggleSourceEnabled: async (id: string, enabled: boolean) => {
      try {
        await db.setVideoSourceEnabled(id, enabled);
        await get().loadVideoSources();
      } catch (err: any) {
        set({ error: err.message });
      }
    },

    addVideoSource: async (source: VideoSource) => {
      try {
        await db.upsertVideoSource(source);
        await get().loadVideoSources();
      } catch (err: any) {
        set({ error: err.message });
      }
    },

    removeVideoSource: async (id: string) => {
      try {
        await db.deleteVideoSource(id);
        await get().loadVideoSources();
      } catch (err: any) {
        set({ error: err.message });
      }
    },

    reorderSource: async (id: string, priority: number) => {
      try {
        await db.updateSourcePriority(id, priority);
        await get().loadVideoSources();
      } catch (err: any) {
        set({ error: err.message });
      }
    },

    updateSourceRateLimit: async (id: string, rateLimit: number) => {
      try {
        await db.updateSourceRateLimit(id, rateLimit);
        await get().loadVideoSources();
      } catch (err: any) {
        set({ error: err.message });
      }
    },

    loadFavorites: async () => {
      try {
        const favorites = await db.getAllFavorites();
        set({ favorites });
      } catch (err: any) {
        set({ error: err.message });
      }
    },

    checkFavorite: async (mediaId: string) => {
      return await db.isFavorite(mediaId);
    },

    toggleFav: async (mediaId: string) => {
      const result = await db.toggleFavorite(mediaId);
      await get().loadFavorites();
      return result;
    },

    loadWatchHistory: async (page: number = 1) => {
      try {
        const history = await db.getAllWatchHistory(page);
        set({ watchHistory: history });
      } catch (err: any) {
        set({ error: err.message });
      }
    },

    saveWatchProgress: async (mediaId: string, episodeId: string | null, progress: number, duration: number) => {
      try {
        await db.upsertWatchHistory(mediaId, episodeId, progress, duration);
        set((state) => {
          const now = new Date().toISOString();
          const id = `wh_${mediaId}_${episodeId || 'movie'}`;
          const existingIndex = state.watchHistory.findIndex(h => h.mediaId === mediaId);
          const updatedItem = { id, mediaId, episodeId, progress, duration, updatedAt: now };
          let newHistory;
          if (existingIndex >= 0) {
            newHistory = [...state.watchHistory];
            newHistory[existingIndex] = updatedItem;
          } else {
            newHistory = [updatedItem, ...state.watchHistory];
          }
          newHistory.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
          return { watchHistory: newHistory.slice(0, 20) };
        });
      } catch (err) {
        console.error('保存观看进度失败:', err);
      }
    },

    clearHistory: async () => {
      try {
        await db.clearWatchHistory();
        set({ watchHistory: [] });
      } catch (err: any) {
        set({ error: err.message });
      }
    },

    removeHistoryItem: async (mediaId: string) => {
      try {
        await db.deleteWatchHistory(mediaId);
        await get().loadWatchHistory();
      } catch (err: any) {
        set({ error: err.message });
      }
    },

    loadCollectConfig: async () => {
      try {
        const config = await configService.getCollectConfig();
        set({ collectConfig: config });
      } catch (err: any) {
        set({ error: err.message });
      }
    },

    updateCollectConfig: async (config: Partial<CollectConfig>) => {
      try {
        await configService.setCollectConfig(config);
        await get().loadCollectConfig();
      } catch (err: any) {
        set({ error: err.message });
      }
    },

    collectLatest: async () => {
      set({ isLoading: true, error: null });
      try {
        await collectorService.collectLatest();
        await get().loadMediaList();
      } catch (err: any) {
        set({ error: err.message });
      } finally {
        set({ isLoading: false });
      }
    },

    collectByKeyword: async (keyword: string) => {
      set({ isLoading: true, error: null });
      try {
        await collectorService.collectByKeyword(keyword);
        await get().loadMediaList();
      } catch (err: any) {
        set({ error: err.message });
      } finally {
        set({ isLoading: false });
      }
    },

    collectAll: async () => {
      set({ isLoading: true, error: null });
      try {
        const result = await collectorService.collectAll();
        await get().loadMediaList();
        return result;
      } catch (err: any) {
        set({ error: err.message });
        return { totalCollected: 0, totalPages: 0 };
      } finally {
        set({ isLoading: false });
      }
    },

    checkVideoSource: async (id: string) => {
      try {
        const result = await collectorService.checkSource(id);
        await get().loadVideoSources();
        return result;
      } catch (err: any) {
        set({ error: err.message });
        return { healthy: false, responseTime: 0 };
      }
    },

    collectSourceLatest: async (sourceCode: string) => {
      try {
        const result = await collectorService.collectSourceLatest(sourceCode);
        await get().loadMediaList();
        await get().loadVideoSources();
        return { success: true, taskId: result.taskId, collected: result.collected };
      } catch (err: any) {
        set({ error: err.message });
        return { success: false, taskId: '', collected: 0, error: err.message };
      }
    },

    collectSourceAll: async (sourceCode: string) => {
      try {
        const result = await collectorService.collectSourceAll(sourceCode);
        await get().loadMediaList();
        await get().loadVideoSources();
        return { success: true, taskId: result.taskId, collected: result.collected, pages: result.pages };
      } catch (err: any) {
        set({ error: err.message });
        return { success: false, taskId: '', collected: 0, pages: 0, error: err.message };
      }
    },

    loadCollectTasks: async () => {
      try {
        const tasks = await db.getAllCollectTasks();
        set({ collectTasks: tasks });
      } catch (err: any) {
        set({ error: err.message });
      }
    },

    loadRunningCollectTasks: async () => {
      try {
        const allTasks = await db.getAllCollectTasks();
        set({ collectTasks: allTasks });
        return allTasks.filter((t) => t.status === 'PENDING' || t.status === 'RUNNING');
      } catch (err: any) {
        set({ error: err.message });
        return [];
      }
    },

    getRunningTaskBySourceCode: (sourceCode: string) => {
      const state = get();
      return state.collectTasks.find(
        (t) => t.sourceCode === sourceCode && (t.status === 'PENDING' || t.status === 'RUNNING')
      ) || null;
    },

    deleteCollectTask: async (taskId: string) => {
      try {
        await db.deleteCollectTask(taskId);
        await get().loadCollectTasks();
      } catch (err: any) {
        set({ error: err.message });
      }
    },

    deleteOldTasks: async (days: number) => {
      try {
        await db.deleteOldTasks(days);
        await get().loadCollectTasks();
      } catch (err: any) {
        set({ error: err.message });
      }
    },

    resetStaleTasks: async () => {
      try {
        return await db.resetStaleTasks();
      } catch (err: any) {
        set({ error: err.message });
        return 0;
      }
    },

    hasShortDrama: async (type?: string) => {
      try {
        return await db.hasShortDrama(type);
      } catch (err: any) {
        set({ error: err.message });
        return false;
      }
    },

    migrateAiDramaToMovie: async () => {
      try {
        return await collectorService.migrateAiDramaToMovie();
      } catch (err: any) {
        console.error('[STORE] AI漫剧迁移失败:', err);
        return { migrated: 0 };
      }
    },

    deleteMediaByGenres: async (keywords: string[]) => {
      try {
        const result = await collectorService.deleteMediaByGenres(keywords);
        await get().loadMediaList();
        return result;
      } catch (err: any) {
        console.error('[STORE] 按子类型删除失败:', err);
        return { deleted: 0 };
      }
    },

    getReprobeMediaCount: async () => {
      try {
        const count = await collectorService.getReprobeMediaCount();
        set({ reprobeMediaCount: count });
        return count;
      } catch (err: any) {
        console.error('[STORE] 获取重新探测数量失败:', err);
        return 0;
      }
    },

    loadReprobeMediaList: async () => {
      try {
        const list = await collectorService.getReprobeMediaList();
        set({ reprobeMediaList: list, reprobeMediaCount: list.length });
      } catch (err: any) {
        console.error('[STORE] 获取重新探测清单失败:', err);
      }
    },

    batchReprobeMedia: async () => {
      try {
        set({ reprobeProgress: { total: 0, processed: 0, longDrama: 0, shortDrama: 0, failed: 0, currentMediaTitle: '' } });
        const result = await collectorService.batchReprobeMedia((progress) => {
          set({ reprobeProgress: progress });
        });
        // 完成后更新数量、刷新清单并刷新列表
        await get().loadReprobeMediaList();
        await get().loadMediaList();
        set({ reprobeProgress: null });
        return result;
      } catch (err: any) {
        console.error('[STORE] 批量重新探测失败:', err);
        set({ reprobeProgress: null });
        return { total: 0, longDrama: 0, shortDrama: 0, failed: 0, failedItems: [] };
      }
    },

    deleteAllMedia: async () => {
      await db.deleteAllMedia();
      set({ mediaList: [], currentMedia: null, episodes: [], playSources: [] });
    },

    deletePlaySourcesBySourceId: async (sourceId: string) => {
      await db.deletePlaySourcesBySourceId(sourceId);
    },

    deleteMediaWithoutPlaySource: async () => {
      const deletedCount = await db.deleteMediaWithoutPlaySource();
      await get().loadMediaList();
      await get().loadVideoSources();
      return deletedCount;
    },

    setLoading: (loading: boolean) => set({ isLoading: loading }),
    setError: (error: string | null) => set({ error }),
  }));
}

export type AppStore = ReturnType<typeof createAppStore>;
