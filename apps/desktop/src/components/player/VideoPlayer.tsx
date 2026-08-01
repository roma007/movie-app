import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  MediaPlayer,
  MediaProvider,
  isHLSProvider,
  type MediaPlayerInstance,
  type MediaProviderAdapter,
  type MediaProviderChangeEvent,
} from '@vidstack/react';
import {
  DefaultVideoLayout,
  defaultLayoutIcons,
} from '@vidstack/react/player/layouts/default';
import HLS from 'hls.js';
import type { PlaySource } from '@movie-app/core';
import { TauriLoader } from './TauriLoader';
import { prefetchManager } from './PrefetchManager';
import { invokePrewarm } from './pooledFetch';
import { ZH_TRANSLATIONS } from './zhTranslations';
import { ColorControls } from './ColorControls';
import { NextEpisodeOverlay } from './NextEpisodeOverlay';
import { register as registerGlobalShortcut, unregister as unregisterGlobalShortcut } from '@tauri-apps/plugin-global-shortcut';
import { X } from 'lucide-react';
import { useThemeStore } from '../../themes/store';

interface VideoPlayerProps {
  sources: PlaySource[];
  initialSourceId?: string;
  initialCurrentTime?: number;
  playerRef?: React.Ref<MediaPlayerInstance>;
  keyTarget?: 'document' | 'player';
  nextEpisode?: { id: string; title?: string | null; episodeNumber: number } | null;
  outroThresholdMinutes?: number;
  showNextEpisodeOverlay?: boolean;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onEnded?: () => void;
  onNextEpisode?: () => void;
  onSourceChange?: (source: PlaySource) => void;
  onSourceFail?: (sourceId: string) => void;
}

export function VideoPlayer({
  sources,
  initialSourceId,
  initialCurrentTime,
  playerRef,
  keyTarget = 'document',
  nextEpisode: nextEpisodeProp,
  outroThresholdMinutes: outroThresholdMinutesProp,
  showNextEpisodeOverlay: showNextEpisodeOverlayProp,
  onTimeUpdate,
  onEnded,
  onNextEpisode: onNextEpisodeProp,
  onSourceChange,
  onSourceFail,
}: VideoPlayerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const overlayDismissedRef = useRef(false);

  const playerContainerRef = useRef<HTMLDivElement>(null);

  const [colorValues, setColorValues] = useState({
    brightness: 100,
    contrast: 100,
    saturation: 100,
    hue: 0,
  });

  const applyColorFilter = useCallback(() => {
    if (!playerContainerRef.current) return;
    const videoEl = playerContainerRef.current.querySelector('video');
    if (!videoEl) return;
    const filter = `brightness(${colorValues.brightness}%) contrast(${colorValues.contrast}%) saturate(${colorValues.saturation}%) hue-rotate(${colorValues.hue}deg)`;
    videoEl.style.filter = filter;
  }, [colorValues]);

  useEffect(() => {
    applyColorFilter();
  }, [applyColorFilter]);

  useEffect(() => {
    const timer = setTimeout(applyColorFilter, 800);
    return () => clearTimeout(timer);
  }, [applyColorFilter]);

  const activeSources = useMemo(() => sources.filter((s) => s.isActive !== false), [sources]);
  const initialIndex = useMemo(
    () => (initialSourceId ? activeSources.findIndex((s) => s.id === initialSourceId) : 0),
    [activeSources, initialSourceId],
  );
  const [currentIndex, setCurrentIndex] = useState(initialIndex >= 0 ? initialIndex : 0);
  const [shortcutsVisible, setShortcutsVisible] = useState(true);
  const maxBufferSize = useThemeStore((s) => s.maxBufferSize);

  useEffect(() => {
    const newIndex = initialSourceId ? activeSources.findIndex((s) => s.id === initialSourceId) : 0;
    if (newIndex >= 0) {
      setCurrentIndex(newIndex);
    }
  }, [initialSourceId, activeSources]);

  const currentIndexRef = useRef(currentIndex);
  const activeSourcesRef = useRef(activeSources);
  const onSourceFailRef = useRef(onSourceFail);
  const onSourceChangeRef = useRef(onSourceChange);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onEndedRef = useRef(onEnded);
  const initialSeekDoneRef = useRef(false);
  const hlsProviderRef = useRef<any>(null);
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);
  useEffect(() => {
    activeSourcesRef.current = activeSources;
  }, [activeSources]);
  useEffect(() => {
    onSourceFailRef.current = onSourceFail;
  }, [onSourceFail]);
  useEffect(() => {
    onSourceChangeRef.current = onSourceChange;
  }, [onSourceChange]);
  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    initialSeekDoneRef.current = false;
  }, [currentIndex, initialCurrentTime]);

  useEffect(() => {
    setOverlayVisible(false);
    overlayDismissedRef.current = false;
  }, [currentIndex]);

  useEffect(() => {
    prefetchManager.reset();
    return () => prefetchManager.reset();
  }, [currentIndex]);

  useEffect(() => {
    const src = activeSources[currentIndex];
    if (src?.url) void invokePrewarm(src.url);
  }, [currentIndex, activeSources]);

  const nextEpisodeRef = useRef(nextEpisodeProp);
  const outroThresholdMinutesRef = useRef(outroThresholdMinutesProp);
  const showNextEpisodeOverlayRef = useRef(showNextEpisodeOverlayProp);
  const onNextEpisodeRef = useRef(onNextEpisodeProp);

  useEffect(() => { nextEpisodeRef.current = nextEpisodeProp; }, [nextEpisodeProp]);
  useEffect(() => { outroThresholdMinutesRef.current = outroThresholdMinutesProp; }, [outroThresholdMinutesProp]);
  useEffect(() => { showNextEpisodeOverlayRef.current = showNextEpisodeOverlayProp; }, [showNextEpisodeOverlayProp]);
  useEffect(() => { onNextEpisodeRef.current = onNextEpisodeProp; }, [onNextEpisodeProp]);

  const currentTimeRef = useRef(0);

  useEffect(() => {
    const container = playerContainerRef.current;
    if (!container) return;
    let handler: (() => void) | null = null;
    let videoEl: HTMLVideoElement | null = null;
    const timer = setTimeout(() => {
      videoEl = container.querySelector('video');
      if (!videoEl) return;
      handler = () => {
        const ct = videoEl!.currentTime;
        const dur = videoEl!.duration || 0;
        currentTimeRef.current = ct;
        onTimeUpdateRef.current?.(ct, dur);
        const threshold = (outroThresholdMinutesRef.current ?? 10) * 60;
        const canShow =
          !overlayDismissedRef.current &&
          dur > threshold &&
          ct > 0 &&
          dur - ct <= threshold &&
          showNextEpisodeOverlayRef.current !== false &&
          nextEpisodeRef.current != null;
        setOverlayVisible(canShow);
      };
      videoEl.addEventListener('timeupdate', handler);
    }, 1000);
    return () => {
      clearTimeout(timer);
      if (videoEl && handler) {
        videoEl.removeEventListener('timeupdate', handler);
      }
    };
  }, [currentIndex]);

  const handleOverlayClose = useCallback(() => {
    setOverlayVisible(false);
    overlayDismissedRef.current = true;
  }, []);

  const handleSourceFail = useCallback(() => {
    const sourcesList = activeSourcesRef.current;
    const idx = currentIndexRef.current;
    const src = sourcesList[idx];
    if (!src) return;

    setLoading(false);
    console.error(
      `[VideoPlayer] 线路失败: index=${idx}, sourceId=${src.id}, sourceName=${src.sourceName}, url=${src.url}`,
    );
    console.error(
      `[VideoPlayer] 剩余线路: ${sourcesList.length - idx - 1}, 总线路数: ${sourcesList.length}`,
    );

    onSourceFailRef.current?.(src.id);

    const nextIndex = idx + 1;
    if (nextIndex < sourcesList.length) {
      setError(`线路 ${idx + 1} 失败，正在尝试线路 ${nextIndex + 1}...`);
      setTimeout(() => setCurrentIndex(nextIndex), 1500);
    } else {
      console.error('[VideoPlayer] 所有线路均失败');
      setError('所有线路均失败，请稍后重试');
    }
  }, []);

  const handleProviderChange = useCallback(
    (provider: MediaProviderAdapter | null, _nativeEvent: MediaProviderChangeEvent) => {
      if (!isHLSProvider(provider)) return;
      provider.library = HLS;
      hlsProviderRef.current = provider;
      provider.config = {
        loader: TauriLoader as any,
        enableWorker: false,
        debug: false,
        maxBufferSize: maxBufferSize * 1000 * 1000,
        maxBufferLength: 60,
        maxMaxBufferLength: 300,
        maxBufferHole: 0.5,
        startFragPrefetch: true,
        testBandwidth: false,
        lowLatencyMode: false,
        backBufferLength: 90,
        abrEwmaDefaultEstimate: 1000000,
        abrBandWidthFactor: 0.95,
        abrBandWidthUpFactor: 0.7,
        fragLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: 20000,
            maxLoadTimeMs: 120000,
            timeoutRetry: {
              maxNumRetry: 5,
              retryDelayMs: 1000,
              maxRetryDelayMs: 10000,
              backoff: 'exponential',
            },
            errorRetry: {
              maxNumRetry: 5,
              retryDelayMs: 1000,
              maxRetryDelayMs: 10000,
              backoff: 'exponential',
            },
          },
        },
        manifestLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: 10000,
            maxLoadTimeMs: 30000,
            timeoutRetry: {
              maxNumRetry: 3,
              retryDelayMs: 1000,
              maxRetryDelayMs: 8000,
              backoff: 'exponential',
            },
            errorRetry: {
              maxNumRetry: 3,
              retryDelayMs: 1000,
              maxRetryDelayMs: 8000,
              backoff: 'exponential',
            },
          },
        },
        playlistLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: 10000,
            maxLoadTimeMs: 30000,
            timeoutRetry: {
              maxNumRetry: 3,
              retryDelayMs: 1000,
              maxRetryDelayMs: 8000,
              backoff: 'exponential',
            },
            errorRetry: {
              maxNumRetry: 3,
              retryDelayMs: 1000,
              maxRetryDelayMs: 8000,
              backoff: 'exponential',
            },
          },
        },
      };
      console.log('[VideoPlayer] HLS provider ready, TauriLoader injected');
    },
    [maxBufferSize],
  );

  useEffect(() => {
    const src = activeSources[currentIndex];
    if (src) onSourceChangeRef.current?.(src);
  }, [currentIndex, activeSources]);

  const handleBossKey = useCallback(async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      }
    } catch {}
    const video = playerContainerRef.current?.querySelector('video');
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
        handleBossKey();
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
            handleBossKey();
          }
        });
      } catch {}
    })();
    return () => {
      cancelled = true;
      unregisterGlobalShortcut('Control+`').catch(() => {});
    };
  }, [handleBossKey]);

  const handleRetry = () => {
    setError(null);
    setCurrentIndex(0);
    setLoading(true);
  };

  if (activeSources.length === 0) {
    return (
      <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-muted-foreground">
          暂无可用播放源
        </div>
      </div>
    );
  }

  const currentSource = activeSources[currentIndex];
  const src = currentSource?.url ?? '';

  return (
    <div ref={playerContainerRef} className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
      {shortcutsVisible && (
        <div className="absolute top-2 left-2 z-20 bg-[var(--color-card-alpha)] backdrop-blur-sm rounded-md px-2.5 py-1.5 text-xs text-text-secondary space-y-0.5 select-none">
          <div className="font-semibold text-text mb-0.5 flex items-center justify-between">
            <span>快捷键</span>
            <button
              onClick={() => setShortcutsVisible(false)}
              className="p-0.5 text-text-secondary hover:text-text transition-colors"
              aria-label="关闭快捷键提示"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <div>置顶 <kbd className="ml-1 text-text-secondary">i</kbd></div>
          <div>老板键 <kbd className="ml-1 text-text-secondary">Ctrl + `</kbd></div>
          <div>全屏 <kbd className="ml-1 text-text-secondary">f</kbd></div>
        </div>
      )}


      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-card-alpha)] backdrop-blur-sm z-10">
          <div className="text-text-secondary">
            加载中...（线路 {currentIndex + 1}/{activeSources.length}）
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-card-alpha)] backdrop-blur-sm z-10 p-4">
          <div className="text-destructive mb-4">{error}</div>
          {activeSources.length > 0 && (
            <button
              onClick={handleRetry}
              className="px-6 py-2 bg-muted-foreground/20 text-text rounded-lg hover:bg-[var(--color-hover-alpha)] transition-colors"
            >
              重试
            </button>
          )}
        </div>
      )}
      <MediaPlayer
        ref={playerRef}
        src={src}
        autoPlay
        keyTarget={keyTarget}
        className="w-full h-full"
        onProviderChange={handleProviderChange}
        onLoadStart={() => {
          if (currentSource) setLoading(true);
        }}
        onCanPlay={() => {
          setLoading(false);
          setError(null);
          applyColorFilter();
          if (initialCurrentTime && initialCurrentTime > 0 && !initialSeekDoneRef.current) {
            const video = playerContainerRef.current?.querySelector('video');
            if (video) {
              video.currentTime = initialCurrentTime;
            }
            initialSeekDoneRef.current = true;
          }
        }}
        onHlsManifestParsed={() => {
          setLoading(false);
          setError(null);
        }}
        onHlsError={(data: any, _nativeEvent: any) => {
          console.error(
            `[VideoPlayer] HLS 错误: type=${data?.type}, fatal=${data?.fatal}, details=${JSON.stringify(data?.details)}`,
          );
          if (data?.fatal) handleSourceFail();
        }}
        onError={() => handleSourceFail()}
        onEnded={() => onEndedRef.current?.()}
      >
        <MediaProvider />
        <DefaultVideoLayout
          icons={defaultLayoutIcons}
          colorScheme="dark"
          translations={ZH_TRANSLATIONS}
          slots={{
            settingsMenuItemsStart: (
              <ColorControls
                brightness={colorValues.brightness}
                contrast={colorValues.contrast}
                saturation={colorValues.saturation}
                hue={colorValues.hue}
                onChange={setColorValues}
              />
            ),
          }}
        />
      </MediaPlayer>
      <NextEpisodeOverlay
        show={overlayVisible}
        nextEpisodeTitle={nextEpisodeRef.current ? `下一集${nextEpisodeRef.current.title ? ` · ${nextEpisodeRef.current.title}` : ''}` : ''}
        onNext={() => onNextEpisodeRef.current?.()}
        onClose={handleOverlayClose}
      />
    </div>
  );
}
