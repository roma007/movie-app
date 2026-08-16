import { useState } from 'react';
import { X } from 'lucide-react';
import { NextEpisodeOverlay } from './NextEpisodeOverlay';
import { SkipForwardOverlay } from './SkipForwardOverlay';

interface PlayerOverlaysProps {
  nextEpisodeTitle: string;
  overlayVisible: boolean;
  onNext: () => void;
  onClose: () => void;
  skipForwardVisible: boolean;
  onSkipForward: (delta: number) => void;
  onSkipForwardClose: () => void;
}

export function PlayerOverlays({
  nextEpisodeTitle,
  overlayVisible,
  onNext,
  onClose,
  skipForwardVisible,
  onSkipForward,
  onSkipForwardClose,
}: PlayerOverlaysProps) {
  const [shortcutsVisible, setShortcutsVisible] = useState(true);

  return (
    <>
      {shortcutsVisible && (
        <div
          className="absolute top-2 left-2 z-20 bg-[var(--color-card-alpha)] backdrop-blur-sm rounded-md px-2.5 py-1.5 text-xs text-text-secondary space-y-0.5 select-none pointer-events-auto"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="font-semibold text-text flex items-center gap-3 whitespace-nowrap">
            <span>快捷键</span>
            <span className="font-normal flex items-center gap-3">
              <span className="flex items-center">置顶 <kbd className="ml-1 text-text-secondary">i</kbd></span>
              <span className="flex items-center">老板键 <kbd className="ml-1 text-text-secondary">Ctrl + `</kbd></span>
              <span className="flex items-center">全屏 <kbd className="ml-1 text-text-secondary">f</kbd></span>
            </span>
            <button
              onClick={() => setShortcutsVisible(false)}
              className="ml-auto p-0.5 text-text-secondary hover:text-text transition-colors"
              aria-label="关闭快捷键提示"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}
      <SkipForwardOverlay
        show={skipForwardVisible}
        onSkip={onSkipForward}
        onClose={onSkipForwardClose}
      />
      <NextEpisodeOverlay
        show={overlayVisible}
        nextEpisodeTitle={nextEpisodeTitle}
        onNext={onNext}
        onClose={onClose}
      />
    </>
  );
}
