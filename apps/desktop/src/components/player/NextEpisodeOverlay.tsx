import { X } from 'lucide-react';

interface NextEpisodeOverlayProps {
  show: boolean;
  nextEpisodeTitle: string;
  onNext: () => void;
  onClose: () => void;
}

export function NextEpisodeOverlay({ show, nextEpisodeTitle, onNext, onClose }: NextEpisodeOverlayProps) {
  if (!show) return null;

  return (
    <div
      className="absolute top-2 right-2 z-30 bg-[var(--color-card-alpha)] backdrop-blur-sm rounded-md px-2.5 py-1.5 text-xs text-text-secondary flex items-center gap-2 pointer-events-auto"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="truncate max-w-32">{nextEpisodeTitle}</span>
      <button
        onClick={onNext}
        className="px-2 py-0.5 bg-muted-foreground/20 text-text rounded hover:bg-[var(--color-hover-alpha)] transition-colors shrink-0"
      >
        播放
      </button>
      <button
        onClick={onClose}
        className="p-0.5 text-text-secondary hover:text-text transition-colors shrink-0"
        aria-label="关闭"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
