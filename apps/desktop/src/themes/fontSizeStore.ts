import { create } from 'zustand';

export type FontSize = 'small' | 'normal' | 'large' | 'xlarge';

export interface FontSizeConfig {
  id: FontSize;
  label: string;
  size: string;
  scale: number;
}

export const fontSizes: Record<FontSize, FontSizeConfig> = {
  small: { id: 'small', label: '小', size: '18px', scale: 1.25 },
  normal: { id: 'normal', label: '默认', size: '20px', scale: 1.4 },
  large: { id: 'large', label: '大', size: '22px', scale: 1.55 },
  xlarge: { id: 'xlarge', label: '特大', size: '24px', scale: 1.7 },
};

export const FONT_SIZE_KEY = 'movie-app-font-size';
export const DEFAULT_FONT_SIZE: FontSize = 'normal';

interface FontSizeState {
  currentFontSize: FontSize;
  fontSizes: FontSizeConfig[];
  setFontSize: (size: FontSize) => void;
  getCurrentFontSizeConfig: () => FontSizeConfig;
}

function loadFontSizeFromStorage(): FontSize {
  try {
    const saved = localStorage.getItem(FONT_SIZE_KEY);
    if (saved && saved in fontSizes) {
      return saved as FontSize;
    }
  } catch {
    // ignore
  }
  return DEFAULT_FONT_SIZE;
}

function saveFontSizeToStorage(size: FontSize): void {
  try {
    localStorage.setItem(FONT_SIZE_KEY, size);
  } catch {
    // ignore
  }
}

export const useFontSizeStore = create<FontSizeState>((set, get) => ({
  currentFontSize: loadFontSizeFromStorage(),
  fontSizes: Object.values(fontSizes),

  setFontSize: (size) => {
    set({ currentFontSize: size });
    saveFontSizeToStorage(size);
  },

  getCurrentFontSizeConfig: () => {
    return fontSizes[get().currentFontSize];
  },
}));
