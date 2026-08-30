import { File, Paths } from 'expo-file-system';
import { VideoDurationService } from '@movie-app/core';

/** 分片加载状态（与原生桥文件 segment_progress.json 的 state 字段同语义：0=loading 1=done 2=error）。 */
export interface NativeSegmentState {
  url: string;
  state: 0 | 1 | 2;
  progress: number;
}

/** 合并 m3u8 分片清单与原生加载状态后的展示快照（语义对齐桌面 SegmentProgressState）。 */
export interface MobileSegmentProgressState {
  index: number;
  duration: number;
  start: number;
  progress: number | null;
  done: boolean;
  error: boolean;
  playing: boolean;
  departing: boolean;
}

export interface SegmentProgressSnapshot {
  segments: MobileSegmentProgressState[];
  prefetchedSeconds: number;
  updatedAt: number;
}

let lastNativeState: Record<string, NativeSegmentState> = {};

/**
 * 读取原生层写出的分片状态桥文件：
 * - Android: expo-video VideoPlayer.kt（AnalyticsListener，功能13）写 cacheDir/segment_progress.json
 * - iOS: expo-video-cache SessionRouter（功能13）写 Library/Caches/segment_progress.json
 * 两端都落在 expo-file-system 的 Paths.cache 根下（iOS = NSCachesDirectory，Android = context.cacheDir），
 * 与 prefetch_concurrency 的既存文件桥机制完全一致。
 */
export async function readNativeSegmentState(): Promise<Record<string, NativeSegmentState>> {
  try {
    const file = new File(Paths.cache, 'segment_progress.json');
    if (!file.exists) return {};
    const raw = await file.text();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const list: NativeSegmentState[] = Array.isArray(parsed?.segments) ? parsed.segments : [];
    const map: Record<string, NativeSegmentState> = {};
    for (const item of list) {
      if (item && typeof item.url === 'string') {
        map[item.url] = { url: item.url, state: item.state ?? 0, progress: item.progress ?? 0 };
      }
    }
    return map;
  } catch {
    return lastNativeState;
  }
}

function buildSnapshot(segments: { url: string; duration: number; start: number }[], native: Record<string, NativeSegmentState>, currentTime: number): SegmentProgressSnapshot {
  // 正在播放分片：currentTime 落在哪个分片的 [start, start+duration)
  let playingIndex = -1;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (currentTime >= seg.start && currentTime < seg.start + seg.duration) {
      playingIndex = i;
      break;
    }
  }
  if (playingIndex === -1 && segments.length > 0 && currentTime >= segments[segments.length - 1].start + segments[segments.length - 1].duration) {
    playingIndex = segments.length - 1;
  }

  const out: MobileSegmentProgressState[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (i < playingIndex) continue; // 已播放分片一律不显示：蓝柱始终在最左，左侧只留「预读 N 秒」（对照桌面视觉）
    const seg = segments[i];
    const nativeState = native[seg.url];
    if (!nativeState) continue;
    out.push({
      index: i,
      duration: seg.duration,
      start: seg.start,
      progress: nativeState.state === 1 ? 1 : nativeState.progress > 0 ? Math.min(1, nativeState.progress) : null,
      done: nativeState.state === 1,
      error: nativeState.state === 2,
      playing: i === playingIndex,
      departing: false,
    });
  }
  // 预读秒数 = 显示分片时长和（全部来自未离开分片），对照桌面 SegmentProgress.tsx 同一语义
  const prefetchedSeconds = out.reduce((acc, s) => acc + (s.departing ? 0 : s.duration), 0);
  return { segments: out, prefetchedSeconds, updatedAt: Date.now() };
}

/**
 * 供播放页轮询调用的快照生成器：
 * @param manifestUrl 当前播放的 m3u8 URL（每次进入/换源需重新解析分片清单）
 * @param currentTime 真实播放位置
 */
export function createSegmentSnapshotBuilder(manifestUrl: string | null) {
  let segments: { url: string; duration: number; start: number }[] | null = null;
  let resolving: Promise<{ url: string; duration: number; start: number }[] | null> | null = null;
  let m3u8Url = manifestUrl;

  const ensurePlaylist = (): Promise<void> => {
    if (segments || !m3u8Url) return Promise.resolve();
    let current: Promise<{ url: string; duration: number; start: number }[] | null>;
    if (!resolving) {
      current = new VideoDurationService().getSegmentListFromM3U8(m3u8Url);
      resolving = current.finally(() => { resolving = null; });
    } else {
      current = resolving;
    }
    return current.then((list) => { segments = list; }).catch(() => { segments = null; }).then(() => {});
  };

  return {
    async snapshot(currentTime: number): Promise<SegmentProgressSnapshot> {
      await ensurePlaylist();
      if (!segments || segments.length === 0) {
        return { segments: [], prefetchedSeconds: 0, updatedAt: Date.now() };
      }
      const native = await readNativeSegmentState();
      lastNativeState = native;
      return buildSnapshot(segments, native, currentTime);
    },
    get url() {
      return m3u8Url;
    },
    set url(u: string | null) {
      m3u8Url = u;
      segments = null;
      resolving = null;
    },
  };
}