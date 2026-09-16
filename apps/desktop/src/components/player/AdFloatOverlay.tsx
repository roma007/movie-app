import { useEffect, useRef, useState } from 'react';
import type { AdFloatItem } from '@movie-app/core';

interface AdBannerProps {
  ad: AdFloatItem;
  /** 到时自动滑出回调。 */
  onDismissed: () => void;
}

const DEFAULT_DURATION_MS = 5000;
const BANNER_HEIGHT = 52;

/**
 * 播放中顶部横幅广告（桌面端）。
 * - 不打断播放：横幅绝对定位在播放器顶部，仅自身可交互；
 * - 全宽横条，高度固定，从顶部滑入，到时自动滑出；
 * - 展示时长：取 ad.durationMs，未配置则固定 5000ms，到时自动滑出（onDismissed）。
 */
export function AdFloatOverlay({ ad, onDismissed }: AdBannerProps) {
  const [visible, setVisible] = useState(false);
  const onDismissedRef = useRef(onDismissed);
  onDismissedRef.current = onDismissed;

  useEffect(() => {
    setVisible(false);
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [ad]);

  useEffect(() => {
    const duration = ad.durationMs ?? DEFAULT_DURATION_MS;
    const timer = setTimeout(() => {
      onDismissedRef.current();
    }, duration);
    return () => clearTimeout(timer);
  }, [ad]);

  return (
    <div
      className="absolute left-0 right-0 z-40"
      style={{
        top: 0,
        height: BANNER_HEIGHT,
        transform: visible ? 'translateY(0)' : 'translateY(-100%)',
        transition: 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
        pointerEvents: visible ? 'auto' : 'none',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      <div
        className="relative h-full w-full overflow-hidden bg-gradient-to-r from-[#1e293b] to-[#0f172a] ring-1 ring-white/10 shadow-lg flex items-center cursor-pointer"
        onClick={() => {
          if (ad.linkUrl) {
            try {
              window.open(ad.linkUrl, '_blank', 'noopener,noreferrer');
            } catch {
              /* 拦截也不影响横幅 */
            }
          }
        }}
      >
        {ad.imageUrl ? (
          <img src={ad.imageUrl} alt={ad.title} className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="relative flex w-full items-center justify-center gap-2 px-4">
            <span className="truncate text-sm font-bold text-white drop-shadow">{ad.title}</span>
            {ad.durationMs ? (
              <span className="shrink-0 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white/80">
                展示 {Math.round(ad.durationMs / 1000)}s
              </span>
            ) : null}
          </div>
        )}
        <span className="absolute left-2 top-1.5 rounded bg-black/60 px-1 py-px text-[10px] leading-3 text-white/85">
          广告
        </span>
      </div>
    </div>
  );
}

export const AD_FLOAT_DEFAULT_DURATION_MS = DEFAULT_DURATION_MS;