import { useEffect, useState } from 'react';
import { useThemeStore } from '../themes/store';
import { useBackgroundStore, DEFAULT_BG_IMAGE } from '../themes/backgroundStore';

const OVERLAY_RGB: Record<'dark' | 'light', [number, number, number]> = {
  dark: [0, 0, 0],
  light: [255, 255, 255],
};

const FADE_DURATION_MS = 300;

const loadedBgUrls = new Set<string>();

export function BackgroundLayer() {
  const bgImageBlur = useThemeStore((s) => s.bgImageBlur);
  const bgImageScale = useThemeStore((s) => s.bgImageScale);
  const blurIntensity = useThemeStore((s) => s.blurIntensity);
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const currentTheme = useThemeStore((s) => s.currentTheme);
  const dynamicBg = useBackgroundStore((s) => s.currentBgImage);

  const [displayedBg, setDisplayedBg] = useState<string | null>(null);
  const [bgOpacity, setBgOpacity] = useState(1);

  useEffect(() => {
    document.body.classList.toggle('bg-image-active', Boolean(dynamicBg));
  }, [dynamicBg]);

  useEffect(() => {
    if (!dynamicBg) {
      setDisplayedBg(null);
      setBgOpacity(1);
      return;
    }
    if (loadedBgUrls.has(dynamicBg)) {
      setDisplayedBg(dynamicBg);
      setBgOpacity(1);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      loadedBgUrls.add(dynamicBg);
      setDisplayedBg(dynamicBg);
      setBgOpacity(0);
      requestAnimationFrame(() => {
        if (!cancelled) setBgOpacity(1);
      });
    };
    img.src = dynamicBg;
    return () => {
      cancelled = true;
      img.src = '';
    };
  }, [dynamicBg]);

  const scaleValue = bgImageScale;

  return (
    <div
      className="fixed inset-0 pointer-events-none overflow-hidden -z-10"
      aria-hidden="true"
    >
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: `url(${DEFAULT_BG_IMAGE})`,
          filter: `blur(${bgImageBlur}px)`,
          transform: `scale(${scaleValue})`,
        }}
      />
      {displayedBg && (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url(${displayedBg})`,
            filter: `blur(${bgImageBlur}px)`,
            transform: `scale(${scaleValue})`,
            opacity: bgOpacity,
            transition: `opacity ${FADE_DURATION_MS}ms ease`,
          }}
        />
      )}
      {blurIntensity > 0 && (
        <div
          className="absolute inset-0"
          style={{
            backdropFilter: `blur(${blurIntensity * 0.2}px)`,
            WebkitBackdropFilter: `blur(${blurIntensity * 0.2}px)`,
          }}
        />
      )}
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: `rgba(${OVERLAY_RGB[currentTheme].join(', ')}, ${cardOpacity / 100})`,
        }}
      />
    </div>
  );
}
