import { create } from 'zustand';
import type { DatabaseProvider } from '../db/provider';
import type { Media, VideoSource, Favorite, WatchHistory } from '../types';

export interface AppState {
  mediaList: Media[];
  currentMedia: Media | null;
  episodes: any[];
  playSources: any[];
  seasons: number[];
  videoSources: VideoSource[];
  favorites: Favorite[];
  watchHistory: WatchHistory[];
  isLoading: boolean;
  error: string | null;

  loadMediaList: (params?: any) => Promise<void>;
  loadMediaDetail: (id: string) => Promise<void>;
  loadEpisodes: (mediaId: string, season?: number) => Promise<void>;
  loadPlaySources: (episodeId: string) => Promise<void>;
  loadSeasons: (mediaId: string) => Promise<void>;
  searchMedia: (keyword: string, page?: number) => Promise<void>;
  incrementView: (id: string) => Promise<void>;

  loadVideoSources: () => Promise<void>;
  toggleSourceEnabled: (id: string, enabled: boolean) => Promise<void>;
  addVideoSource: (source: VideoSource) => Promise<void>;
  removeVideoSource: (id: string) => Promise<void>;
  reorderSource: (id: string, priority: number) => Promise<void>;

  loadFavorites: () => Promise<void>;
  checkFavorite: (mediaId: string) => Promise<boolean>;
  toggleFav: (mediaId: string) => Promise<boolean>;

  loadWatchHistory: (page?: number) => Promise<void>;
  saveWatchProgress: (mediaId: string, episodeId: string | null, progress: number, duration: number) => Promise<void>;
  clearHistory: () => Promise<void>;
  removeHistoryItem: (mediaId: string) => Promise<void>;

  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

/**
 * Zustand store 工厂函数（依赖注入 DatabaseProvider）。
 * 移动端和桌面端各自调用 createAppStore(provider) 创建 store 实例。
 */
export function createAppStore(db: DatabaseProvider) {
  return create<AppState>((set, get) => ({
    mediaList: [],
    currentMedia: null,
    episodes: [],
    playSources: [],
    seasons: [],
    videoSources: [],
    favorites: [],
    watchHistory: [],
    isLoading: false,
    error: null,

    loadMediaList: async (params = {}) => {
      set({ isLoading: true, error: null });
      try {
        const result = await db.listMedia(params);
        set({ mediaList: result.items });
      } catch (err: any) {
        set({ error: err.message });
      } finally {
        set({ isLoading: false });
      }
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

    searchMedia: async (keyword: string, page: number = 1) => {
      set({ isLoading: true, error: null });
      try {
        const result = await db.searchMedia(keyword, page);
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
        const sources = await db.getAllVideoSources();
        set({ videoSources: sources });
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

    setLoading: (loading: boolean) => set({ isLoading: loading }),
    setError: (error: string | null) => set({ error }),
  }));
}

export type AppStore = ReturnType<typeof createAppStore>;
