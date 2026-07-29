import { useCallback } from 'react';
import { useThemeStore } from './store';

export function useScaledFontSize(): (baseSize: number) => number {
  const scale = useThemeStore((s) => s.fontSizeScale);
  return useCallback((baseSize: number) => Math.round(baseSize * scale), [scale]);
}
