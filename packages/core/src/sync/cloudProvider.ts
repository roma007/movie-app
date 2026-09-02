import type { SyncProviderType } from '../types';
import { OneDriveProvider, type OneDriveProviderDeps } from './onedriveProvider';

/**
 * 云端存储抽象（II-2）。路径基于 approot 相对路径，分隔符统一 '/'.
 * 目录层级固定为 `Apps/MovieApp/{changes|backups}/{deviceId}/`（SYNC_ROOT 前缀）。
 * engine 只消费 path 语义，不感知具体 provider 的 Graph 细节。
 */
export interface CloudProvider {
  readonly type: SyncProviderType;
  /** 幂等确保目录存在（含父级），已存在则静默成功 */
  ensurePath(path: string): Promise<void>;
  /** 列出某目录下的一层文件名 */
  listFiles(dirPath: string): Promise<string[]>;
  /** 读文件并 parse JSON；文件不存在返回 null */
  readJson(path: string): Promise<unknown | null>;
  /** 写文件（UTF-8 字符串 JSON），父目录假定已 ensure，自动覆盖 */
  writeJson(path: string, value: unknown): Promise<void>;
  /** 删除文件；不存在视为成功（幂等） */
  deleteFile(path: string): Promise<void>;
}

/** approot 相对根目录前缀 */
export const SYNC_ROOT = 'Apps/MovieApp';
/** 顶层目录名 */
export const SYNC_DIRS = { changes: 'changes', backups: 'backups' } as const;

/** 组装 changes/backups 完整相对路径 */
export function cloudPath(dir: keyof typeof SYNC_DIRS, deviceId: string, name?: string): string {
  const base = `${SYNC_ROOT}/${SYNC_DIRS[dir]}/${deviceId}`;
  return name ? `${base}/${name}` : base;
}

/** CloudProvider 工厂（架构预留 2.8）。 */
export type CloudProviderDeps = OneDriveProviderDeps;

export function createCloudProvider(type: SyncProviderType, deps: CloudProviderDeps): CloudProvider {
  switch (type) {
    case 'onedrive':
      return new OneDriveProvider(deps);
    default:
      throw new Error(`未知同步提供商: ${type as string}`);
  }
}