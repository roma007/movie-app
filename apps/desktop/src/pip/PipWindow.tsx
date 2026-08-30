import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { MediaPlayerInstance } from '@vidstack/react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emit, listen } from '@tauri-apps/api/event';
import { ExternalLink, Maximize2, X } from 'lucide-react';
import type { PlaySource } from '@movie-app/core';
import { VideoPlayer } from '../components/player/VideoPlayer';
import { PlayerOverlays } from '../components/player/PlayerOverlays';
import { ThemeProvider } from '../themes/ThemeProvider';
import { FontSizeProvider } from '../themes/FontSizeProvider';

const HEADER_H = 36;
const TIME_EMIT_MS = 5000;

interface PipNextEpisode {
  id: string;
  title?: string | null;
  episodeNumber: number;
}

export interface PipPayload {
  episodeId: string;
  title: string;
  episodeLabel: string;
  sources: PlaySource[];
  playSourceId: string | null;
  currentTime: number;
  volume: number;
  muted: boolean;
  nextEpisode: PipNextEpisode | null;
  outroThresholdMinutes: number;
  showNextEpisodeOverlay: boolean;
}

type ResizeDir = 'North' | 'South' | 'East' | 'West' | 'NorthEast' | 'NorthWest' | 'SouthEast' | 'SouthWest';

function parsePayload(): PipPayload | null {
  try {
    const raw = new URLSearchParams(window.location.search).get('d');
    if (!raw) return null;
    return JSON.parse(raw) as PipPayload;
  } catch {
    return null;
  }
}

export function PipWindow() {
  return (
    <ThemeProvider>
      <FontSizeProvider>
        <PipRoot />
      </FontSizeProvider>
    </ThemeProvider>
  );
}

function PipRoot() {
  const win = useMemo(() => getCurrentWebviewWindow(), []);
  const initialData = useMemo(parsePayload, []);
  const [data, setData] = useState<PipPayload | null>(initialData);
  const [playSourceId, setPlaySourceId] = useState<string | null>(initialData?.playSourceId ?? null);
  const playerRef = useRef<MediaPlayerInstance>(null);
  const lastTimeEmitRef = useRef(0);
  const lastCloseEmitRef = useRef(0);

  const [overlayVisible, setOverlayVisible] = useState(false);
  const overlayDismissedRef = useRef(false);
  const reachedOutroRef = useRef(false);
  const [skipForwardVisible, setSkipForwardVisible] = useState(false);
  const skipDismissedRef = useRef(false);
  const skipEligibleRef = useRef((initialData?.currentTime ?? 0) < 5 * 60);
  const lastTimeRef = useRef(initialData?.currentTime ?? 0);

  useEffect(() => {
    let un: (() => void) | undefined;
    listen<PipPayload>('pip://episode', (e) => {
      setData(e.payload);
      setPlaySourceId(e.payload.playSourceId ?? null);
    }).then((f) => (un = f));
    listen('pip://close', () => void win.close()).then((f) => {
      const prev = un;
      un = () => {
        f();
        prev?.();
      };
    });
    return () => un?.();
  }, [win]);

  useEffect(() => {
    setOverlayVisible(false);
    overlayDismissedRef.current = false;
    reachedOutroRef.current = false;
    skipEligibleRef.current = (data?.currentTime ?? 0) < 5 * 60;
    setSkipForwardVisible(false);
    skipDismissedRef.current = false;
    lastTimeRef.current = data?.currentTime ?? 0;
  }, [data?.episodeId]);

  const readVideoTime = useCallback(() => {
    const video = playerRef.current?.el?.querySelector('video');
    return video ? { t: video.currentTime, d: video.duration || 0 } : { t: 0, d: 0 };
  }, []);

  const handleTimeUpdate = useCallback(
    (t: number, d: number) => {
      const now = Date.now();
      if (now - lastTimeEmitRef.current >= TIME_EMIT_MS) {
        lastTimeEmitRef.current = now;
        void emit('pip://time', { t, d });
      }
      const threshold = (data?.outroThresholdMinutes ?? 10) * 60;
      const reached = d > threshold && t > 0 && d - t <= threshold;
      reachedOutroRef.current = reached;
      const canShow =
        !overlayDismissedRef.current &&
        reached &&
        data?.showNextEpisodeOverlay !== false &&
        data?.nextEpisode != null;
      if (canShow) {
        setOverlayVisible(true);
        setSkipForwardVisible(false);
        skipDismissedRef.current = true;
      }
      // 主动向后拖动（currentTime 明显回落）：离开片尾隐藏下一集浮窗，并恢复快进浮窗可选性
      const backwardSeek = lastTimeRef.current - t >= 3;
      lastTimeRef.current = t;
      if (!reached) {
        setOverlayVisible(false);
      }
      if (backwardSeek) {
        skipDismissedRef.current = false;
        skipEligibleRef.current = t < 5 * 60;
      }
      if (t >= 5 * 60) {
        setSkipForwardVisible(false);
      } else if (
        skipEligibleRef.current &&
        !skipDismissedRef.current &&
        !skipForwardVisible &&
        t > 0
      ) {
        setSkipForwardVisible(true);
      }
    },
    [
      data?.outroThresholdMinutes,
      data?.showNextEpisodeOverlay,
      data?.nextEpisode,
      skipForwardVisible,
    ],
  );

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let un1: (() => void) | undefined;
    let un2: (() => void) | undefined;
    const send = async () => {
      try {
        const [pos, size, sf] = await Promise.all([
          win.outerPosition(),
          win.innerSize(),
          win.scaleFactor(),
        ]);
        void emit('pip://geometry', {
          x: pos.x / sf,
          y: pos.y / sf,
          w: size.width / sf,
          h: size.height / sf,
        });
      } catch {}
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(send, 400);
    };
    win.onMoved(schedule).then((f) => (un1 = f));
    win.onResized(schedule).then((f) => (un2 = f));
    return () => {
      if (timer) clearTimeout(timer);
      un1?.();
      un2?.();
    };
  }, [win]);

  // mac 元素全屏会创建原生全屏空间；pip 窗口若保持置顶，旧尺寸窗口会浮在全屏画面之上。
  // 进入元素全屏时临时取消置顶让窗口沉到全屏后面，退出时恢复。
  useEffect(() => {
    const onFsChange = () => {
      const fs = !!document.fullscreenElement;
      win.setAlwaysOnTop(!fs).catch((err) => console.error('[PipWindow] setAlwaysOnTop 失败:', err));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [win]);

  useEffect(() => {
    let un: (() => void) | undefined;
    (async () => {
      try {
        un = await win.onCloseRequested(async (event) => {
          event.preventDefault();
          if (Date.now() - lastCloseEmitRef.current >= 1000) {
            lastCloseEmitRef.current = Date.now();
            const { t, d } = readVideoTime();
            await emit('pip://closing', { t, d });
          }
          await win.destroy();
        });
      } catch {}
    })();
    return () => un?.();
  }, [win, readVideoTime]);

  const closePip = useCallback(async () => {
    lastCloseEmitRef.current = Date.now();
    const { t, d } = readVideoTime();
    await emit('pip://closing', { t, d });
    win.close();
  }, [readVideoTime, win]);

  const handleBack = useCallback(async () => {
    lastCloseEmitRef.current = Date.now();
    const { t, d } = readVideoTime();
    console.log('[pip] back: start');
    const dbg = (msg: string, extra?: unknown) => {
      console.warn('[PIPDEBUG]', msg, extra ?? '');
      void emit('pip://debug', { where: 'pip-back', msg, extra: extra ?? null });
    };
    // 先发 back 通知主窗口续播；不给 emit 无限 await（避免 emit 挂起导致窗口不销毁）
    const emitP = emit('pip://back', { t, d }).then(
      () => dbg('pip://back emit ok'),
      (err) => dbg('pip://back emit err', String(err)),
    );
    try {
      await Promise.race([emitP, new Promise((r) => setTimeout(r, 800))]);
    } catch { /* 忽略，无论如何都继续销毁 */ }
    dbg('destroy 前，label=' + win.label);
    try {
      await win.destroy();
      dbg('destroy ok');
    } catch (err) {
      dbg('destroy 抛错', String(err));
    }
    dbg('destroy 后（若还能执行到这，说明通道仍在）');
  }, [readVideoTime, win]);

  const handleNext = useCallback(() => {
    if (!data?.nextEpisode) return;
    void emit('pip://next', { episodeId: data.nextEpisode.id });
  }, [data?.nextEpisode]);

  const handleFullscreen = () => {
    const p = playerRef.current;
    if (!p) return;
    if (document.fullscreenElement) {
      p.exitFullscreen().catch(() => {});
    } else {
      p.enterFullscreen().catch(() => {});
    }
  };

  const onHeaderPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, select')) return;
    win.startDragging().catch((err) => console.error('[PipWindow] startDragging 失败:', err));
  };

  const onResizePointerDown =
    (dir: ResizeDir) => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      win
        .startResizeDragging(dir)
        .catch((err) => console.error('[PipWindow] startResizeDragging 失败:', err));
    };

  const handleSourceSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const src = data?.sources.find((s) => s.id === e.target.value);
    if (!src || !data) return;
    void emit('pip://source', { id: src.id, sourceId: src.sourceId });
  };

  const handleVolumeChange = useCallback(
    (v: number, m: boolean) => {
      void emit('pip://volume', { v, m });
    },
    [],
  );

  if (!data) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-black text-white/60">
        参数缺失，请从主窗口重新打开画中画
      </div>
    );
  }

  const nextEpisodeTitle = data.nextEpisode
    ? `下一集${data.nextEpisode.title ? ` · ${data.nextEpisode.title}` : ''}`
    : '';

  const headerCls =
    'flex items-center gap-1 bg-black/90 text-white/90 text-xs px-2 cursor-move touch-none';

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-black select-none">
      <div
        className={headerCls}
        style={{ height: HEADER_H }}
        onPointerDown={onHeaderPointerDown}
      >
        <div className="flex-1 min-w-0 truncate text-left px-1">
          {data.title ? `${data.title} · ${data.episodeLabel}` : data.episodeLabel}
        </div>
        <button
          type="button"
          onClick={handleBack}
          title="返回播放页"
          className="shrink-0 p-1 rounded hover:bg-white/10"
        >
          <ExternalLink className="size-3.5" />
        </button>
        {data.sources.length > 1 && (
          <select
            value={playSourceId ?? ''}
            onChange={handleSourceSelect}
            className="shrink-0 max-w-28 bg-black/60 text-white/90 text-xs rounded px-1 py-0.5 cursor-pointer outline-none"
            title="切换线路"
          >
            {data.sources.map((s, i) => (
              <option key={s.id} value={s.id}>
                {s.sourceName || `线路${i + 1}`}
                {s.quality ? ` · ${s.quality}` : ''}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={handleFullscreen}
          title="全屏"
          className="shrink-0 p-1 rounded hover:bg-white/10"
        >
          <Maximize2 className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={closePip}
          title="关闭画中画"
          className="shrink-0 p-1 rounded hover:bg-white/10"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="relative flex flex-1 min-h-0 items-center justify-center bg-black">
        <div
          className="max-h-full max-w-full"
          style={{ width: `min(100%, calc((100vh - ${HEADER_H}px) * 16 / 9))` }}
        >
          <VideoPlayer
            playerRef={playerRef}
            key={`${data.episodeId}:${data.playSourceId}`}
            keyTarget="document"
            onSpaceToggle={() => {
              const p = playerRef.current;
              if (p) (p.paused ? void p.play().catch(() => {}) : p.pause());
            }}
            sources={data.sources}
            initialSourceId={playSourceId ?? undefined}
            initialCurrentTime={data.currentTime}
            volume={data.volume}
            muted={data.muted}
            onTimeUpdate={handleTimeUpdate}
            onVolumeChange={handleVolumeChange}
            overlays={
              <PlayerOverlays
                nextEpisodeTitle={nextEpisodeTitle}
                overlayVisible={overlayVisible}
                onNext={handleNext}
                onClose={() => {
                  setOverlayVisible(false);
                  overlayDismissedRef.current = true;
                }}
                skipForwardVisible={skipForwardVisible}
                onSkipForward={(delta) => {
                  const video = playerRef.current?.el?.querySelector('video');
                  if (!video) return;
                  const target = Math.min(
                    video.currentTime + delta,
                    video.duration || video.currentTime + delta,
                  );
                  video.currentTime = target;
                }}
                onSkipForwardClose={() => {
                  setSkipForwardVisible(false);
                  skipDismissedRef.current = true;
                }}
              />
            }
          />
        </div>
      </div>

      {(
        [
          ['North', 'top-0 left-1 right-1 h-1 cursor-ns-resize'],
          ['South', 'bottom-0 left-1 right-1 h-1 cursor-ns-resize'],
          ['West', 'left-0 top-1 bottom-1 w-1 cursor-ew-resize'],
          ['East', 'right-0 top-1 bottom-1 w-1 cursor-ew-resize'],
          ['NorthWest', 'top-0 left-0 size-3 cursor-nwse-resize'],
          ['NorthEast', 'top-0 right-0 size-3 cursor-nesw-resize'],
          ['SouthWest', 'bottom-0 left-0 size-3 cursor-nesw-resize'],
          ['SouthEast', 'bottom-0 right-0 size-3 cursor-nwse-resize'],
        ] as const
      ).map(([dir, cls]) => (
        <div
          key={dir}
          className={`absolute z-30 touch-none ${cls}`}
          style={{ position: 'fixed' }}
          onPointerDown={onResizePointerDown(dir)}
        />
      ))}
    </div>
  );
}
