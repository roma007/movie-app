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
 * 「未分类」子类型哨兵值：用于隐藏/取消隐藏没有任何子类型（genre 为空）的视频。
 * 空 genre 媒体无法用 LIKE 匹配，需用专门的空 genre 谓词处理。
 */
export const UNCATEGORIZED_GENRE = '未分类';

/**
 * 与数据库筛选谓词（buildWhere/分类页 CSV 筛选）语义等价的 JS 判定，
 * 用于「推荐排序」候选段在内存中过滤候选行（候选表仅数百~数千行）。
 * row 为 media 表的行（snake_case 字段）。参数为 ListParams。
 */
export function mediaMatchesFilters(
  row: {
    hidden?: number | null;
    kid_safe?: number | null;
    type?: string | null;
    year?: number | null;
    area?: string | null;
    genre?: string | null;
    is_short_drama?: number | null;
  },
  params: ListParams,
  kidModeActive: boolean
): boolean {
  if (!(row.hidden == null || row.hidden === 0)) return false;
  if (kidModeActive && row.kid_safe !== 1) return false;
  if (params.type && row.type !== params.type) return false;
  if (params.year != null && row.year !== params.year) return false;
  if (params.area && row.area !== params.area) return false;
  if (params.genre && !(row.genre ?? '').includes(params.genre)) return false;
  if (params.subType && !(row.genre ?? '').includes(params.subType)) return false;
  if (params.isShortDrama !== undefined && (row.is_short_drama === 1) !== params.isShortDrama) return false;
  return true;
}

/**
 * 数据库访问抽象层接口。
 * 移动端用 expo-sqlite 实现（ExpoSqliteProvider），
 * 桌面端用 tauri-plugin-sql 实现（TauriSqlProvider）。
 * 所有方法均为 async，返回领域对象（已完成 row → object 转换）。
 */
export interface DatabaseProvider {
  // —— Media DAO ——
  getMediaById(id: number): Promise<Media | null>;
  getMediaBySeriesGroup(groupKey: string): Promise<Media[]>;
  getMediaByFingerprint(fingerprint: string): Promise<Media | null>;
  listMedia(params?: ListParams): Promise<PaginatedResponse<Media>>;
  upsertMedia(media: Media): Promise<void>;
  updateMediaStatusAndEpisodes(
    mediaId: number,
    status: string,
    currentEpisodes: number | null,
    totalEpisodes: number | null,
    updatedAt: string
  ): Promise<void>;
  /** 更新该片的源侧更新时间（vod_time ISO）与源侧 vod_id，供采集「未变更跳过」对照；仅当值非空时调用。 */
  updateSourceSync(mediaId: number, sourceUpdatedAt: string | null, vodId: string | null): Promise<void>;
  /** 按源侧 vod_id 精确查片（采集跳过判定用，避开 list 精简响应无指纹输入的问题）。 */
  getMediaByVodId(vodId: string): Promise<Media | null>;
  updateMediaPoster(mediaId: number, posterUrl: string | null, updatedAt: string): Promise<void>;
  updateMediaRating(
    mediaId: number,
    data: {
      rating: number | null;
      ratingCount: number | null;
      source: 'DOUBAN';
      updatedAt: string;
    }
  ): Promise<void>;
  incrementViewCount(id: number): Promise<void>;
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
  getEpisodesByMediaId(mediaId: number, season?: number, sourceId?: string): Promise<Episode[]>;
  getEpisodeSourcesByMediaId(mediaId: number, season?: number): Promise<VideoSource[]>;
  getEpisodeById(id: number): Promise<Episode | null>;
  /** 单条 upsert（业务唯一键 media_id+season+ep+source 冲突合并）；返回该集实际入库的整数 id（新插入或已存在）。 */
  upsertEpisode(episode: Episode): Promise<number>;
  /** 批量 upsert 剧集（业务唯一键冲突合并）。返回按业务键的 id 映射，key 为 `${seasonNumber}:${episodeNumber}:${sourceId || ''}`，
   *  供调用方把 play_source.episode_id 指向入库后的整数 id（原字符串 id 生成已移除，id 改由 DB 分配）。 */
  upsertEpisodesBatch(episodes: Episode[]): Promise<Map<string, number>>;
  /** 写入单集已探测到的视频时长（秒），供播放页剧集列表复用，避免重复探测。 */
  updateEpisodeDuration(episodeId: number, duration: number | null): Promise<void>;
  deleteEpisodesByMediaIdAndSourceId(mediaId: number, sourceId: string): Promise<void>;
  /** 判断指定媒体+源下是否存在「版本合并痕迹」（play_source.language 非空），用于 commitItem 保护：存在时跳过先删后写，防止覆盖已追加的其他语言线路。 */
  hasVersionEpisodes(mediaId: number, sourceId: string): Promise<boolean>;
  getSeasonsByMediaId(mediaId: number): Promise<number[]>;

  // —— Media 批量操作 ——
  deleteAllMedia(): Promise<void>;
  deletePlaySourcesBySourceId(sourceId: string): Promise<void>;
  getMediaCountBySourceIdMap(): Promise<Map<string, number>>;
  deleteMediaCompletely(mediaId: number): Promise<void>;
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
  getPlaySourcesByEpisodeId(episodeId: number): Promise<PlaySource[]>;
  /** 合并保护：返回指定媒体+源下已入库的全部线路 URL，用于判定是否存在「非本轮写入」的外部线路（追加自其他版本条目）。 */
  getPlaySourceUrlsByMediaAndSource(mediaId: number, sourceId: string): Promise<string[]>;
  upsertPlaySource(playSource: PlaySource): Promise<void>;
  /** 批量 upsert 播放源（业务唯一键 episode_id+url 冲突合并）。 */
  upsertPlaySourcesBatch(playSources: PlaySource[]): Promise<void>;
  /** 播放页语言层：返回指定 media 下全部「语言 ↔ 剧集 ↔ 片源」去重映射，一次查询构建语言集合与语言→源→剧集过滤关系。 */
  getPlaySourceLanguagesByMedia(mediaId: number): Promise<{ language: string; episodeId: number; sourceId: string }[]>;

  // —— VideoSource DAO ——
  getAllVideoSources(): Promise<VideoSource[]>;
  getEnabledVideoSources(): Promise<VideoSource[]>;
  getVideoSourceById(id: string): Promise<VideoSource | null>;
  getVideoSourceByCode(code: string): Promise<VideoSource | null>;
  upsertVideoSource(source: VideoSource): Promise<void>;
  deleteVideoSource(id: string): Promise<void>;
  setVideoSourceEnabled(id: string, enabled: boolean): Promise<void>;
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
  isFavorite(mediaId: number): Promise<boolean>;
  addFavorite(mediaId: number): Promise<void>;
  removeFavorite(mediaId: number): Promise<void>;
  toggleFavorite(mediaId: number): Promise<boolean>;

  // —— WatchHistory DAO ——
  getAllWatchHistory(page?: number, pageSize?: number): Promise<WatchHistory[]>;
  getWatchHistoryCount(): Promise<number>;
  getAllWatchHistoryByMediaId(mediaId: number): Promise<WatchHistory[]>;
  getWatchHistoryByEpisodeId(mediaId: number, episodeId: number): Promise<WatchHistory | null>;
  upsertWatchHistory(
    mediaId: number,
    episodeId: number | null,
    progress: number,
    duration: number,
    sourceId?: string | null,
    playSourceId?: number | null,
  ): Promise<void>;
  clearWatchHistory(): Promise<void>;
  deleteWatchHistory(mediaId: number): Promise<void>;

  // —— WatchLineProgress DAO（按「媒体+剧集+线路」独立记忆的播放进度） ——
  /** 读取指定线路在该集的历史进度；无记录返回 null。 */
  getWatchLineProgressByPlaySource(
    mediaId: number,
    episodeId: number,
    playSourceId: number
  ): Promise<WatchHistory | null>;
  /** 写入/更新指定线路在该集的进度（复合主键 upsert）。 */
  upsertWatchLineProgress(
    mediaId: number,
    episodeId: number,
    playSourceId: number,
    progress: number,
    duration: number,
    sourceId?: string | null,
  ): Promise<void>;

  // —— SearchHistory DAO ——
  addSearchHistory(keyword: string): Promise<void>;
  getSearchHistory(limit?: number): Promise<{ keyword: string; count: number }[]>;
  getHotSearches(limit?: number): Promise<{ keyword: string; count: number }[]>;
  clearSearchHistory(): Promise<void>;
  deleteSearchHistory(keyword: string): Promise<void>;

  // —— Recommendation DAO ——
  /** 批量记录列表展示（跨会话累计 shown_count，UPSERT 合并）。返回到达惩罚边界（shown_count 3/6）的 mediaId 列表，供调度方触发重算。 */
  recordImpressions(items: { mediaId: number; shownAt: string }[]): Promise<number[]>;
  /** 重建用户兴趣标签表（先清空后批量插入）。 */
  replaceUserInterestTags(rows: {
    tag: string;
    tagType: 'genre' | 'director' | 'actor' | 'keyword';
    strength: number;
    sampleCount: number;
    updatedAt: string;
  }[]): Promise<void>;
  /** 重建推荐候选表（候选召回归一：推荐排序数据源，先清空后批量插入，分块写）。 */
  replaceRecommendationCandidates(rows: {
    mediaId: number;
    position: number;
    score: number;
    genreGroup: string;
  }[]): Promise<void>;
  /** 清空 impression、user_interest_tag、recommend_candidates（「清空重学」数据部分）。 */
  resetRecommendationData(): Promise<void>;

  // —— Dislike DAO（不感兴趣） ——
  /** 不感兴趣列表详情（含影片标题，供设置页展示）。 */
  getDislikedMediaDetail(): Promise<{ mediaId: number; title: string; createdAt: string }[]>;
  addDislike(mediaId: number): Promise<void>;
  removeDislike(mediaId: number): Promise<void>;

  // —— InterestTagBlacklist DAO（兴趣标签黑名单） ——
  getInterestTagBlacklist(): Promise<{ tag: string; tagType: string; createdAt: string }[]>;
  addInterestTagBlacklist(tag: string, tagType: string): Promise<void>;
  removeInterestTagBlacklist(tag: string, tagType: string): Promise<void>;

  // —— CollectTask DAO ——
  createCollectTask(task: CollectTask): Promise<void>;
  getCollectTaskById(taskId: string): Promise<CollectTask | null>;
  getAllCollectTasks(): Promise<CollectTask[]>;
  getRunningTasksBySourceCode(sourceCode: string): Promise<CollectTask[]>;
  updateCollectTask(taskId: string, updates: Partial<CollectTask>): Promise<void>;
  deleteCollectTask(taskId: string): Promise<void>;
  deleteOldTasks(days: number): Promise<void>;
  resetStaleTasks(): Promise<number>;

  // —— Reprobe Task DAO ——
  createReprobeTask(task: CollectTask): Promise<void>;
  updateReprobeTaskProgress(taskId: string, updates: {
    probedCount?: number;
    shortDramaCount?: number;
    longDramaCount?: number;
    status?: TaskStatus;
  }): Promise<void>;
  getRunningReprobeTask(): Promise<CollectTask | null>;

  // —— 儿童锁 ——
  /** 儿童模式是否激活（读 system_config + 内存缓存，启动时初始化）。 */
  getKidModeActive(): Promise<boolean>;
  /** 设置儿童模式开关（写 system_config 并同步内存缓存）。 */
  setKidModeActive(on: boolean): Promise<void>;

  // —— 通用 SQL ——
  select<T>(sql: string, params?: any[]): Promise<T[]>;
  selectOne<T>(sql: string, params?: any[]): Promise<T | null>;
  execute(sql: string, params?: any[]): Promise<void>;
  /**
   * 在 fn 内执行 DB 写且保证并发安全（写全局串行）。
   * - 移动端（expo-sqlite 单连接）：真事务（withExclusiveTransactionAsync），fn 抛错整体回滚；
   * - 桌面端（tauri-plugin-sql 连接池）：伪事务——仅 writeState 长锁串行 fn，无显式 BEGIN/COMMIT
   *   （连接池 execute('BEGIN') 不 pin 连接，会与后续写语句撞 WAL 写锁导致 database is locked）；
   *   原子性由「单条 multi-row SQL 原子」保证。
   * 用于采集批量写入，把一场页内多次独立提交串行化，降低写锁竞争。
   */
  withTransactionAsync<T>(fn: () => Promise<T>): Promise<T>;

  // —— 生命周期 ——
  init(): Promise<void>;
}
