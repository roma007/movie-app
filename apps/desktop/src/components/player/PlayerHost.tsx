import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { MediaPlayerInstance } from '@vidstack/react';
import { PictureInPicture2, Maximize2, ChevronsUpDown, ChevronsDownUp, X, ExternalLink } from 'lucide-react';
import { VideoPlayer } from './VideoPlayer';
import { usePlayerStore } from '../../stores/playerStore';

const HEADER_H = 36;
const COLLAPSED_W = 240;

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
  const closePlayback = usePlayerStore((s) => s.closePlayback);
  const handleSourceChange = usePlayerStore((s) => s.handleSourceChange);
  const handleTimeUpdate = usePlayerStore((s) => s.handleTimeUpdate);
  const handleSourceFail = usePlayerStore((s) => s.handleSourceFail);
  const switchEpisode = usePlayerStore((s) => s.switchEpisode);

  const { pathname } = useLocation();
  const navigate = useNavigate();

  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<MediaPlayerInstance>(null);
  const headerDrag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const resizeDrag = useRef<{ sx: number; sy: number; ow: number } | null>(null);

  useEffect(() => {
    initMiniPrefs();
  }, [initMiniPrefs]);

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

  if (!session) return null;

  const mode: 'full' | 'mini' = isPlayRoute ? 'full' : 'mini';

  const activeSources = session.sources.filter((s) => s.isActive !== false);
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

  const onResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    resizeDrag.current = { sx: e.clientX, sy: e.clientY, ow: miniSize.width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = resizeDrag.current;
    if (!d) return;
    setMiniSize({ width: d.ow + (e.clientX - d.sx) });
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
            nextEpisode={session.nextEpisode}
            outroThresholdMinutes={session.outroThresholdMinutes}
            showNextEpisodeOverlay={session.showNextEpisodeOverlay}
            onTimeUpdate={handleTimeUpdate}
            onNextEpisode={() => {
              const nextId = session.nextEpisode?.id;
              if (!nextId) return;
              if (isPlayRoute) {
                navigate(`/play/${nextId}`, { replace: true });
              } else {
                void switchEpisode(nextId);
              }
            }}
            onSourceChange={handleSourceChange}
            onSourceFail={handleSourceFail}
          />
        </div>
      )}

      {mode === 'mini' && !collapsed && (
        <div
          className="absolute bottom-0 right-0 w-5 h-5 z-30 cursor-nwse-resize touch-none"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
        >
          <div className="absolute bottom-0.5 right-0.5 w-2.5 h-2.5 pointer-events-none bg-white/30" style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }} />
        </div>
      )}
    </div>
  );
}
