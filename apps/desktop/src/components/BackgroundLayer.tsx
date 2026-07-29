import { useEffect } from 'react';
import { useThemeStore } from '../themes/store';
import { useBackgroundStore, DEFAULT_BG_IMAGE } from '../themes/backgroundStore';

export function BackgroundLayer() {
  const bgImageBlur = useThemeStore((s) => s.bgImageBlur);
  const bgImageScale = useThemeStore((s) => s.bgImageScale);
  const blurIntensity = useThemeStore((s) => s.blurIntensity);
  const dynamicBg = useBackgroundStore((s) => s.currentBgImage);

  const effectiveBg = dynamicBg || DEFAULT_BG_IMAGE;

  useEffect(() => {
    if (dynamicBg) {
      document.body.classList.add('bg-image-active');
    } else {
      document.body.classList.remove('bg-image-active');
    }
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
          backgroundImage: `url(${effectiveBg})`,
          filter: `blur(${bgImageBlur}px)`,
          transform: `scale(${scaleValue})`,
        }}
      />
      {blurIntensity > 0 && (
        <div
          className="absolute inset-0"
          style={{
            backdropFilter: `blur(${blurIntensity * 0.2}px)`,
            WebkitBackdropFilter: `blur(${blurIntensity * 0.2}px)`,
          }}
        />
      )}
    </div>
  );
}
