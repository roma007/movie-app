// 类型
export * from './types';

// 工具
export { DataNormalizer, normalizer } from './utils/normalizer';
export {
  isAiDrama,
  isBlacklisted,
  mapType,
  needsSeason,
  needsShortDramaCheck,
  isVersionTitle,
  refineTypeByEpisodes,
} from './utils/typeMapper';
export { TokenBucket } from './utils/tokenBucket';
export {
  defaultSources,
  BLACKLIST_KEYWORDS,
  MIN_YEAR,
  type DefaultSourceConfig,
} from './utils/constants';
export { getHttpClient, setHttpClient, type HttpClient } from './utils/httpClient';

// 服务
export { CMSAdapter } from './services/cmsAdapter';
export { CollectorService } from './services/collectorService';
export { SystemConfigService, type CollectConfig, type ShortDramaConfig } from './services/systemConfigService';
export { VideoDurationService, setVideoFetchFn, getVideoFetchFn } from './services/videoDurationService';

// 数据库抽象层
export { PRAGMA_SQL, SCHEMA_SQL, INSERT_DEFAULT_SOURCE_SQL, COUNT_VIDEO_SOURCE_SQL } from './db/schema';
export { type DatabaseProvider } from './db/provider';
export {
  rowToMedia,
  rowToEpisode,
  rowToPlaySource,
  rowToVideoSource,
  rowToFavorite,
  rowToWatchHistory,
  rowToCollectTask,
} from './db/rowMappers';

// 状态管理
export { createAppStore, type AppState, type AppStore } from './store/createStore';
