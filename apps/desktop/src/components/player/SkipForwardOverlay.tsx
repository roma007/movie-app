import { X } from 'lucide-react';

interface SkipForwardOverlayProps {
  show: boolean;
  onSkip: (delta: number) => void;
  onClose: () => void;
}

export function SkipForwardOverlay({ show, onSkip, onClose }: SkipForwardOverlayProps) {
  if (!show) return null;

  return (
    <div
      className="absolute top-2 right-2 z-30 bg-[var(--color-card-alpha)] backdrop-blur-sm rounded-md px-2.5 py-1.5 text-xs text-text-secondary flex items-center gap-1.5 pointer-events-auto"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="text-text">快进</span>
      <button
        onClick={() => onSkip(90)}
        className="px-2 py-0.5 bg-muted-foreground/20 text-text rounded hover:bg-[var(--color-hover-alpha)] transition-colors shrink-0"
      >
        1分半
      </button>
      <button
        onClick={() => onSkip(120)}
        className="px-2 py-0.5 bg-muted-foreground/20 text-text rounded hover:bg-[var(--color-hover-alpha)] transition-colors shrink-0"
      >
        2分钟
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
