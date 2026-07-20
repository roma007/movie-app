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
    <div className="absolute bottom-14 right-2 z-30 bg-black/60 rounded-md px-2.5 py-1.5 text-xs text-white/80 flex items-center gap-2 pointer-events-auto">
      <span className="truncate max-w-32">{nextEpisodeTitle}</span>
      <button
        onClick={onNext}
        className="px-2 py-0.5 bg-primary text-primary-foreground rounded hover:bg-primary-hover transition-colors shrink-0"
      >
        播放
      </button>
      <button
        onClick={onClose}
        className="p-0.5 text-white/60 hover:text-white transition-colors shrink-0"
        aria-label="关闭"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
