import type { RemoteChange } from '../types';

/**
 * 冲突裁剪纯函数（II-4，复用清单 D/E）。
 * 删除优先；本地无记录 → 应用；否则远端时间戳更新才应用（last-write-wins）。
 */
export interface ShouldApplyArgs {
  remote: RemoteChange;
  /** getLastChangeTime：本记录最近一次变更时间（含已同步锚点） */
  localLastTs: number | null;
  /** 本机是否已有该记录（保留参数，供后续策略扩展） */
  localExists: boolean;
  /** 本机 device_id（同设备变更跳过，防回声） */
  localDeviceId: string | null;
}

export function shouldApply({ remote, localLastTs, localDeviceId }: ShouldApplyArgs): boolean {
  if (localDeviceId && remote.deviceId && remote.deviceId === localDeviceId) return false;
  if (remote.operation === 'DELETE') return true;
  if (localLastTs == null) return true;
  return remote.timestamp > localLastTs;
}