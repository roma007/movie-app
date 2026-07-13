import { useEffect, type ReactNode } from 'react';
import { useThemeStore } from './store';
import type { ThemeColors } from './types';

interface ThemeProviderProps {
  children: ReactNode;
}

function applyTheme(colors: ThemeColors): void {
  const root = document.documentElement;
  
  Object.entries(colors).forEach(([key, value]) => {
    const cssVarName = `--color-${key}`;
    root.style.setProperty(cssVarName, value);
  });
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const themeConfig = useThemeStore((state) => state.getCurrentThemeConfig());

  useEffect(() => {
    applyTheme(themeConfig.colors);
  }, [themeConfig]);

  return <>{children}</>;
}