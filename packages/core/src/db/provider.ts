import type {
  Media,
  Episode,
  PlaySource,
  VideoSource,
  Favorite,
  WatchHistory,
  PaginatedResponse,
  ListParams,
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
  incrementViewCount(id: string): Promise<void>;
  incrementSearchCount(id: string): Promise<void>;
  searchMedia(keyword: string, page?: number, pageSize?: number): Promise<PaginatedResponse<Media>>;

  // —— Episode DAO ——
  getEpisodesByMediaId(mediaId: string, season?: number): Promise<Episode[]>;
  getEpisodeById(id: string): Promise<Episode | null>;
  upsertEpisode(episode: Episode): Promise<void>;
  deleteEpisodesByMediaId(mediaId: string): Promise<void>;
  getSeasonsByMediaId(mediaId: string): Promise<number[]>;

  // —— PlaySource DAO ——
  getPlaySourcesByEpisodeId(episodeId: string): Promise<PlaySource[]>;
  getPlaySourcesByMediaId(mediaId: string): Promise<PlaySource[]>;
  upsertPlaySource(playSource: PlaySource): Promise<void>;
  deletePlaySourcesByMediaId(mediaId: string): Promise<void>;

  // —— VideoSource DAO ——
  getAllVideoSources(): Promise<VideoSource[]>;
  getEnabledVideoSources(): Promise<VideoSource[]>;
  getVideoSourceById(id: string): Promise<VideoSource | null>;
  getVideoSourceByCode(code: string): Promise<VideoSource | null>;
  upsertVideoSource(source: VideoSource): Promise<void>;
  deleteVideoSource(id: string): Promise<void>;
  setVideoSourceEnabled(id: string, enabled: boolean): Promise<void>;
  updateSourcePriority(id: string, priority: number): Promise<void>;
  updateSourceHealth(id: string, healthStatus: string): Promise<void>;

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

  // —— 生命周期 ——
  init(): Promise<void>;
  close?(): Promise<void>;
}
