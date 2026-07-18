import type {
  Media,
  Episode,
  PlaySource,
  VideoSource,
  Favorite,
  WatchHistory,
  PaginatedResponse,
  ListParams,
  CollectTask,
  TaskStatus,
} from '../types';

/**
 * 数据库访问抽象层接口。
 * 移动端用 expo-sqlite 实现（ExpoSqliteProvider），
 * 桌面端用 tauri-plugin-sql 实现（TauriSqlProvider）。
 * 所有方法均为 async，返回领域对象（已完成 row → object 转换）。
 */
export interface DatabaseProvider {
  // —— Media DAO ——
  getMediaById(id: string): Promise<Media | null>;
  getMediaByFingerprint(fingerprint: string): Promise<Media | null>;
  listMedia(params?: ListParams): Promise<PaginatedResponse<Media>>;
  upsertMedia(media: Media): Promise<void>;
  updateMediaStatusAndEpisodes(
    mediaId: string,
    status: string,
    currentEpisodes: number | null,
    totalEpisodes: number | null,
    updatedAt: string
  ): Promise<void>;
  incrementViewCount(id: string): Promise<void>;
  incrementSearchCount(id: string): Promise<void>;
  searchMedia(
    keyword: string,
    params?: {
      page?: number;
      pageSize?: number;
      type?: string;
      year?: number;
      area?: string;
      genre?: string;
    }
  ): Promise<PaginatedResponse<Media>>;

  getGenresByType(type?: string): Promise<string[]>;
  getSubTypesByType(type?: string, includeHidden?: boolean): Promise<string[]>;
  getYearsByType(type?: string): Promise<number[]>;
  getAreasByType(type?: string): Promise<string[]>;
  hasShortDrama(type?: string): Promise<boolean>;

  // —— Episode DAO ——
  getEpisodesByMediaId(mediaId: string, season?: number): Promise<Episode[]>;
  getEpisodeById(id: string): Promise<Episode | null>;
  upsertEpisode(episode: Episode): Promise<void>;
  deleteEpisodesByMediaId(mediaId: string): Promise<void>;
  getSeasonsByMediaId(mediaId: string): Promise<number[]>;

  // —— Media 批量操作 ——
  deleteAllMedia(): Promise<void>;
  deletePlaySourcesBySourceId(sourceId: string): Promise<void>;
  getMediaCountBySourceId(sourceId: string): Promise<number>;
  getMediaCountBySourceIdMap(): Promise<Map<string, number>>;
  deleteMediaCompletely(mediaId: string): Promise<void>;
  deleteMediaWithoutPlaySource(): Promise<number>;
  hideMediaByGenres(genres: string[]): Promise<{ hidden: number }>;
  unhideMediaByGenres(genres: string[]): Promise<{ unhidden: number }>;
  getHiddenMediaCount(): Promise<number>;

  // —— PlaySource DAO ——
  getPlaySourcesByEpisodeId(episodeId: string): Promise<PlaySource[]>;
  getPlaySourcesByMediaId(mediaId: string): Promise<PlaySource[]>;
  upsertPlaySource(playSource: PlaySource): Promise<void>;
  deletePlaySourcesByMediaId(mediaId: string): Promise<void>;
  deletePlaySourcesByMediaIdAndSourceId(mediaId: string, sourceId: string): Promise<void>;
  reportPlaySourceFail(sourceId: string): Promise<void>;

  // —— VideoSource DAO ——
  getAllVideoSources(): Promise<VideoSource[]>;
  getEnabledVideoSources(): Promise<VideoSource[]>;
  getVideoSourceById(id: string): Promise<VideoSource | null>;
  getVideoSourceByCode(code: string): Promise<VideoSource | null>;
  upsertVideoSource(source: VideoSource): Promise<void>;
  deleteVideoSource(id: string): Promise<void>;
  setVideoSourceEnabled(id: string, enabled: boolean): Promise<void>;
  updateSourcePriority(id: string, priority: number): Promise<void>;
  updateSourceRateLimit(id: string, rateLimit: number): Promise<void>;
  updateSourceHealth(id: string, data: {
    healthStatus: string;
    lastCheckAt?: string;
    lastSuccessAt?: string;
    failCount?: number;
    avgResponseTime?: number;
  }): Promise<void>;
  updateSourceLastCollectedAt(id: string, time: string): Promise<void>;
  incrementSourceRequestCount(id: string): Promise<void>;
  incrementSourceFailCount(id: string): Promise<void>;

  // —— Favorite DAO ——
  getAllFavorites(): Promise<Favorite[]>;
  isFavorite(mediaId: string): Promise<boolean>;
  addFavorite(mediaId: string): Promise<void>;
  removeFavorite(mediaId: string): Promise<void>;
  toggleFavorite(mediaId: string): Promise<boolean>;

  // —— WatchHistory DAO ——
  getAllWatchHistory(page?: number, pageSize?: number): Promise<WatchHistory[]>;
  getWatchHistoryByMediaId(mediaId: string): Promise<WatchHistory | null>;
  upsertWatchHistory(mediaId: string, episodeId: string | null, progress: number, duration: number): Promise<void>;
  clearWatchHistory(): Promise<void>;
  deleteWatchHistory(mediaId: string): Promise<void>;

  // —— SearchHistory DAO ——
  addSearchHistory(keyword: string): Promise<void>;
  getSearchHistory(limit?: number): Promise<{ keyword: string; count: number }[]>;
  getHotSearches(limit?: number): Promise<{ keyword: string; count: number }[]>;
  clearSearchHistory(): Promise<void>;
  deleteSearchHistory(keyword: string): Promise<void>;

  // —— CollectTask DAO ——
  createCollectTask(task: CollectTask): Promise<void>;
  getCollectTaskById(taskId: string): Promise<CollectTask | null>;
  getAllCollectTasks(): Promise<CollectTask[]>;
  getRunningTasksBySourceCode(sourceCode: string): Promise<CollectTask[]>;
  updateCollectTask(taskId: string, updates: Partial<CollectTask>): Promise<void>;
  deleteCollectTask(taskId: string): Promise<void>;
  deleteOldTasks(days: number): Promise<void>;
  resetStaleTasks(): Promise<number>;
  cancelCollectTask(taskId: string): Promise<void>;

  // —— Reprobe Task DAO ——
  createReprobeTask(task: CollectTask): Promise<void>;
  updateReprobeTaskProgress(taskId: string, updates: {
    probedCount?: number;
    shortDramaCount?: number;
    longDramaCount?: number;
    status?: TaskStatus;
  }): Promise<void>;
  getRunningReprobeTask(): Promise<CollectTask | null>;

  // —— 通用 SQL ——
  select<T>(sql: string, params?: any[]): Promise<T[]>;
  selectOne<T>(sql: string, params?: any[]): Promise<T | null>;
  execute(sql: string, params?: any[]): Promise<void>;

  // —— 生命周期 ——
  init(): Promise<void>;
  close?(): Promise<void>;
}
