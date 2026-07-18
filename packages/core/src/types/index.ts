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
  currentEpisodes?: number;
  totalEpisodes?: number;
  isShortDrama: boolean;
  durationCheckStatus?: 'SUMMARY' | 'PROBE' | 'FALLBACK' | null;
  episodeDuration?: number | null;
  viewCount: number;
  hidden?: boolean;
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
  priority: number;
  healthStatus?: string | null;
  lastCheckAt?: string | null;
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
  sort?: 'hot' | 'latest' | 'rating' | 'year';
  type?: string;
  year?: number;
  genre?: string;
  subType?: string;
  area?: string;
  isShortDrama?: boolean;
}

export type TaskStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export type TaskType = 'INCREMENTAL' | 'FULL' | 'KEYWORD' | 'REPROBE';

export type TaskErrorType = 'NETWORK' | 'PARSE' | 'DB' | 'TIMEOUT' | 'CANCELLED' | 'UNKNOWN';

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

export interface CollectionLog {
  id: string;
  timestamp: string;
  level: 'info' | 'error' | 'warn';
  message: string;
  taskId?: string;
  sourceCode?: string;
  sourceName?: string;
}

export interface ImportSourceItem {
  name: string;
  code: string;
  baseUrl: string;
  rateLimit?: number;
  priority?: number;
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
