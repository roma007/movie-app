export type MediaType = 'MOVIE' | 'TV' | 'VARIETY' | 'ANIME' | 'DOCUMENTARY';

export type UserUsageType = 'SEARCH_FIRST' | 'NEW_MOVIES' | 'TV_SERIES';

export interface Media {
  id: string;
  title: string;
  originalTitle?: string | null;
  alias?: string | null;
  type: MediaType;
  year: number;
  area?: string | null;
  genres: string[];
  directors: string[];
  actors: string[];
  description?: string | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  status?: 'PUBLISHED' | 'ONGOING' | 'COMPLETED';
  remarks?: string | null;
  fingerprint: string;
  seriesGroup?: string | null;
  seriesSeason?: number | null;
  currentEpisodes?: number;
  totalEpisodes?: number;
  isShortDrama: boolean;
  durationCheckStatus?: 'SUMMARY' | 'PROBE' | 'FALLBACK' | null;
  episodeDuration?: number | null;
  viewCount: number;
  rating?: number | null;
  ratingCount?: number | null;
  ratingSource?: 'DOUBAN' | 'TMDB' | null;
  ratingUpdatedAt?: string | null;
  hidden?: boolean;
  personalScore?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Episode {
  id: string;
  mediaId: string;
  seasonNumber: number;
  episodeNumber: number;
  title?: string | null;
  duration?: number | null;
  sourceId?: string | null;
}

export interface PlaySource {
  id: string;
  episodeId: string;
  sourceId: string;
  sourceName?: string | null;
  url: string;
  quality?: string | null;
  isActive?: boolean;
  failCount?: number;
  lastFailAt?: string | null;
}

export interface VideoSource {
  id: string;
  code: string;
  name: string;
  baseUrl: string;
  type: string;
  isEnabled: boolean;
  rateLimit: number;
  healthStatus?: string | null;
  lastCheckAt?: string | null;
  lastCollectedAt?: string | null;
  lastIncrementalCollectedAt?: string | null;
  lastSuccessAt?: string | null;
  failCount?: number;
  totalRequests?: number;
  avgResponseTime?: number;
  mediaCount?: number;
}

export interface Favorite {
  id: string;
  mediaId: string;
  createdAt: string;
}

export interface WatchHistory {
  id: string;
  mediaId: string;
  episodeId?: string | null;
  progress: number;
  duration: number;
  sourceId?: string | null;
  playSourceId?: string | null;
  updatedAt: string;
}

export interface CMSMediaItem {
  vod_id: number;
  vod_name: string;
  vod_pic: string;
  vod_year: string;
  vod_area: string;
  vod_type: string;
  vod_actor: string;
  vod_director: string;
  vod_content: string;
  vod_play_from: string;
  vod_play_url: string;
  vod_remarks?: string;
  [key: string]: any;
}

export interface CMSListResponse {
  code: number;
  msg: string;
  page: number;
  pagecount: number;
  limit: string;
  total: number;
  list: CMSMediaItem[];
}

export interface PaginatedMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  meta: PaginatedMeta;
}

export interface ListParams {
  page?: number;
  pageSize?: number;
  sort?: 'hot' | 'latest' | 'rating' | 'year' | 'recommend';
  type?: string;
  year?: number;
  genre?: string;
  subType?: string;
  area?: string;
  isShortDrama?: boolean;
}

/** 列表页 → 详情页跳转携带的来源状态（用于返回还原同一列表状态）。 */
export interface MediaNavState {
  page?: number;
  type?: string;
  subType?: string;
  year?: number;
  area?: string;
  episodeType?: string;
  sort?: 'latest' | 'recommend';
  subtypePage?: boolean;
  searchKeyword?: string;
}

export type TaskStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export type TaskType = 'INCREMENTAL' | 'FULL' | 'KEYWORD' | 'REPROBE';

export type TaskErrorType = 'NETWORK' | 'PARSE' | 'DB' | 'TIMEOUT' | 'RATE_LIMIT' | 'CANCELLED' | 'UNKNOWN';

export interface CollectTask {
  id: string;
  taskId: string;
  sourceCode: string;
  sourceName: string;
  type: TaskType;
  status: TaskStatus;
  currentPage: number;
  totalPages: number;
  collectedCount: number;
  failedCount: number;
  errorMessage?: string | null;
  errorType?: TaskErrorType | null;
  lastErrorPage?: number | null;
  failedPages?: string | null;
  probedCount?: number;
  shortDramaCount?: number;
  longDramaCount?: number;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface CollectPreviewItem {
  previewId: string;
  fingerprint: string;
  title: string;
  year: number;
  type: MediaType;
  posterUrl: string;
  area: string;
  directors: string[];
  actors: string[];
  sourceName: string;
  sourceId: string;
  rawItem: CMSMediaItem;
}

export interface HiddenCollectItem {
  title: string;
  genres: string[];
}

export interface SavePreviewResult {
  saved: number;
  hiddenItems: HiddenCollectItem[];
}

export interface CollectionLog {
  id: string;
  timestamp: string;
  level: 'info' | 'error' | 'warn';
  message: string;
  taskId?: string;
  sourceCode?: string;
  sourceName?: string;
  details?: string;
}

export interface ImportSourceItem {
  name: string;
  code: string;
  baseUrl: string;
  rateLimit?: number;
}

export type SourceImportStatus =
  | 'valid'
  | 'duplicate_in_list'
  | 'code_exists'
  | 'url_exists'
  | 'invalid_field';

export interface ParsedImportSource {
  item: ImportSourceItem;
  status: SourceImportStatus;
  errors: string[];
  existingSource?: VideoSource;
}

// —— 多设备同步（OneDrive，2026-09-02 方案）相关类型 ——

export type SyncProviderType = 'onedrive';

export type SyncCategory = 'appConfig' | 'marks' | 'history' | 'progress' | 'collected' | 'preference';

export interface SyncConfig {
  provider: SyncProviderType;
  enabled: boolean;
  /** 自动轮询间隔（秒） */
  autoSyncInterval: number;
  lastSyncAt?: string | null;
  lastBackupAt?: string | null;
  /** 6 类数据开关（2.12），默认全开 */
  categories: Record<SyncCategory, boolean>;
}

export type ChangeLogOperation = 'INSERT' | 'UPDATE' | 'DELETE';

export interface ChangeLog {
  id: number;
  tableName: string;
  recordId: string;
  operation: ChangeLogOperation;
  deviceId?: string | null;
  timestamp: number;
  synced: number;
  /** 触发器只写元数据，data 恒为 NULL，payload 由 push 阶段现读（见 2.12/II-3） */
  data?: string | null;
}

export interface RemoteChange {
  table: string;
  recordId: string;
  operation: ChangeLogOperation;
  timestamp: number;
  /** 现读的行快照（snake_case 列）；DELETE 为 null */
  data?: any | null;
  deviceId?: string | null;
  /** apply 注入的远端时间戳（fallback payload.timestamp） */
  _remoteTs?: number;
}

export interface SyncPayload {
  deviceId: string;
  timestamp: number;
  changes: RemoteChange[];
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  applied: number;
  backupCreated?: boolean;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

// 语音控制相关类型
export * from './voice';
