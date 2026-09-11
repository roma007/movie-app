import { Directory, File, Paths } from 'expo-file-system';

export function formatBytes(bytes: number): string {
  if (!isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function dirSize(dir: Directory): number {
  let total = 0;
  try {
    for (const item of dir.list()) {
      if (item instanceof Directory) {
        total += dirSize(item);
      } else if (item instanceof File) {
        total += item.size || 0;
      }
    }
  } catch {
    // 单个子目录读取失败不中断整体统计
  }
  return total;
}

export function getCacheSizeBytes(): number {
  const root = Paths.cache;
  if (!root.exists) return 0;
  let total = 0;
  try {
    for (const item of root.list()) {
      if (item instanceof Directory) {
        total += dirSize(item);
      } else if (item instanceof File) {
        total += item.size || 0;
      }
    }
  } catch {
    return 0;
  }
  return total;
}

export function clearCache(): number {
  const root = Paths.cache;
  if (!root.exists) return 0;
  let removedBytes = 0;
  try {
    for (const item of root.list()) {
      let size = 0;
      if (item instanceof Directory) {
        size = item.size || 0;
      } else if (item instanceof File) {
        size = item.size || 0;
      }
      try {
        item.delete();
        removedBytes += size;
      } catch {
        // 单个文件删除失败（如被占用）不中断整体清理
      }
    }
  } catch {
    return removedBytes;
  }
  return removedBytes;
}