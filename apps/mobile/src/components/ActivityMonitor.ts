import { useEffect, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';

export interface FuncRow {
  page: string;
  busy_pct: number | null;
  seconds: number;
}

export interface LocalMetrics {
  totalBusyPct: number | null;
  funcs: FuncRow[];
  since: string;
  fps: number;
  storageMB: number | null;
}

const TICK_MS = 250;
const EMIT_MS = 5000;
const INACTIVE_TTL = 30000;
const STORAGE_REFRESH_MS = 30000;

// 递归统计沙盒目录占用（KB->MB 调用方换算）
async function dirSizeBytes(uri: string): Promise<number> {
  let total = 0;
  try {
    const entries = await FileSystem.readDirectoryAsync(uri);
    for (const name of entries) {
      const p = `${uri}${name}`;
      const it = await FileSystem.getInfoAsync(p);
      if (!it.exists) continue;
      try {
        if (it.isDirectory) {
          total += await dirSizeBytes(`${p}/`);
        } else {
          total += it.size as number;
        }
      } catch {
        total += it.size as number;
      }
    }
  } catch {
    return 0;
  }
  return total;
}

// iPhone：App 沙盒根目录（含 Documents/Library/tmp）总占用，即「占用存储空间」
async function calcAppStorageMB(): Promise<number | null> {
  try {
    const doc = FileSystem.documentDirectory;
    if (!doc) return null;
    const root = doc.replace(/\/Documents\/?$/, '');
    const bytes = await dirSizeBytes(root.endsWith('/') ? root : `${root}/`);
    return bytes > 0 ? bytes / 1048576 : null;
  } catch {
    return null;
  }
}

// iPhone 版资源监控数据源（App 内自包含本地聚合，不依赖 monitor.py）：
// - 主线程忙%：250ms 调度滞后累积（与安卓 JS 探针同法），按页面归因；
//   各页贡献占比 = 该页 busy / 全体窗口，之和恒 = 总忙%（与安卓清单对账语义一致）。
// - 不活跃页面 30s 自动消失；FPS 用 requestAnimationFrame 每秒帧计数。
// - iOS 沙盒无 App 级处理器/内存 API => 不采集，由 UI 文案注明。
export function useActivityMonitor(routeRef: { current: string }): LocalMetrics {
  const pagesRef = useRef(new Map<string, { busySum: number; winSum: number; lastActive: number }>());
  const busyRef = useRef({ busyMs: 0, started: Date.now(), lastEmit: Date.now() });
  const startAt = useRef(Date.now());
  const [metrics, setMetrics] = useState<LocalMetrics>(() => ({
    totalBusyPct: null,
    funcs: [],
    since: '',
    fps: 0,
    storageMB: null,
  }));

  useEffect(() => {
    const s = busyRef.current;
    const emit = () => {
      const now = Date.now();
      const r = routeRef.current || 'Home';
      const win = Math.max(1, now - s.started);
      const agg = pagesRef.current.get(r) ?? { busySum: 0, winSum: 0, lastActive: now };
      agg.busySum += s.busyMs;
      agg.winSum += win;
      agg.lastActive = now;
      pagesRef.current.set(r, agg);
      s.busyMs = 0;
      s.started = now;

      for (const [k, a] of pagesRef.current) {
        if (now - a.lastActive > INACTIVE_TTL) pagesRef.current.delete(k);
        else if (a.busySum <= 0 && a.winSum <= 0) pagesRef.current.delete(k);
      }

      let totalWin = 0;
      let totalBusy = 0;
      for (const a of pagesRef.current.values()) {
        totalWin += a.winSum;
        totalBusy += a.busySum;
      }
      const funcs: FuncRow[] = [...pagesRef.current.entries()]
        .filter(([, a]) => a.winSum > 0 || a.busySum > 0)
        .map(([page, a]) => ({
          page,
          busy_pct: totalWin > 0 ? Math.round((a.busySum / totalWin) * 1000) / 10 : null,
          seconds: Math.round(a.winSum / 1000),
        }))
        .sort((x, y) => (y.busy_pct ?? 0) - (x.busy_pct ?? 0));

      setMetrics((m) => ({
        totalBusyPct: totalWin > 0 ? Math.round((totalBusy / totalWin) * 1000) / 10 : null,
        funcs,
        since: new Date(startAt.current).toISOString(),
        fps: m.fps,
        storageMB: m.storageMB,
      }));
    };

    let expected = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const lag = now - expected;
      expected = now + TICK_MS;
      if (lag > TICK_MS + 10) s.busyMs += lag - TICK_MS;
      if (now - s.lastEmit >= EMIT_MS) emit();
    }, TICK_MS);

    let frames = 0;
    let rafAlive = true;
    const rafLoop = () => {
      if (!rafAlive) return;
      frames++;
      requestAnimationFrame(rafLoop);
    };
    requestAnimationFrame(rafLoop);
    const fpsTimer = setInterval(() => {
      setMetrics((m) => ({ ...m, fps: frames }));
      frames = 0;
    }, 1000);

    return () => {
      clearInterval(timer);
      clearInterval(fpsTimer);
      rafAlive = false;
    };
  }, [routeRef]);

  // 存储占用：沙盒遍历较贵，启动算一次 + 每 30s 重算
  useEffect(() => {
    let alive = true;
    let inFlight = false;
    const refresh = () => {
      if (inFlight) return;
      inFlight = true;
      calcAppStorageMB()
        .then((mb) => {
          if (alive && mb != null) setMetrics((m) => ({ ...m, storageMB: mb }));
        })
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
    };
    refresh();
    const t = setInterval(refresh, STORAGE_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return metrics;
}