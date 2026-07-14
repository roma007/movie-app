import { useEffect, type ReactNode } from 'react';
import { useFontSizeStore } from './fontSizeStore';

interface FontSizeProviderProps {
  children: ReactNode;
}

function applyFontSize(scale: number): void {
  const root = document.documentElement;
  root.style.setProperty('--font-scale', String(scale));
  root.style.fontSize = `${14 * scale}px`;
}

export function FontSizeProvider({ children }: FontSizeProviderProps) {
  const fontSizeConfig = useFontSizeStore((state) => state.getCurrentFontSizeConfig());

  useEffect(() => {
    applyFontSize(fontSizeConfig.scale);
  }, [fontSizeConfig]);

  return <>{children}</>;
}
