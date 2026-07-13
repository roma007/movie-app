import { create } from 'zustand';
import { themes, DEFAULT_THEME, THEME_KEY } from './config';
import type { ThemeId, ThemeConfig } from './types';

interface ThemeState {
  currentTheme: ThemeId;
  themes: ThemeConfig[];
  setTheme: (themeId: ThemeId) => void;
  getCurrentThemeConfig: () => ThemeConfig;
}

function loadThemeFromStorage(): ThemeId {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved && saved in themes) {
      return saved as ThemeId;
    }
  } catch {
    // 忽略存储读取错误
  }
  return DEFAULT_THEME;
}

function saveThemeToStorage(themeId: ThemeId): void {
  try {
    localStorage.setItem(THEME_KEY, themeId);
  } catch {
    // 忽略存储写入错误
  }
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  currentTheme: loadThemeFromStorage(),
  themes: Object.values(themes),
  
  setTheme: (themeId) => {
    set({ currentTheme: themeId });
    saveThemeToStorage(themeId);
  },
  
  getCurrentThemeConfig: () => {
    return themes[get().currentTheme];
  },
}));