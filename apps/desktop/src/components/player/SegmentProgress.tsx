import { useSyncExternalStore, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { prefetchManager, type SegmentProgressState } from './PrefetchManager';

interface SegmentProgressProps {
  open: boolean;
  onClose: () => void;
}

/** 最多显示的分片条数（预取水位内通常远小于此值）。 */
const MAX_BARS = 32;

function barWidth(duration: number): number {
  return Math.max(5, Math.min(22, duration * 2));
}

export function SegmentProgress({ open, onClose }: SegmentProgressProps) {
  const segments = useSyncExternalStore(
    prefetchManager.subscribe,
    prefetchManager.getSnapshot,
    prefetchManager.getSnapshot,
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const [alignBottom, setAlignBottom] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const player = wrapRef.current?.closest('[data-media-player]');
      const controls = player?.querySelector('.vds-controls');
      const groups = controls ? [...controls.querySelectorAll('.vds-controls-group')] : [];
      const lastGroup = groups[groups.length - 1] as HTMLElement | undefined;
      const rect = lastGroup?.getBoundingClientRect();
      const playerRect = player?.getBoundingClientRect();
      const wrapHeight = wrapRef.current?.offsetHeight ?? 0;
      const wrapRect = wrapRef.current?.getBoundingClientRect();
      const segCount = segments.length;
      console.error(
        '[Prefetch][SEG-DBG]',
        JSON.stringify({
          win: window.location.pathname,
          view: new URLSearchParams(window.location.search).get('view'),
          open,
          segCount,
          hasPlayer: !!player,
          hasControls: !!controls,
          groupCount: groups.length,
          group: rect ? { top: Math.round(rect.top), bottom: Math.round(rect.bottom) } : null,
          playerRect: playerRect ? { top: Math.round(playerRect.top), bottom: Math.round(playerRect.bottom), h: Math.round(playerRect.height) } : null,
          wrapH: Math.round(wrapHeight),
          wrapRect: wrapRect
            ? { top: Math.round(wrapRect.top), bottom: Math.round(wrapRect.bottom), offset: playerRect ? Math.round(playerRect.bottom - wrapRect.bottom) : null }
            : null,
          curAlignBottom: alignBottom,
        }),
      );
      if (rect && wrapHeight > 0 && playerRect) {
        const groupCenterY = (rect.top + rect.bottom) / 2;
        setAlignBottom(playerRect.bottom - groupCenterY - wrapHeight / 2);
      }
    };
    measure();
    const t = setInterval(measure, 500);
    return () => clearInterval(t);
  }, [open]);

  if (!open) return null;
  if (segments.length === 0) return null;

  const bars = segments.slice(0, MAX_BARS);
  const prefetchedSeconds = segments.reduce((acc, s) => acc + (s.departing ? 0 : s.duration), 0);

  return (
    <div
      ref={wrapRef}
      className="absolute left-1/2 -translate-x-1/2 z-30 pointer-events-none select-none"
      style={{ bottom: alignBottom ?? undefined }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 bg-black/70 backdrop-blur-sm rounded-lg px-2.5 py-1.5">
        {prefetchedSeconds > 0 && (
          <span className="text-[10px] text-white/60 shrink-0 mr-0.5 whitespace-nowrap">
            预读 {Math.round(prefetchedSeconds)}s
          </span>
        )}
        <div className="flex items-end gap-[3px]">
          {bars.map((seg) => (
            <SegmentBar key={seg.index} seg={seg} />
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭预读进度"
          className="pointer-events-auto shrink-0 ml-0.5 size-4 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/15 transition-colors"
        >
          <X className="size-3" />
        </button>
      </div>
    </div>
  );
}

function SegmentBar({ seg }: { seg: SegmentProgressState }) {
  const width = barWidth(seg.duration);
  const indeterminate = !seg.done && seg.progress === null;
  return (
    <div
      className={`seg-progress-wrap${seg.departing ? ' seg-progress-depart' : ''}`}
      style={{ width }}
    >
      <div
        className={`seg-progress-bar${seg.playing ? ' seg-progress-playing' : ''}${seg.error ? ' seg-progress-error' : ''}${indeterminate ? ' seg-progress-indeterminate' : ''}`}
      >
        {!indeterminate && seg.progress !== null && (
          <div className="seg-progress-fill" style={{ width: `${seg.progress * 100}%` }} />
        )}
      </div>
    </div>
  );
}
