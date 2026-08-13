import { useEffect, useRef, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { MediaPlayerInstance } from '@vidstack/react';
import { register as registerGlobalShortcut, unregister as unregisterGlobalShortcut } from '@tauri-apps/plugin-global-shortcut';
import { PictureInPicture2, Maximize2, ChevronsUpDown, ChevronsDownUp, X, ExternalLink } from 'lucide-react';
import { VideoPlayer } from './VideoPlayer';
import { PlayerOverlays } from './PlayerOverlays';
import { usePlayerStore } from '../../stores/playerStore';

const HEADER_H = 36;
const COLLAPSED_W = 240;
const RESIZE_MIN_W = 240;
const RESIZE_MIN_H = 160;

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface ResizeDrag {
  sx: number;
  sy: number;
  ow: number;
  oh: number;
  ox: number;
  oy: number;
  dir: ResizeDir;
  anchored: boolean;
}

export function PlayerHost() {
  const session = usePlayerStore((s) => s.session);
  const slotRect = usePlayerStore((s) => s.slotRect);
  const miniPos = usePlayerStore((s) => s.miniPos);
  const miniSize = usePlayerStore((s) => s.miniSize);
  const collapsed = usePlayerStore((s) => s.collapsed);
  const setMiniPos = usePlayerStore((s) => s.setMiniPos);
  const setMiniSize = usePlayerStore((s) => s.setMiniSize);
  const setCollapsed = usePlayerStore((s) => s.setCollapsed);
  const initMiniPrefs = usePlayerStore((s) => s.initMiniPrefs);
  const miniPlayerEnabled = usePlayerStore((s) => s.miniPlayerEnabled);
  const loadMiniPlayerPref = usePlayerStore((s) => s.loadMiniPlayerPref);
  const closePlayback = usePlayerStore((s) => s.closePlayback);
  const handleSourceChange = usePlayerStore((s) => s.handleSourceChange);
  const handleTimeUpdate = usePlayerStore((s) => s.handleTimeUpdate);
  const switchEpisode = usePlayerStore((s) => s.switchEpisode);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const setVolume = usePlayerStore((s) => s.setVolume);

  const { pathname } = useLocation();
  const navigate = useNavigate();

  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<MediaPlayerInstance>(null);
  const headerDrag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const resizeDrag = useRef<ResizeDrag | null>(null);

  const [overlayVisible, setOverlayVisible] = useState(false);
  const overlayDismissedRef = useRef(false);
  const reachedOutroRef = useRef(false);
  const [skipForwardVisible, setSkipForwardVisible] = useState(false);
  const skipDismissedRef = useRef(false);
  const startedFromBeginningRef = useRef(false);
  const skipTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setOverlayVisible(false);
    overlayDismissedRef.current = false;
    reachedOutroRef.current = false;
    startedFromBeginningRef.current = (session?.currentTime ?? 0) === 0;
    setSkipForwardVisible(false);
    skipDismissedRef.current = false;
    if (skipTimerRef.current !== null) {
      window.clearTimeout(skipTimerRef.current);
      skipTimerRef.current = null;
    }
  }, [session?.episodeId, session?.playSourceId, session?.currentTime]);

  useEffect(() => {
    return () => {
      if (skipTimerRef.current !== null) {
        window.clearTimeout(skipTimerRef.current);
        skipTimerRef.current = null;
      }
    };
  }, []);

  const handleBossKey = useCallback(async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      }
    } catch {}
    const video = playerRef.current?.el?.querySelector('video');
    if (video) {
      video.pause();
      video.muted = true;
    }
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().minimize();
    } catch {}
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        void handleBossKey();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleBossKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await registerGlobalShortcut('Control+`', (event) => {
          if (event.state === 'Pressed' && !cancelled) {
            void handleBossKey();
          }
        });
      } catch {}
    })();
    return () => {
      cancelled = true;
      unregisterGlobalShortcut('Control+`').catch(() => {});
    };
  }, [handleBossKey]);

  useEffect(() => {
    initMiniPrefs();
  }, [initMiniPrefs]);

  useEffect(() => {
    void loadMiniPlayerPref();
  }, [loadMiniPlayerPref]);

  useEffect(() => {
    if (miniPos) {
      try {
        localStorage.setItem('movie_app_mini_pos', JSON.stringify(miniPos));
      } catch {}
    }
  }, [miniPos]);

  useEffect(() => {
    try {
      localStorage.setItem('movie_app_mini_size', JSON.stringify(miniSize));
    } catch {}
  }, [miniSize]);

  const isPlayRoute = pathname.startsWith('/play/');

  useEffect(() => {
    if (isPlayRoute && collapsed) setCollapsed(false);
  }, [isPlayRoute, collapsed, setCollapsed]);

  useEffect(() => {
    if (session && !isPlayRoute && (!miniPlayerEnabled || reachedOutroRef.current)) {
      void closePlayback();
    }
  }, [session, isPlayRoute, miniPlayerEnabled, closePlayback]);

  if (!session) return null;

  const mode: 'full' | 'mini' = isPlayRoute ? 'full' : 'mini';

  if (mode === 'mini' && (!miniPlayerEnabled || reachedOutroRef.current)) return null;

  const activeSources = session.sources;
  const showPlayer = activeSources.length > 0 || !session.loading;
  const canPiP = typeof document !== 'undefined' && !!document.pictureInPictureEnabled;

  const title = session.media?.title ?? '';
  const episodeLabel = session.episode ? session.episode.title || `第${session.episode.episodeNumber}集` : '';

  let style: CSSProperties;
  if (mode === 'full') {
    style = slotRect
      ? {
          position: 'fixed',
          left: slotRect.left,
          top: slotRect.top,
          width: slotRect.width,
          height: slotRect.height,
          zIndex: 40,
        }
      : { position: 'fixed', left: 0, top: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none', zIndex: 40 };
  } else {
    const w = collapsed ? COLLAPSED_W : miniSize.width;
    const h = collapsed ? HEADER_H : miniSize.height;
    const x = miniPos?.x ?? Math.max(0, window.innerWidth - w - 16);
    const y = miniPos?.y ?? Math.max(0, window.innerHeight - h - 16);
    style = { position: 'fixed', left: x, top: y, width: w, height: h, zIndex: 70 };
  }

  const handleBack = () => {
    if (session.episodeId) navigate(`/play/${session.episodeId}`);
  };

  const handleClose = () => {
    void closePlayback();
  };

  const handleFullscreen = () => {
    const p = playerRef.current;
    if (!p) return;
    if (document.fullscreenElement) {
      p.exitFullscreen().catch(() => {});
    } else {
      p.enterFullscreen().catch(() => {});
    }
  };

  const handlePiP = () => {
    const p = playerRef.current;
    if (!p) return;
    if (document.pictureInPictureElement) {
      p.exitPictureInPicture().catch(() => {});
    } else {
      p.enterPictureInPicture().catch(() => {});
    }
  };

  const onHeaderPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (mode !== 'mini') return;
    if ((e.target as HTMLElement).closest('button, select')) return;
    headerDrag.current = { sx: e.clientX, sy: e.clientY, ox: miniPos?.x ?? 0, oy: miniPos?.y ?? 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHeaderPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = headerDrag.current;
    if (!d) return;
    const w = collapsed ? COLLAPSED_W : miniSize.width;
    const h = collapsed ? HEADER_H : miniSize.height;
    const x = Math.min(Math.max(0, d.ox + e.clientX - d.sx), Math.max(0, window.innerWidth - w));
    const y = Math.min(Math.max(0, d.oy + e.clientY - d.sy), Math.max(0, window.innerHeight - h));
    setMiniPos({ x, y });
  };
  const onHeaderPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    headerDrag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const onResizePointerDown =
    (dir: ResizeDir) => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      const ow = miniSize.width;
      const oh = miniSize.height;
      const anchored = miniPos === null;
      const ox = anchored ? Math.max(0, window.innerWidth - ow - 16) : (miniPos?.x ?? 0);
      const oy = anchored ? Math.max(0, window.innerHeight - oh - 16) : (miniPos?.y ?? 0);
      resizeDrag.current = { sx: e.clientX, sy: e.clientY, ow, oh, ox, oy, dir, anchored };
      e.currentTarget.setPointerCapture(e.pointerId);
    };
  const onResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = resizeDrag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    const east = d.dir.includes('e');
    const west = d.dir.includes('w');
    const south = d.dir.includes('s');
    const north = d.dir.includes('n');

    let w = d.ow;
    let h = d.oh;
    if (east) w = d.ow + dx;
    if (west) w = d.ow - dx;
    if (south) h = d.oh + dy;
    if (north) h = d.oh - dy;

    const maxW0 = Math.max(RESIZE_MIN_W, Math.floor(window.innerWidth));
    const maxH0 = Math.max(RESIZE_MIN_H, Math.floor(window.innerHeight));
    if (east) {
      const max = d.anchored
        ? maxW0
        : Math.max(RESIZE_MIN_W, Math.min(maxW0, window.innerWidth - 16 - d.ox));
      w = Math.min(Math.max(w, RESIZE_MIN_W), max);
    } else if (west) {
      w = Math.min(Math.max(w, RESIZE_MIN_W), Math.max(RESIZE_MIN_W, Math.min(maxW0, d.ox + d.ow)));
    }
    if (south) {
      const max = d.anchored
        ? maxH0
        : Math.max(RESIZE_MIN_H, Math.min(maxH0, window.innerHeight - 16 - d.oy));
      h = Math.min(Math.max(h, RESIZE_MIN_H), max);
    } else if (north) {
      h = Math.min(Math.max(h, RESIZE_MIN_H), Math.max(RESIZE_MIN_H, Math.min(maxH0, d.oy + d.oh)));
    }

    setMiniSize({ width: Math.round(w), height: Math.round(h) });
    if (!d.anchored) {
      let x = d.ox;
      let y = d.oy;
      if (west) x = d.ox + (d.ow - w);
      if (north) y = d.oy + (d.oh - h);
      setMiniPos({ x: Math.round(x), y: Math.round(y) });
    }
  };
  const onResizePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    resizeDrag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const handleSourceSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const src = session.sources.find((s) => s.id === e.target.value);
    if (src) handleSourceChange(src);
  };

  const handleNextEpisode = () => {
    const nextId = session.nextEpisode?.id;
    if (!nextId) return;
    if (isPlayRoute) {
      navigate(`/play/${nextId}`, { replace: true });
    } else {
      void switchEpisode(nextId);
    }
  };

  const handleOverlayClose = () => {
    setOverlayVisible(false);
    overlayDismissedRef.current = true;
  };

  const handleSkipForward = (delta: number) => {
    const video = playerRef.current?.el?.querySelector('video');
    if (!video) return;
    const target = Math.min(video.currentTime + delta, video.duration || video.currentTime + delta);
    video.currentTime = target;
  };

  const handleSkipForwardClose = () => {
    setSkipForwardVisible(false);
    skipDismissedRef.current = true;
  };

  const handlePlayerTimeUpdate = (currentTime: number, duration: number) => {
    handleTimeUpdate(currentTime, duration);
    const threshold = (session.outroThresholdMinutes ?? 10) * 60;
    const reachedOutro = duration > threshold && currentTime > 0 && duration - currentTime <= threshold;
    reachedOutroRef.current = reachedOutro;
    const canShow =
      !overlayDismissedRef.current &&
      reachedOutro &&
      session.showNextEpisodeOverlay !== false &&
      session.nextEpisode != null;
    if (canShow) {
      setOverlayVisible(true);
      setSkipForwardVisible(false);
      if (skipTimerRef.current !== null) {
        window.clearTimeout(skipTimerRef.current);
        skipTimerRef.current = null;
      }
    }
    if (
      startedFromBeginningRef.current &&
      !skipDismissedRef.current &&
      !skipForwardVisible &&
      currentTime > 0
    ) {
      setSkipForwardVisible(true);
      if (skipTimerRef.current === null) {
        skipTimerRef.current = window.setTimeout(() => {
          setSkipForwardVisible(false);
          skipTimerRef.current = null;
        }, 5 * 60 * 1000);
      }
    }
  };

  const nextEpisodeTitle = session.nextEpisode
    ? `下一集${session.nextEpisode.title ? ` · ${session.nextEpisode.title}` : ''}`
    : '';

  const headerCls =
    'flex items-center gap-1 bg-black/90 text-white/90 text-xs px-2 h-9 cursor-move touch-none';

  return (
    <div
      ref={containerRef}
      style={style}
      className="overflow-hidden rounded-lg shadow-2xl ring-1 ring-white/10 bg-black select-none"
    >
      <div
        className={headerCls}
        style={{ display: mode === 'full' ? 'none' : 'flex' }}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
      >
        {collapsed ? (
          <>
            <button
              type="button"
              onClick={() => {
                const p = playerRef.current;
                if (p) (p.paused ? p.play() : p.pause());
              }}
              title="播放/暂停"
              className="shrink-0 p-1 rounded hover:bg-white/10"
            >
              <ChevronsUpDown className="size-3.5" />
            </button>
            <div className="flex-1 min-w-0 truncate text-left px-1">
              {title ? `${title} · ${episodeLabel}` : episodeLabel}
            </div>
            <button
              type="button"
              onClick={handleBack}
              title="返回播放页"
              className="shrink-0 p-1 rounded hover:bg-white/10"
            >
              <ExternalLink className="size-3.5" />
            </button>
            <button type="button" onClick={() => setCollapsed(false)} title="展开" className="shrink-0 p-1 rounded hover:bg-white/10">
              <ChevronsUpDown className="size-3.5" />
            </button>
            <button type="button" onClick={handleClose} title="关闭小窗" className="shrink-0 p-1 rounded hover:bg-white/10">
              <X className="size-3.5" />
            </button>
          </>
        ) : (
          <>
            <div className="flex-1 min-w-0 truncate text-left px-1">
              {title ? `${title} · ${episodeLabel}` : episodeLabel}
            </div>
            <button
              type="button"
              onClick={handleBack}
              title="返回播放页"
              className="shrink-0 p-1 rounded hover:bg-white/10"
            >
              <ExternalLink className="size-3.5" />
            </button>
            {activeSources.length > 1 && (
              <select
                value={session.playSourceId ?? ''}
                onChange={handleSourceSelect}
                className="shrink-0 max-w-28 bg-black/60 text-white/90 text-xs rounded px-1 py-0.5 cursor-pointer outline-none"
                title="切换线路"
              >
                {activeSources.map((s, i) => (
                  <option key={s.id} value={s.id}>
                    {s.sourceName || `线路${i + 1}`}
                    {s.quality ? ` · ${s.quality}` : ''}
                  </option>
                ))}
              </select>
            )}
            <button type="button" onClick={() => setCollapsed(true)} title="收起为迷你条" className="shrink-0 p-1 rounded hover:bg-white/10">
              <ChevronsDownUp className="size-3.5" />
            </button>
            <button type="button" onClick={handleFullscreen} title="全屏" className="shrink-0 p-1 rounded hover:bg-white/10">
              <Maximize2 className="size-3.5" />
            </button>
            {canPiP && (
              <button type="button" onClick={handlePiP} title="画中画" className="shrink-0 p-1 rounded hover:bg-white/10">
                <PictureInPicture2 className="size-3.5" />
              </button>
            )}
            <button type="button" onClick={handleClose} title="关闭小窗" className="shrink-0 p-1 rounded hover:bg-white/10">
              <X className="size-3.5" />
            </button>
          </>
        )}
      </div>

      {showPlayer && (
        <div
          className="relative bg-black"
          style={{
            display: collapsed ? 'none' : undefined,
            height: mode === 'full' ? '100%' : miniSize.height - HEADER_H,
          }}
        >
          <VideoPlayer
            playerRef={playerRef}
            keyTarget={mode === 'full' ? 'document' : 'player'}
            sources={session.sources}
            initialSourceId={session.playSourceId ?? undefined}
            initialCurrentTime={session.currentTime}
            volume={volume}
            muted={muted}
            onVolumeChange={setVolume}
            onTimeUpdate={handlePlayerTimeUpdate}
            onSourceChange={handleSourceChange}
            overlays={
              <PlayerOverlays
                nextEpisodeTitle={nextEpisodeTitle}
                overlayVisible={overlayVisible}
                onNext={handleNextEpisode}
                onClose={handleOverlayClose}
                skipForwardVisible={skipForwardVisible}
                onSkipForward={handleSkipForward}
                onSkipForwardClose={handleSkipForwardClose}
              />
            }
          />
        </div>
      )}

      {mode === 'mini' && !collapsed && (
        <>
          <div
            className="absolute top-0 left-1 right-1 h-1 z-30 cursor-ns-resize touch-none"
            onPointerDown={onResizePointerDown('n')}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
          />
          <div
            className="absolute bottom-0 left-1 right-1 h-1 z-30 cursor-ns-resize touch-none"
            onPointerDown={onResizePointerDown('s')}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
          />
          <div
            className="absolute left-0 top-1 bottom-1 w-1 z-30 cursor-ew-resize touch-none"
            onPointerDown={onResizePointerDown('w')}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
          />
          <div
            className="absolute right-0 top-1 bottom-1 w-1 z-30 cursor-ew-resize touch-none"
            onPointerDown={onResizePointerDown('e')}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
          />
          <div
            className="absolute top-0 left-0 size-3 z-30 cursor-nwse-resize touch-none"
            onPointerDown={onResizePointerDown('nw')}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
          >
            <div className="absolute top-0.5 left-0.5 w-2 h-2 pointer-events-none bg-white/30" style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }} />
          </div>
          <div
            className="absolute top-0 right-0 size-3 z-30 cursor-nesw-resize touch-none"
            onPointerDown={onResizePointerDown('ne')}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
          >
            <div className="absolute top-0.5 right-0.5 w-2 h-2 pointer-events-none bg-white/30" style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 0)' }} />
          </div>
          <div
            className="absolute bottom-0 left-0 size-3 z-30 cursor-nesw-resize touch-none"
            onPointerDown={onResizePointerDown('sw')}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
          >
            <div className="absolute bottom-0.5 left-0.5 w-2 h-2 pointer-events-none bg-white/30" style={{ clipPath: 'polygon(0 100%, 100% 100%, 0 0)' }} />
          </div>
          <div
            className="absolute bottom-0 right-0 size-3 z-30 cursor-nwse-resize touch-none"
            onPointerDown={onResizePointerDown('se')}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
          >
            <div className="absolute bottom-0.5 right-0.5 w-2 h-2 pointer-events-none bg-white/30" style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }} />
          </div>
        </>
      )}
    </div>
  );
}
