// 类型
export * from './types';

// 工具
export { DataNormalizer, normalizer } from './utils/normalizer';
export { NOISE_SUBTYPES, isNoiseSubtype, expandSubTypes, extractFirstSubtypes } from './utils/genreSubtypes';
export { DEAD_IMAGE_HOSTS, extractImageHost, isKnownDeadPosterUrl, isUsablePosterUrl } from './utils/posterHost';
export {
  isAiDrama,
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
  MEDIA_FILE_EXTENSIONS,
  isPlayableMediaUrl,
  AI_SOURCE_PROMPT,
  AI_SOURCE_IMPORT_SAMPLE,
  type DefaultSourceConfig,
} from './utils/constants';
export { getHttpClient, setHttpClient, type HttpClient } from './utils/httpClient';
export {
  probeHlsStream,
  probeMultipleHlsStreams,
  summarizeProbeResults,
  type HlsProbeResult,
  type HlsStreamType,
} from './utils/hlsProbe';

// 服务
export { CMSAdapter } from './services/cmsAdapter';
export { CollectorService } from './services/collectorService';
export { backfillSeriesGroup } from './services/backfillService';
export { reclassifyShortDramaMovies } from './services/reclassifyService';
export { repairDeadPosterUrls, mergeDuplicateSeriesMedia } from './services/posterRepairService';
export { SystemConfigService, type CollectConfig, type ShortDramaConfig } from './services/systemConfigService';
export { AutoCollectScheduler } from './services/autoCollectScheduler';
export { VideoDurationService, setVideoFetchFn, getVideoFetchFn } from './services/videoDurationService';
export { SourceImportService } from './services/sourceImportService';
export { RecommendationService, type RecommendationOverview, type DislikedMediaItem, type TagBlacklistItem } from './services/recommendationService';
export { resolveDefaultPlayTarget, type DefaultPlayTarget } from './services/playbackTarget';

// 语音控制服务
export { 
  VoiceControlSystem, 
  createVoiceControlSystem, 
  getVoiceControlSystem,
  setGlobalVoiceControlSystem,
  initializeVoiceControl,
  type VoiceControlDependencies
} from './services/voiceControlSystem';
export { VoiceCommandParser, createDefaultParser } from './services/voiceCommandParser';
export { InMemoryWakeWordService, type IWakeWordService } from './services/wakeWordService';
export { InMemorySpeechRecognitionService, type ISpeechRecognitionService } from './services/speechRecognitionService';
export { InMemoryTTSService, VOICE_FEEDBACK_MESSAGES, type ITTSService } from './services/ttsService';
export { 
  VoicePowerOptimizer, 
  createPowerOptimizer, 
  getPowerOptimizer,
  type UsageScene 
} from './services/voicePowerOptimizer';

// 数据库抽象层
export { PRAGMA_SQL, SCHEMA_SQL, DROP_SYNC_REMNANTS_SQL, INSERT_DEFAULT_SOURCE_SQL, COUNT_VIDEO_SOURCE_SQL, splitSqlStatements } from './db/schema';
export { type DatabaseProvider, UNCATEGORIZED_GENRE } from './db/provider';
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
export { createAppStore, getCurrentStoreApiVersion, getStoreApiVersion, type AppState, type AppStore } from './store/createStore';
