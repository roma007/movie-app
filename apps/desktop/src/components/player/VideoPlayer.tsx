import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

interface VideoPlayerProps {
  url: string;
  /** 播放进度变化（秒） */
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  /** 加载/播放结束回调 */
  onEnded?: () => void;
}

/**
 * 桌面端视频播放器：hls.js + 原生 <video>。
 * - m3u8 / HLS 流：浏览器不支持原生 HLS 时用 hls.js；Safari 走原生
 * - 其他地址（mp4 等）：直接交给 <video>
 * 控制条用原生 controls（含缓冲进度与 当前时间/总时长 显示），保持实现简单。
 */
export function VideoPlayer({ url, onTimeUpdate, onEnded }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;

    setLoading(true);
    setError(null);

    const isHls = /\.m3u8(\?|$)/i.test(url) || url.toLowerCase().includes('m3u8');

    let cancelled = false;

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!cancelled) {
          setLoading(false);
          video.play().catch(() => {/* 自动播放可能被拦截，用户手动播放 */});
        }
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          setLoading(false);
          setError(`视频加载失败：${data.details}`);
        }
      });
    } else {
      // 原生（Safari 原生 HLS 或 mp4 等）
      video.src = url;
      setLoading(false);
    }

    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.removeAttribute('src');
      video.load();
    };
  }, [url]);

  return (
    <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-10">
          <div className="text-muted-foreground">加载中...</div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
          <div className="text-destructive">{error}</div>
        </div>
      )}
      <video
        ref={videoRef}
        className="w-full h-full"
        controls
        playsInline
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          onTimeUpdate?.(v.currentTime, v.duration || 0);
        }}
        onEnded={() => onEnded?.()}
      />
    </div>
  );
}
