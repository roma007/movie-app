import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
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
import { useThemeStore } from '../../themes/store';

/** 解码错误后的向前跳过量（秒）：越过无法解码的片段继续播放。 */
const SKIP_SECONDS = 30;
/** 「已跳过」提示展示时长（ms）。 */
const SKIP_NOTICE_MS = 4000;

interface VideoPlayerProps {
  sources: PlaySource[];
  initialSourceId?: string;
  initialCurrentTime?: number;
  volume?: number;
  muted?: boolean;
  playerRef?: React.Ref<MediaPlayerInstance>;
  keyTarget?: 'document' | 'player';
  overlays?: ReactNode;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onEnded?: () => void;
  onSourceChange?: (source: PlaySource) => void;
  onVolumeChange?: (volume: number, muted: boolean) => void;
}

export function VideoPlayer({
  sources,
  initialSourceId,
  initialCurrentTime,
  volume,
  muted,
  playerRef,
  keyTarget = 'document',
  overlays,
  onTimeUpdate,
  onEnded,
  onSourceChange,
  onVolumeChange,
}: VideoPlayerProps) {
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

  const activeSources = useMemo(() => sources, [sources]);
  const initialIndex = useMemo(
    () => (initialSourceId ? activeSources.findIndex((s) => s.id === initialSourceId) : 0),
    [activeSources, initialSourceId],
  );
  const [currentIndex, setCurrentIndex] = useState(initialIndex >= 0 ? initialIndex : 0);
  const [retryNonce, setRetryNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const [skipNotice, setSkipNotice] = useState<string | null>(null);
  const maxBufferSize = useThemeStore((s) => s.maxBufferSize);

  useEffect(() => {
    const newIndex = initialSourceId ? activeSources.findIndex((s) => s.id === initialSourceId) : 0;
    if (newIndex >= 0) {
      setCurrentIndex(newIndex);
    }
  }, [initialSourceId, activeSources]);

  const currentIndexRef = useRef(currentIndex);
  const activeSourcesRef = useRef(activeSources);
  const onSourceChangeRef = useRef(onSourceChange);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onEndedRef = useRef(onEnded);
  const initialSeekDoneRef = useRef(false);
  const hlsProviderRef = useRef<any>(null);
  const onVolumeChangeRef = useRef(onVolumeChange);
  const skipOnRetryRef = useRef(false);
  const skipSecondsRef = useRef(0);
  const failurePosRef = useRef(0);
  const lastFailPosRef = useRef(0);
  const lastFailTimeRef = useRef(0);
  const retryPendingRef = useRef(false);
  const skipNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (skipNoticeTimerRef.current) clearTimeout(skipNoticeTimerRef.current);
    };
  }, []);
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);
  useEffect(() => {
    activeSourcesRef.current = activeSources;
  }, [activeSources]);
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
    onVolumeChangeRef.current = onVolumeChange;
  }, [onVolumeChange]);

  useEffect(() => {
    currentTimeRef.current = 0;
    skipOnRetryRef.current = false;
    skipSecondsRef.current = 0;
    failurePosRef.current = 0;
    lastFailPosRef.current = 0;
    lastFailTimeRef.current = 0;
  }, [currentIndex, initialCurrentTime]);

  useEffect(() => {
    initialSeekDoneRef.current = false;
  }, [currentIndex, initialCurrentTime, retryNonce]);

  useEffect(() => {
    prefetchManager.reset();
    return () => prefetchManager.reset();
  }, [currentIndex, retryNonce]);

  useEffect(() => {
    const src = activeSources[currentIndex];
    if (src?.url) void invokePrewarm(src.url);
  }, [currentIndex, activeSources]);

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
      };
      videoEl.addEventListener('timeupdate', handler);
    }, 1000);
    return () => {
      clearTimeout(timer);
      if (videoEl && handler) {
        videoEl.removeEventListener('timeupdate', handler);
      }
    };
  }, [currentIndex, retryNonce]);

  const showSkipNotice = useCallback((seconds: number) => {
    setSkipNotice(`检测到解码异常，已自动跳过约 ${seconds} 秒继续播放`);
    if (skipNoticeTimerRef.current) clearTimeout(skipNoticeTimerRef.current);
    skipNoticeTimerRef.current = setTimeout(() => setSkipNotice(null), SKIP_NOTICE_MS);
  }, []);

  const handleSourceFail = useCallback((isDecode = false) => {
    const sourcesList = activeSourcesRef.current;
    const idx = currentIndexRef.current;
    const src = sourcesList[idx];
    if (!src || retryPendingRef.current) return;

    const pos = currentTimeRef.current;
    const now = Date.now();
    const nearLastFail = Math.abs(pos - lastFailPosRef.current) < 4;
    const recentFail = now - lastFailTimeRef.current < 15000;
    const clusterSkip = nearLastFail && recentFail;
    skipSecondsRef.current = isDecode ? SKIP_SECONDS : clusterSkip ? 15 : 0;
    if (clusterSkip) {
      console.error(`[VideoPlayer] 检测到坏区（连续 ${pos}s 附近失败），重建后跳过 15 秒`);
    }
    lastFailPosRef.current = pos;
    lastFailTimeRef.current = now;
    skipOnRetryRef.current = skipSecondsRef.current > 0;
    failurePosRef.current = pos;
    setLoading(true);
    console.error(
      `[VideoPlayer] 线路失败: index=${idx}, sourceId=${src.id}, sourceName=${src.sourceName}, url=${src.url}, isDecode=${isDecode}, pos=${currentTimeRef.current}s`,
    );
    console.error(
      `[VideoPlayer] 剩余线路: ${sourcesList.length - idx - 1}, 总线路数: ${sourcesList.length}`,
    );

    retryPendingRef.current = true;
    const nextIndex = idx + 1;
    if (nextIndex < sourcesList.length) {
      setTimeout(() => {
        setCurrentIndex(nextIndex);
      }, 1500);
    } else {
      console.error('[VideoPlayer] 所有线路均失败，2 秒后循环重试');
      setTimeout(() => {
        setCurrentIndex(0);
        setRetryNonce((n) => n + 1);
      }, 2000);
    }
  }, []);

  const handleProviderChange = useCallback(
    (provider: MediaProviderAdapter | null, _nativeEvent: MediaProviderChangeEvent) => {
      if (!isHLSProvider(provider)) return;
      provider.library = HLS;
      hlsProviderRef.current = provider;
      const cfg = {
        loader: TauriLoader as any,
        enableWorker: true,
        debug: false,
        maxBufferSize: maxBufferSize * 1000 * 1000,
        maxBufferLength: 60,
        maxMaxBufferLength: 300,
        maxBufferHole: 1.0,
        startFragPrefetch: true,
        testBandwidth: false,
        lowLatencyMode: false,
        backBufferLength: 90,
        preferManagedMediaSource: false,
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
              backoff: 'exponential' as const,
            },
            errorRetry: {
              maxNumRetry: 5,
              retryDelayMs: 1000,
              maxRetryDelayMs: 10000,
              backoff: 'exponential' as const,
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
              backoff: 'exponential' as const,
            },
            errorRetry: {
              maxNumRetry: 3,
              retryDelayMs: 1000,
              maxRetryDelayMs: 8000,
              backoff: 'exponential' as const,
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
              backoff: 'exponential' as const,
            },
            errorRetry: {
              maxNumRetry: 3,
              retryDelayMs: 1000,
              maxRetryDelayMs: 8000,
              backoff: 'exponential' as const,
            },
          },
        },
      };
      provider.config = cfg;
      provider.onInstance((hls) => {
        Object.assign(hls.config, cfg);
        console.error(
          `[VideoPlayer] HLS instance config: hls=${HLS.version} enableWorker=${hls.config.enableWorker} maxBufferHole=${hls.config.maxBufferHole} maxBufferLength=${hls.config.maxBufferLength} maxMaxBufferLength=${hls.config.maxMaxBufferLength} backBufferLength=${hls.config.backBufferLength} maxBufferSize=${hls.config.maxBufferSize} loader=${(hls.config.loader as any)?.name} fragPrefetch=${hls.config.startFragPrefetch} lowLatency=${hls.config.lowLatencyMode} preferManagedMediaSource=${hls.config.preferManagedMediaSource}`,
        );
      });
    },
    [maxBufferSize],
  );

  useEffect(() => {
    const src = activeSources[currentIndex];
    if (src) onSourceChangeRef.current?.(src);
  }, [currentIndex, activeSources]);

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
      <MediaPlayer
        key={`${currentIndex}:${retryNonce}`}
        ref={playerRef}
        src={src}
        autoPlay
        volume={volume}
        muted={muted}
        keyTarget={keyTarget}
        className="w-full h-full"
        onProviderChange={handleProviderChange}
        onVolumeChange={(event) => {
          onVolumeChangeRef.current?.(event.volume, event.muted);
        }}
        onLoadStart={() => {
          retryPendingRef.current = false;
          setLoading(true);
        }}
        onCanPlay={() => {
          setLoading(false);
          applyColorFilter();
          if (!initialSeekDoneRef.current) {
            const video = playerContainerRef.current?.querySelector('video');
            if (video) {
              let resume = currentTimeRef.current > 0 ? currentTimeRef.current : initialCurrentTime || 0;
              const skipSeconds = skipSecondsRef.current;
              if (skipSeconds > 0) {
                const from = failurePosRef.current > 0 ? failurePosRef.current : resume;
                resume = from + skipSeconds;
                skipSecondsRef.current = 0;
                skipOnRetryRef.current = false;
                const dur = video.duration || 0;
                if (dur > 0 && resume >= dur - 1) resume = dur - 1;
                if (resume > 0) {
                  video.currentTime = resume;
                  showSkipNotice(skipSeconds);
                }
              } else if (resume > 0) {
                video.currentTime = resume;
              }
              console.error(
                `[VideoPlayer] onCanPlay: ctRef=${currentTimeRef.current.toFixed(1)}, initCT=${initialCurrentTime}, skip=${skipSeconds}, failurePos=${failurePosRef.current.toFixed(1)}, resume=${resume.toFixed(1)}, videoCT_after=${video.currentTime.toFixed(1)}`,
              );
            }
            initialSeekDoneRef.current = true;
          }
        }}
        onHlsError={(data: any, _nativeEvent: any) => {
          const err = data?.error ?? data?.err;
          const frag = data?.frag;
          const hlsInst = hlsProviderRef.current?.instance;
          const ms = (hlsInst as any)?.bufferController?.mediaSource;
          const sb = ms?.sourceBuffers?.[0];
          const bf = sb?.buffered;
          const bfRanges = bf?.length ? Array.from({ length: bf.length }, (_v, i) => `${bf.start(i).toFixed(1)}-${bf.end(i).toFixed(1)}`).join(',') : '';
          console.error(
            `[VideoPlayer] HLS 错误: type=${data?.type}, fatal=${data?.fatal}, details=${JSON.stringify(data?.details)}` +
              `, errName=${err?.name}, errMsg=${JSON.stringify(err?.message)}` +
              `, frag.sn=${frag?.sn}, frag.cc=${frag?.cc}, frag.start=${frag?.start}, frag.duration=${frag?.duration}` +
              `, sbName=${data?.sourceBufferName}, ctx=${currentTimeRef.current}s` +
              `, msState=${ms?.readyState}, sbUpdating=${sb?.updating}, buffered=${bfRanges}`,
          );
          if (data?.fatal) {
            const isDecode = data?.type === 'mediaError' && data?.details === 'mediaDecodeError';
            console.error('[VideoPlayer] 致命错误，直接重建播放器实例');
            handleSourceFail(isDecode);
          }
        }}
        onError={(detail: any) => {
          const code = detail?.code ?? detail?.mediaError?.code;
          console.error(`[VideoPlayer] 原生 media error: code=${code}`);
          handleSourceFail(false);
        }}
        onEnded={() => onEndedRef.current?.()}
      >
        <MediaProvider />
        <DefaultVideoLayout
          icons={defaultLayoutIcons}
          colorScheme="dark"
          smallLayoutWhen={false}
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
        {overlays}
      </MediaPlayer>
      {loading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black text-muted-foreground">
          <Loader2 className="size-8 animate-spin mb-2" />
          <div>正在加载...（线路 {currentIndex + 1}/{activeSources.length}）</div>
        </div>
      )}
      {skipNotice && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-full bg-black text-white text-sm pointer-events-none whitespace-nowrap">
          {skipNotice}
        </div>
      )}
    </div>
  );
}
