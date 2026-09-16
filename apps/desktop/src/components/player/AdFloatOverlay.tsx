import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { AdFloatItem } from '@movie-app/core';

interface AdFloatOverlayProps {
  ad: AdFloatItem;
  maxWidthRatio: number;
  onClose: () => void;
  onDismissed: () => void;
}

const DEFAULT_DURATION_MS = 5000;

/**
 * 播放中浮窗广告（桌面端）。
 * - 不打断播放：浮窗绝对定位叠加在播放器上方，仅自身可交互；
 * - 尺寸自适应：按广告素材宽高比缩放，宽度不超过播放器 maxWidthRatio；
 * - 展示时长：取 ad.durationMs，未配置则固定 5000ms，到时自动消失（onDismissed）。
 */
export function AdFloatOverlay({ ad, maxWidthRatio, onClose, onDismissed }: AdFloatOverlayProps) {
  const [pulse, setPulse] = useState(false);
  const onDismissedRef = useRef(onDismissed);
  onDismissedRef.current = onDismissed;

  useEffect(() => {
    const raf = requestAnimationFrame(() => setPulse(true));
    return () => cancelAnimationFrame(raf);
  }, [ad]);

  useEffect(() => {
    const duration = ad.durationMs ?? DEFAULT_DURATION_MS;
    const timer = setTimeout(() => {
      onDismissedRef.current();
    }, duration);
    return () => clearTimeout(timer);
  }, [ad]);

  if (!ad.width || !ad.height) return null;

  return (
    <div
      className="absolute right-2 z-40 group/ad"
      style={{
        top: '3.5rem',
        width: `min(${maxWidthRatio * 100}%, 360px)`,
        aspectRatio: `${ad.width} / ${ad.height}`,
        transition: 'opacity 0.25s ease, transform 0.25s ease',
        opacity: pulse ? 1 : 0,
        transform: pulse ? 'translateY(0)' : 'translateY(6px)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      <div
        className="relative h-full w-full overflow-hidden rounded-lg ring-1 ring-white/15 shadow-lg bg-gradient-to-br from-[#1e293b] to-[#0f172a] cursor-pointer"
        onClick={() => {
          if (ad.linkUrl) {
            try {
              window.open(ad.linkUrl, '_blank', 'noopener,noreferrer');
            } catch {
              /* 拦截也不影响浮窗 */
            }
          }
        }}
      >
        {ad.imageUrl ? (
          <img
            src={ad.imageUrl}
            alt={ad.title}
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="relative flex h-full w-full flex-col items-center justify-center gap-1 p-3">
            <svg className="absolute inset-0 h-full w-full opacity-25" preserveAspectRatio="none" viewBox="0 0 100 100">
              <defs>
                <linearGradient id={`adg-${String(ad.height).replace('-', '')}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" />
                  <stop offset="55%" stopColor="#ef4444" />
                  <stop offset="100%" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
              <rect width="100" height="100" fill={`url(#adg-${String(ad.height).replace('-', '')})`} />
            </svg>
            <div className="relative pointer-events-none text-center">
              <div className="text-sm font-bold text-white drop-shadow">{ad.title}</div>
              {ad.durationMs ? (
                <div className="mt-1 inline-block rounded px-1.5 py-0.5 bg-black/50 text-[10px] text-white/80">
                  展示 {Math.round(ad.durationMs / 1000)}s
                </div>
              ) : null}
            </div>
          </div>
        )}
        <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1 py-px text-[10px] leading-3 text-white/85">
          广告
        </span>
        <button
          type="button"
          aria-label="关闭广告"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="absolute right-1.5 top-1.5 rounded-full bg-black/50 p-0.5 text-white/80 hover:bg-black/75 hover:text-white transition-colors"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

export const AD_FLOAT_DEFAULT_DURATION_MS = DEFAULT_DURATION_MS;