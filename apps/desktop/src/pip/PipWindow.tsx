import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { MediaPlayerInstance } from '@vidstack/react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import { ExternalLink, Maximize2, X } from 'lucide-react';
import type { PlaySource } from '@movie-app/core';
import { VideoPlayer } from '../components/player/VideoPlayer';
import { PlayerOverlays } from '../components/player/PlayerOverlays';
import { ThemeProvider } from '../themes/ThemeProvider';
import { FontSizeProvider } from '../themes/FontSizeProvider';
import type { PipAnim } from '../stores/playerStore';
import { readPipPayload } from './pipWindowManager';

const HEADER_H = 36;
const TIME_EMIT_MS = 5000;
const BOOT_FRAME_KEY = 'movie-app-pip-boot-frame';
const APPEAR_ANIM_MS = 350;
const IS_MAC = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');

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
  anim?: PipAnim;
  openSeq?: number;
}

/** 读取主窗口写入的弹出过渡帧（读后即删，避免残留）。 */
function readBootFrame(): string | null {
  try {
    const v = localStorage.getItem(BOOT_FRAME_KEY);
    if (v) localStorage.removeItem(BOOT_FRAME_KEY);
    return v;
  } catch {
    return null;
  }
}

/** 主屏幕逻辑高度（macOS 左上→左下坐标换算用）。 */
async function primaryScreenHeight(): Promise<number> {
  try {
    const { availableMonitors } = await import('@tauri-apps/api/window');
    const mons = await availableMonitors();
    const primary = mons.find((m) => m.position.x === 0 && m.position.y === 0) ?? mons[0];
    if (primary) return primary.size.height / primary.scaleFactor;
  } catch {}
  return window.screen.availHeight || 900;
}

const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);

/** pip 弹出动画统一入口：mac 走原生 NSAnimationContext，Windows 走 rAF 逐帧插值。 */
async function runPipAppearAnimation(
  win: ReturnType<typeof getCurrentWebviewWindow>,
  from: PipAnim['from'],
  to: PipAnim['to'],
): Promise<void> {
  if (IS_MAC) {
    const screenH = await primaryScreenHeight();
    await invoke('animate_pip_appear', {
      from: [from.x, from.y, from.w, from.h],
      to: [to.x, to.y, to.w, to.h],
      screenH,
      durationMs: APPEAR_ANIM_MS,
    });
    return;
  }
  const start = performance.now();
  for (;;) {
    const t = Math.min(1, (performance.now() - start) / APPEAR_ANIM_MS);
    const e = easeOutCubic(t);
    void win.setPosition(
      new LogicalPosition(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e),
    );
    void win.setSize(new LogicalSize(from.w + (to.w - from.w) * e, from.h + (to.h - from.h) * e));
    if (t >= 1) break;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
  await win.setPosition(new LogicalPosition(to.x, to.y));
  await win.setSize(new LogicalSize(to.w, to.h));
}

type ResizeDir = 'North' | 'South' | 'East' | 'West' | 'NorthEast' | 'NorthWest' | 'SouthEast' | 'SouthWest';

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
  const initialData = useMemo(() => readPipPayload<PipPayload>(), []);
  const [data, setData] = useState<PipPayload | null>(initialData);
  const [playSourceId, setPlaySourceId] = useState<string | null>(initialData?.playSourceId ?? null);
  const playerRef = useRef<MediaPlayerInstance>(null);
  const lastTimeEmitRef = useRef(0);
  const lastNextEmitRef = useRef<{ id: string; at: number }>({ id: '', at: 0 });
  const lastCloseEmitRef = useRef(0);

  // 弹出过渡帧：动画期间盖住正在加载的播放器，就绪后淡出
  const [bootFrame, setBootFrame] = useState<string | null>(() => readBootFrame());
  const [frameFading, setFrameFading] = useState(false);
  const hideFrameRef = useRef(false);
  const animStartedRef = useRef(false);
  const lastSeqRef = useRef(0);

  const [overlayVisible, setOverlayVisible] = useState(false);
  const overlayDismissedRef = useRef(false);
  const reachedOutroRef = useRef(false);
  const [skipForwardVisible, setSkipForwardVisible] = useState(false);
  const skipDismissedRef = useRef(false);
  const skipEligibleRef = useRef((initialData?.currentTime ?? 0) < 2 * 60);
  const lastTimeRef = useRef(initialData?.currentTime ?? 0);

  useEffect(() => {
    // 原生层给 pip 窗口套大圆角 + 贴合阴影（消除无边框窗口的矩形边界亮线）。
    invoke('style_pip_window').catch((err) => {
      console.error('[PipWindow] style_pip_window 失败:', err);
    });
  }, []);

  const hideBootFrame = useCallback(() => {
    if (hideFrameRef.current || !bootFrame) return;
    hideFrameRef.current = true;
    setFrameFading(true);
    window.setTimeout(() => setBootFrame(null), 350);
  }, [bootFrame]);

  // 弹出动画：帧图加载/解码完成后飞（mac 原生 NSAnimationContext / win rAF），失败跳位兜底。
  useEffect(() => {
    const anim = data?.anim;
    if (!anim || !bootFrame || animStartedRef.current) return;
    let hard: ReturnType<typeof setTimeout> | null = null;
    const start = () => {
      if (animStartedRef.current) return;
      animStartedRef.current = true;
      if (hard) window.clearTimeout(hard);
      void (async () => {
        try {
          await runPipAppearAnimation(win, anim.from, anim.to);
        } catch (err) {
          console.error('[PipWindow] 弹出动画失败，直接跳到目标位置:', err);
          try {
            await win.setPosition(new LogicalPosition(anim.to.x, anim.to.y));
            await win.setSize(new LogicalSize(anim.to.w, anim.to.h));
          } catch {}
        }
      })();
    };
    const img = new Image();
    img.onload = start;
    img.onerror = start;
    img.src = bootFrame;
    hard = window.setTimeout(start, 800);
    return () => {
      img.onload = null;
      img.onerror = null;
      if (hard) window.clearTimeout(hard);
    };
  }, [win, data?.anim, bootFrame]);

  // 过渡帧淡出：播放器就绪且已到目标时间附近即撤帧；12s 硬兜底防卡住。
  useEffect(() => {
    if (!bootFrame) return;
    const want = data?.currentTime ?? 0;
    const iv = window.setInterval(() => {
      if (hideFrameRef.current) return;
      const video = playerRef.current?.el?.querySelector('video');
      if (video && video.readyState >= 2 && video.currentTime >= want - 0.5) hideBootFrame();
    }, 250);
    const hard = window.setTimeout(() => hideBootFrame(), 12000);
    return () => {
      window.clearInterval(iv);
      window.clearTimeout(hard);
    };
  }, [bootFrame, data?.currentTime, hideBootFrame]);

  // 应用一次「打开画中画」：重置开场状态 → 读新过渡帧 → 显示窗口 → 由动画 effect 驱动飞出。
  const applyOpen = useCallback(
    (payload: PipPayload) => {
      if (payload.openSeq !== undefined && lastSeqRef.current === payload.openSeq) return;
      if (payload.openSeq !== undefined) lastSeqRef.current = payload.openSeq;
      hideFrameRef.current = false;
      animStartedRef.current = false;
      setFrameFading(false);
      setPlaySourceId(payload.playSourceId ?? null);
      skipEligibleRef.current = (payload.currentTime ?? 0) < 2 * 60;
      lastTimeRef.current = payload.currentTime ?? 0;
      const frame = readBootFrame();
      setBootFrame(frame);
      const a = payload.anim;
      if (!frame && a) {
        void win.setPosition(new LogicalPosition(a.to.x, a.to.y));
        void win.setSize(new LogicalSize(a.to.w, a.to.h));
      }
      setData(payload);
      void win.show().catch(() => {});
      void win.setFocus().catch(() => {});
      window.setTimeout(() => {
        void win
          .isVisible()
          .then((v) => {
            if (!v) void invoke('show_pip').catch(() => {});
          })
          .catch(() => {});
      }, 700);
    },
    [win],
  );

  // 关闭画中画：卸载播放器停流 + 隐藏常驻窗口（不销毁，供下次复用）。
  const hidePip = useCallback(() => {
    hideFrameRef.current = false;
    animStartedRef.current = false;
    setFrameFading(false);
    setBootFrame(null);
    setPlaySourceId(null);
    setData(null);
    void win.hide().catch(() => {});
  }, [win]);

  // 常驻窗口挂载即读到的兜底 payload（仅当监听未就绪时主窗口才依赖此路径）。
  useEffect(() => {
    if (initialData) applyOpen(initialData);
  }, [initialData, applyOpen]);

  useEffect(() => {
    let un: (() => void) | undefined;
    listen<PipPayload>('pip://open', (e) => applyOpen(e.payload)).then((f) => (un = f));
    listen<PipPayload>('pip://episode', (e) => {
      setData(e.payload);
      setPlaySourceId(e.payload.playSourceId ?? null);
    }).then((f) => {
      const prev = un;
      un = () => {
        f();
        prev?.();
      };
    });
    listen('pip://close', () => {
      const video = playerRef.current?.el?.querySelector('video');
      const { t, d } = video ? { t: video.currentTime, d: video.duration || 0 } : { t: 0, d: 0 };
      lastCloseEmitRef.current = Date.now();
      void emit('pip://closing', { t, d });
      hidePip();
    }).then((f) => {
      const prev = un;
      un = () => {
        f();
        prev?.();
      };
    });
    return () => un?.();
  }, [win, applyOpen, hidePip]);

  useEffect(() => {
    setOverlayVisible(false);
    overlayDismissedRef.current = false;
    reachedOutroRef.current = false;
    skipEligibleRef.current = (data?.currentTime ?? 0) < 2 * 60;
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
      // 短片（时长 ≤ 预热阈值）在剩余 60s 内触发；长片沿用阈值窗口
      const outroWindow = d <= threshold ? 60 : threshold;
      const reached = d > 0 && t > 0 && d - t <= outroWindow;
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
        skipEligibleRef.current = t < 2 * 60;
      }
      if (t >= 2 * 60) {
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
          hidePip();
        });
      } catch {}
    })();
    return () => un?.();
  }, [win, readVideoTime, hidePip]);

  const closePip = useCallback(() => {
    lastCloseEmitRef.current = Date.now();
    const { t, d } = readVideoTime();
    void emit('pip://closing', { t, d });
    hidePip();
  }, [readVideoTime, hidePip]);

  const handleBack = useCallback(() => {
    lastCloseEmitRef.current = Date.now();
    const { t, d } = readVideoTime();
    const emitP = emit('pip://back', { t, d }).then(
      () => {},
      (err) => console.error('[PipWindow] back emit err:', err),
    );
    void Promise.race([emitP, new Promise((r) => setTimeout(r, 800))]).finally(() => hidePip());
  }, [readVideoTime, hidePip]);

  const handleNext = useCallback(() => {
    if (!data?.nextEpisode) return;
    const now = Date.now();
    const target = data.nextEpisode.id;
    if (lastNextEmitRef.current.id === target && now - lastNextEmitRef.current.at < 1000) {
      return;
    }
    lastNextEmitRef.current = { id: target, at: now };
    void emit('pip://next', { episodeId: target });
  }, [data?.nextEpisode, data?.episodeId]);

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
    return <div className="h-screen w-screen bg-black" />;
  }

  const nextEpisodeTitle = data.nextEpisode
    ? `下一集${data.nextEpisode.title ? ` · ${data.nextEpisode.title}` : ''}`
    : '';

  const headerCls =
    'flex items-center gap-1 bg-black/90 text-white/90 text-xs px-2 cursor-move touch-none';

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-black select-none">
      {bootFrame && (
        <img
          src={bootFrame}
          alt=""
          draggable={false}
          className={`pointer-events-none absolute inset-0 z-50 h-full w-full object-contain bg-black transition-opacity duration-300 ${
            frameFading ? 'opacity-0' : 'opacity-100'
          }`}
        />
      )}
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
