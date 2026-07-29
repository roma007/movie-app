import { useEffect, type ReactNode } from 'react';
import { useThemeStore } from './store';
import type { ThemeColors } from './types';
import { hexToRgba } from './colorUtils';

interface ThemeProviderProps {
  children: ReactNode;
}

function applyTheme(colors: ThemeColors, cardOpacity: number): void {
  const root = document.documentElement;
  
  Object.entries(colors).forEach(([key, value]) => {
    const cssVarName = `--color-${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
    root.style.setProperty(cssVarName, value);
  });

  const opacity = cardOpacity / 100;
  root.style.setProperty('--color-card-alpha', hexToRgba(colors.card, opacity));
  root.style.setProperty('--color-surface-alpha', hexToRgba(colors.surface, opacity * 0.85));
  root.style.setProperty('--color-surface-elevated-alpha', hexToRgba(colors.surfaceElevated, opacity * 0.95));
  root.style.setProperty('--color-input-alpha', hexToRgba(colors.input, opacity * 0.9));
  root.style.setProperty('--color-secondary-alpha', hexToRgba(colors.secondary, opacity * 0.85));
  root.style.setProperty('--color-hover-alpha', hexToRgba(colors.hover, opacity));
  root.style.setProperty('--color-success-alpha', hexToRgba(colors.success, opacity));
  root.style.setProperty('--color-sidebar-alpha', hexToRgba(colors.sidebar, opacity * 0.9));
  root.style.setProperty('--color-popover-alpha', hexToRgba(colors.popover, opacity));
  root.style.setProperty('--color-primary-light', hexToRgba(colors.primary, opacity * 0.2));
  root.style.setProperty('--color-muted-alpha', hexToRgba(colors.mutedForeground, opacity * 0.2));
  root.style.setProperty('--color-destructive-alpha', hexToRgba(colors.destructive, opacity * 0.85));
}

function detectSystemScheme(): 'dark' | 'light' {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const themeConfig = useThemeStore((state) => state.getCurrentThemeConfig());
  const cardOpacity = useThemeStore((state) => state.cardOpacity);
  const setSystemColorScheme = useThemeStore((s) => s.setSystemColorScheme);

  useEffect(() => {
    applyTheme(themeConfig.colors, cardOpacity);
  }, [themeConfig, cardOpacity]);

  useEffect(() => {
    setSystemColorScheme(detectSystemScheme());
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setSystemColorScheme(e.matches ? 'dark' : 'light');
    };
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    } else {
      mql.addListener(handler);
      return () => mql.removeListener(handler);
    }
  }, [setSystemColorScheme]);

  return <>{children}</>;
}