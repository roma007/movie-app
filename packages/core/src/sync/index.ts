// —— 多设备同步内核（OneDrive，阶段 II） ——

export type { TokenStore } from './tokenStore';

export {
  SYNC_ROOT,
  SYNC_DIRS,
  cloudPath,
  createCloudProvider,
} from './cloudProvider';
export type { CloudProvider, CloudProviderDeps } from './cloudProvider';
export { setGlobalCloudFetch, getGlobalCloudFetch } from './cloudFetch';
export type { CloudFetch } from './cloudFetch';
export {
  OneDriveProvider,
  NotFoundError,
  GraphConflictError,
} from './onedriveProvider';
export type { OneDriveProviderDeps } from './onedriveProvider';

export { shouldApply } from './conflictResolver';
export type { ShouldApplyArgs } from './conflictResolver';
export { buildPayload } from './changeTracker';
export type { BuiltPayload } from './changeTracker';
export {
  CATEGORY_TABLES,
  tableToCategory,
  categoryEnabled,
} from './categories';

export {
  SyncEngine,
  SyncError,
  BACKUP_SCHEMA_VERSION,
} from './syncEngine';
export type { PullAppliedResult } from './syncEngine';
export {
  SyncService,
} from './syncService';
export type { SyncServiceEvent, SyncStatus } from './syncService';