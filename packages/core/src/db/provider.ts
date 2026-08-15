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
  CollectionLog,
} from '../types';

/**
 * 「未分类」子类型哨兵值：用于隐藏/取消隐藏没有任何子类型（genre 为空）的视频。
 * 空 genre 媒体无法用 LIKE 匹配，需用专门的空 genre 谓词处理。
 */
export const UNCATEGORIZED_GENRE = '未分类';

/**
 * 数据库访问抽象层接口。
 * 移动端用 expo-sqlite 实现（ExpoSqliteProvider），
 * 桌面端用 tauri-plugin-sql 实现（TauriSqlProvider）。
 * 所有方法均为 async，返回领域对象（已完成 row → object 转换）。
 */
export interface DatabaseProvider {
  // —— Media DAO ——
  getMediaById(id: string): Promise<Media | null>;
  getMediaBySeriesGroup(groupKey: string): Promise<Media[]>;
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
  updateMediaPoster(mediaId: string, posterUrl: string | null, updatedAt: string): Promise<void>;
  updateMediaRating(
    mediaId: string,
    data: {
      rating: number | null;
      ratingCount: number | null;
      source: 'DOUBAN';
      updatedAt: string;
    }
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
  getSubTypesByType(type?: string, includeHidden?: boolean, firstOnly?: boolean): Promise<string[]>;
  getYearsByType(type?: string): Promise<number[]>;
  getAreasByType(type?: string): Promise<string[]>;
  hasShortDrama(type?: string): Promise<boolean>;

  // —— Episode DAO ——
  getEpisodesByMediaId(mediaId: string, season?: number, sourceId?: string): Promise<Episode[]>;
  getEpisodeSourcesByMediaId(mediaId: string, season?: number): Promise<VideoSource[]>;
  getEpisodeById(id: string): Promise<Episode | null>;
  upsertEpisode(episode: Episode): Promise<void>;
  deleteEpisodesByMediaId(mediaId: string): Promise<void>;
  deleteEpisodesByMediaIdAndSourceId(mediaId: string, sourceId: string): Promise<void>;
  getSeasonsByMediaId(mediaId: string): Promise<number[]>;

  // —— Media 批量操作 ——
  deleteAllMedia(): Promise<void>;
  deletePlaySourcesBySourceId(sourceId: string): Promise<void>;
  getMediaCountBySourceId(sourceId: string): Promise<number>;
  getMediaCountBySourceIdMap(): Promise<Map<string, number>>;
  deleteMediaCompletely(mediaId: string): Promise<void>;
  deleteMediaWithoutPlaySource(): Promise<number>;
  deleteNonMediaPlaySources(): Promise<number>;
  hideMediaByGenres(genres: string[]): Promise<{ hidden: number }>;
  unhideMediaByGenres(genres: string[]): Promise<{ unhidden: number }>;
  getHiddenGenres(): Promise<string[]>;
  getHiddenMediaCount(): Promise<number>;
  /** 对账：把已隐藏子类型重新套用到现有媒体（genre 变更后 hidden 可能过期），返回新增隐藏数。 */
  syncHiddenByGenres(): Promise<number>;
  getUncategorizedCount(type?: string, includeHidden?: boolean): Promise<number>;

  // —— PlaySource DAO ——
  getPlaySourcesByEpisodeId(episodeId: string): Promise<PlaySource[]>;
  getPlaySourcesByMediaId(mediaId: string): Promise<PlaySource[]>;
  upsertPlaySource(playSource: PlaySource): Promise<void>;
  deletePlaySourcesByMediaId(mediaId: string): Promise<void>;
  deletePlaySourcesByMediaIdAndSourceId(mediaId: string, sourceId: string): Promise<void>;

  // —— VideoSource DAO ——
  getAllVideoSources(): Promise<VideoSource[]>;
  getEnabledVideoSources(): Promise<VideoSource[]>;
  getVideoSourceById(id: string): Promise<VideoSource | null>;
  getVideoSourceByCode(code: string): Promise<VideoSource | null>;
  upsertVideoSource(source: VideoSource): Promise<void>;
  deleteVideoSource(id: string): Promise<void>;
  setVideoSourceEnabled(id: string, enabled: boolean): Promise<void>;
  updateSourceRateLimit(id: string, rateLimit: number): Promise<void>;
  updateSourceHealth(id: string, data: {
    healthStatus: string;
    lastCheckAt?: string;
    lastSuccessAt?: string;
    failCount?: number;
    avgResponseTime?: number;
  }): Promise<void>;
  updateSourceLastCollectedAt(id: string, time: string): Promise<void>;
  updateSourceLastIncrementalCollectedAt(id: string, time: string): Promise<void>;
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
  getWatchHistoryCount(): Promise<number>;
  getWatchHistoryByMediaId(mediaId: string): Promise<WatchHistory | null>;
  getAllWatchHistoryByMediaId(mediaId: string): Promise<WatchHistory[]>;
  upsertWatchHistory(mediaId: string, episodeId: string | null, progress: number, duration: number): Promise<void>;
  clearWatchHistory(): Promise<void>;
  deleteWatchHistory(mediaId: string): Promise<void>;

  // —— SearchHistory DAO ——
  addSearchHistory(keyword: string): Promise<void>;
  getSearchHistory(limit?: number): Promise<{ keyword: string; count: number }[]>;
  getHotSearches(limit?: number): Promise<{ keyword: string; count: number }[]>;
  clearSearchHistory(): Promise<void>;
  deleteSearchHistory(keyword: string): Promise<void>;

  // —— Recommendation DAO ——
  /** 批量记录列表展示（跨会话累计 shown_count，UPSERT 合并）。返回到达惩罚边界（shown_count 3/6）的 mediaId 列表，供调度方触发重算。 */
  recordImpressions(items: { mediaId: string; shownAt: string }[]): Promise<string[]>;
  /** 重建用户兴趣标签表（先清空后批量插入）。 */
  replaceUserInterestTags(rows: {
    tag: string;
    tagType: 'genre' | 'director' | 'actor' | 'keyword';
    strength: number;
    sampleCount: number;
    updatedAt: string;
  }[]): Promise<void>;
  /** 重建推荐快照表（先清空后批量插入，分块写）。 */
  replaceRecommendationSnapshot(rows: {
    mediaId: string;
    position: number;
    score: number;
    genreGroup: string;
  }[]): Promise<void>;
  /** 清空 impression、user_interest_tag、recommend_snapshot 并将全表 personal_score 置 0（「清空重学」数据部分）。 */
  resetRecommendationData(): Promise<void>;

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

  // —— CollectionLog DAO ——
  addCollectionLog(log: CollectionLog): Promise<void>;
  getCollectionLogs(filter?: { taskId?: string; sourceCode?: string; level?: string; limit?: number; offset?: number }): Promise<CollectionLog[]>;
  clearCollectionLogs(beforeDays?: number): Promise<void>;

  // —— 通用 SQL ——
  select<T>(sql: string, params?: any[]): Promise<T[]>;
  selectOne<T>(sql: string, params?: any[]): Promise<T | null>;
  execute(sql: string, params?: any[]): Promise<void>;

  // —— 生命周期 ——
  init(): Promise<void>;
  close?(): Promise<void>;
}
