import { useEffect, useRef, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { CSSProperties } from 'react';
import type { MediaPlayerInstance } from '@vidstack/react';
import { register as registerGlobalShortcut, unregister as unregisterGlobalShortcut } from '@tauri-apps/plugin-global-shortcut';
import { getCurrentWebviewWindow, WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { currentMonitor } from '@tauri-apps/api/window';
import { emit, listen } from '@tauri-apps/api/event';
import { Loader2 } from 'lucide-react';
import { VideoPlayer } from './VideoPlayer';
import { PlayerOverlays } from './PlayerOverlays';
import { usePlayerStore, buildPipPayload, isPipSwitching } from '../../stores/playerStore';

const PIP_GEO_KEY = 'movie_app_pip_geo';

interface PipGeometry {
  x?: number;
  y?: number;
  w: number;
  h: number;
}

function readPipGeometry(): PipGeometry {
  let geo: PipGeometry = { w: 400, h: Math.round((400 * 9) / 16) + 36 };
  try {
    const raw = localStorage.getItem(PIP_GEO_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (Number.isFinite(p?.w) && p.w >= 200) geo.w = Math.round(p.w);
      if (Number.isFinite(p?.h) && p.h >= 150) geo.h = Math.round(p.h);
      if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) {
        geo.x = Math.round(p.x);
        geo.y = Math.round(p.y);
      }
    }
  } catch {}
  return geo;
}

export function PlayerHost() {
  const session = usePlayerStore((s) => s.session);
  const slotRect = usePlayerStore((s) => s.slotRect);
  const closePlayback = usePlayerStore((s) => s.closePlayback);
  const handleSourceChange = usePlayerStore((s) => s.handleSourceChange);
  const flushProgress = usePlayerStore((s) => s.flushProgress);
  const handleTimeUpdate = usePlayerStore((s) => s.handleTimeUpdate);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const pipActive = usePlayerStore((s) => s.pipActive);
  const setPipActive = usePlayerStore((s) => s.setPipActive);

  const { pathname } = useLocation();
  const navigate = useNavigate();

  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<MediaPlayerInstance>(null);

  const [overlayVisible, setOverlayVisible] = useState(false);
  const overlayDismissedRef = useRef(false);
  const reachedOutroRef = useRef(false);
  const [skipForwardVisible, setSkipForwardVisible] = useState(false);
  const skipDismissedRef = useRef(false);
  const skipEligibleRef = useRef(false);
  const lastTimeRef = useRef(0);

  useEffect(() => {
    setOverlayVisible(false);
    overlayDismissedRef.current = false;
    reachedOutroRef.current = false;
    skipEligibleRef.current = (session?.currentTime ?? 0) < 2 * 60;
    setSkipForwardVisible(false);
    skipDismissedRef.current = false;
    lastTimeRef.current = session?.currentTime ?? 0;
  }, [session?.episodeId, session?.playSourceId, session?.currentTime]);

  const handleBossKey = useCallback(async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      }
    } catch {}
    try {
      const pipWin = await WebviewWindow.getByLabel('pip');
      if (pipWin) await pipWin.close();
      void emit('pip://close', null);
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
        return;
      }
      if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        !target ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      )
        return;
      const p = playerRef.current;
      if (!p || pipActive) return;
      e.preventDefault();
      if (p.paused) void p.play().catch(() => {});
      else p.pause();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleBossKey, pipActive]);

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

  // mac 原生画中画窗口：双向事件同步（进度/音量/切集/返回/关闭）
  useEffect(() => {
    const unsubs: (() => void)[] = [];
    const on = <T,>(name: string, handler: (payload: T) => void) => {
      listen<T>(name, (e) => handler(e.payload)).then((f) => unsubs.push(f));
    };

    on<{ t: number; d: number }>('pip://time', ({ t, d }) => {
      usePlayerStore.getState().applyPipTime(t, d);
    });
    on<{ v: number; m: boolean }>('pip://volume', ({ v, m }) => {
      usePlayerStore.getState().setVolume(v, m);
    });
    on<{ id: string; sourceId: string | null }>('pip://source', async ({ id }) => {
      const st = usePlayerStore.getState();
      await st.switchLineWithResume(id);
      const s2 = usePlayerStore.getState().session;
      if (s2 && s2.episodeId) void emit('pip://episode', buildPipPayload(s2, s2.currentTime));
    });
    on<{ x: number; y: number; w: number; h: number }>('pip://geometry', (geo) => {
      try {
        localStorage.setItem(PIP_GEO_KEY, JSON.stringify(geo));
      } catch {}
    });
    // pip 内点「下一集」：经主窗口解析新集后回传，期间保持 pipActive
    on<{ episodeId: string }>('pip://next', async ({ episodeId }) => {
      const st = usePlayerStore.getState();
      await st.switchEpisodeKeepPip(episodeId);
    });
    // 主窗口侧发起新播放（非 pip 流程）时关闭 pip，避免双流
    unsubs.push(
      usePlayerStore.subscribe((s, prev) => {
        const sEp = s.session?.episodeId;
        const pEp = prev.session?.episodeId;
        const episodeChanged = !!sEp && !!pEp && sEp !== pEp;
        if (!isPipSwitching() && prev.pipActive && episodeChanged) {
          void WebviewWindow.getByLabel('pip').then((w) => w?.close().catch(() => {}));
        }
      }),
    );
    on<{ t: number; d: number }>('pip://back', ({ t, d }) => {
      const st = usePlayerStore.getState();
      console.log('[pip] main: back received', { t, d });
      console.warn('[PIPDEBUG] main: back received', { t, d });
      st.applyPipTime(t, d);
      st.setPipActive(false, { resumePlay: true });
      void st.flushProgress();
      // 兜底强制销毁画中画窗口：destroy 不触发 onCloseRequested 拦截，杜绝 pip 残留双流播放
      WebviewWindow.getByLabel('pip')
        .then((w) => {
          console.warn('[PIPDEBUG] main: getByLabel pip →', w ? 'found' : 'null');
          if (!w) return;
          return w.destroy().then(
            () => console.warn('[PIPDEBUG] main: getByLabel destroy ok'),
            (err) => console.warn('[PIPDEBUG] main: getByLabel destroy err', String(err)),
          );
        })
        .catch((err) => console.warn('[PIPDEBUG] main: getByLabel 查询失败', String(err)));
      if (st.session?.episodeId) navigate(`/play/${st.session.episodeId}`);
    });
    on<{ where: string; msg: string; extra: unknown }>('pip://debug', ({ where, msg, extra }) => {
      console.warn('[PIPDEBUG] from pip:', `${where}|${msg}`, extra ?? '');
    });
    on<{ t: number; d: number }>('pip://closing', ({ t, d }) => {
      const st = usePlayerStore.getState();
      st.applyPipTime(t, d);
      st.setPipActive(false);
      void st.flushProgress();
    });
    on<unknown>('tauri://destroyed', (payload) => {
      const label = (payload as { label?: string } | null)?.label;
      if (label && label !== 'pip') return;
      const st = usePlayerStore.getState();
      if (st.pipActive) st.setPipActive(false);
    });

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [navigate]);

  // 应用窗口关闭（含 Cmd+Q/关窗口）：先锁存播放进度，再真正关闭，保证退出即保存
  useEffect(() => {
    let un: (() => void) | undefined;
    let flushed = false;
    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        un = await win.onCloseRequested(async (event) => {
          if (flushed) return;
          event.preventDefault();
          try {
            const pipWin = await WebviewWindow.getByLabel('pip');
            if (pipWin) await pipWin.close();
            await usePlayerStore.getState().flushProgress();
          } catch (err) {
            console.error('[PlayerHost] 关闭前保存进度失败:', err);
          } finally {
            flushed = true;
            void win.close();
          }
        });
      } catch {}
    })();
    return () => un?.();
  }, [flushProgress]);

  // pip 激活期间主窗口始终不播（含切集后 VideoPlayer 重挂场景），杜绝双声道
  useEffect(() => {
    if (!pipActive) return;
    const video = playerRef.current?.el?.querySelector('video');
    if (video && !video.paused) video.pause();
  }, [pipActive, session?.episodeId]);

  // 画中画关闭后：主窗口视频回到最新进度；「返回播放页」路径自动续播
  useEffect(() => {
    if (pipActive) return;
    const video = playerRef.current?.el?.querySelector('video');
    if (!video) return;
    const st = usePlayerStore.getState();
    const t = st.session?.currentTime ?? 0;
    if (t > 0 && Math.abs(video.currentTime - t) > 0.5) {
      video.currentTime = Math.min(t, (video.duration || Infinity) - 0.5);
    }
    if (st.pipResumePlay) void video.play().catch(() => {});
    setPipActive(false);
  }, [pipActive, setPipActive]);

  const isPlayRoute = pathname.startsWith('/play/');

  useEffect(() => {
    if (session && !isPlayRoute && !pipActive) {
      void closePlayback();
    }
  }, [session, isPlayRoute, pipActive, closePlayback]);

  if (!session) return null;

  const activeSources = session.sources;
  const showPlayer = activeSources.length > 0;

  const style: CSSProperties = slotRect
    ? {
        position: 'fixed',
        left: slotRect.left,
        top: slotRect.top,
        width: slotRect.width,
        height: slotRect.height,
        zIndex: 40,
      }
    : { position: 'fixed', left: 0, top: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none', zIndex: 40 };

  const openNativePipWindow = async () => {
    if (!session || pipActive) return;
    const existing = await WebviewWindow.getByLabel('pip');
    if (existing) {
      existing.setFocus().catch(() => {});
      return;
    }
    const video = playerRef.current?.el?.querySelector('video');
    const currentTime = video ? video.currentTime : session.currentTime;
    if (video && !video.paused) video.pause();

    let maxWidth: number | undefined;
    let maxHeight: number | undefined;
    try {
      const mon = await currentMonitor();
      if (mon) {
        const dpr = window.devicePixelRatio || 1;
        maxWidth = Math.round(mon.size.width / dpr);
        maxHeight = Math.round(mon.size.height / dpr);
      }
    } catch {}
    const geo = readPipGeometry();
    if (maxWidth) geo.w = Math.min(geo.w, maxWidth);
    if (maxHeight) geo.h = Math.min(geo.h, maxHeight);

    setPipActive(true);
    const win = new WebviewWindow('pip', {
      url: `/?view=pip&d=${encodeURIComponent(JSON.stringify(buildPipPayload(session, currentTime)))}`,
      title: '画中画',
      decorations: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: true,
      maximizable: false,
      minimizable: false,
      skipTaskbar: true,
      hiddenTitle: true,
      width: geo.w,
      height: geo.h,
      minWidth: 200,
      minHeight: 150,
      ...(maxWidth ? { maxWidth, maxHeight } : {}),
      ...(geo.x !== undefined && geo.y !== undefined ? { x: geo.x, y: geo.y } : {}),
    });
    win.once('tauri://error', (e) => {
      console.error('[PlayerHost] 打开画中画窗口失败:', e);
      setPipActive(false);
    });
  };

  const handleNextEpisode = () => {
    const nextId = session.nextEpisode?.id;
    if (!nextId) return;
    navigate(`/play/${nextId}`, { replace: true });
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
    // 短片（时长 ≤ 预热阈值）在剩余 60s 内触发；长片沿用阈值窗口
    const outroWindow = duration <= threshold ? 60 : threshold;
    const reachedOutro = duration > 0 && currentTime > 0 && duration - currentTime <= outroWindow;
    reachedOutroRef.current = reachedOutro;
    const canShow =
      !overlayDismissedRef.current &&
      reachedOutro &&
      session.showNextEpisodeOverlay !== false &&
      session.nextEpisode != null;
    if (canShow) {
      setOverlayVisible(true);
      setSkipForwardVisible(false);
      skipDismissedRef.current = true;
    }
    // 主动向后拖动（currentTime 明显回落）：离开片尾隐藏下一集浮窗，并恢复快进浮窗可选性
    const backwardSeek = lastTimeRef.current - currentTime >= 3;
    lastTimeRef.current = currentTime;
    if (!reachedOutro) {
      setOverlayVisible(false);
    }
    if (backwardSeek) {
      skipDismissedRef.current = false;
      skipEligibleRef.current = currentTime < 2 * 60;
    }
    if (currentTime >= 2 * 60) {
      setSkipForwardVisible(false);
    } else if (
      skipEligibleRef.current &&
      !skipDismissedRef.current &&
      !skipForwardVisible &&
      currentTime > 0
    ) {
      setSkipForwardVisible(true);
    }
  };

  const nextEpisodeTitle = session.nextEpisode
    ? `下一集${session.nextEpisode.title ? ` · ${session.nextEpisode.title}` : ''}`
    : '';

  return (
    <div
      ref={containerRef}
      style={style}
      className="overflow-hidden rounded-lg shadow-2xl ring-1 ring-white/10 bg-black select-none"
    >
      {showPlayer && (
        <div className="relative bg-black">
          {pipActive && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black text-white/70 text-sm pointer-events-none">
              正在画中画窗口播放，关闭画中画后恢复此处控制
            </div>
          )}
          {session.loading && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black text-white/70 text-sm pointer-events-none">
              <Loader2 className="size-5 animate-spin mr-2" />
              正在加载...
            </div>
          )}
          <VideoPlayer
            playerRef={playerRef}
            keyTarget="document"
            autoPlay={!pipActive}
            onPipOpen={() => void openNativePipWindow()}
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
    </div>
  );
}
