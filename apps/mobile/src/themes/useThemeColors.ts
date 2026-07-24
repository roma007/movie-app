import { useMemo } from 'react';
import { useThemeStore } from './store';
import { themes } from './config';
import type { ThemeColors } from './types';

export function useThemeColors(): ThemeColors {
  const currentTheme = useThemeStore((s) => s.currentTheme);
  return useMemo(() => themes[currentTheme].colors, [currentTheme]);
}
