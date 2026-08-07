import { create } from 'zustand';
import { themes, DEFAULT_THEME, THEME_KEY } from './config';
import type { ThemeId, ThemeConfig, ColorMode } from './types';

const COLOR_MODE_KEY = 'movie-app-color-mode';
const CARD_OPACITY_KEY = 'movie-app-card-opacity';
const BLUR_KEY = 'movie-app-blur-intensity';
const BG_IMAGE_BLUR_KEY = 'movie-app-bg-image-blur';
const BG_IMAGE_SCALE_KEY = 'movie-app-bg-image-scale';
const MAX_BUFFER_SIZE_KEY = 'movie-app-max-buffer-size';

const DEFAULT_COLOR_MODE: ColorMode = 'system';
const DEFAULT_CARD_OPACITY = 40;
const DEFAULT_BLUR = 50;
const DEFAULT_BG_IMAGE_BLUR = 40;
const DEFAULT_BG_IMAGE_SCALE = 2;
const DEFAULT_MAX_BUFFER_SIZE = 120;

function loadColorModeFromStorage(): ColorMode {
  try {
    const saved = localStorage.getItem(COLOR_MODE_KEY);
    if (saved === 'system' || saved === 'dark' || saved === 'light') return saved;
  } catch {}
  return DEFAULT_COLOR_MODE;
}

function saveColorModeToStorage(mode: ColorMode): void {
  try {
    localStorage.setItem(COLOR_MODE_KEY, mode);
  } catch {}
}

function resolveThemeId(mode: ColorMode, systemScheme: 'dark' | 'light'): ThemeId {
  if (mode === 'system') return systemScheme;
  return mode;
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

function loadNumberFromStorage(key: string, defaultVal: number, min: number, max: number): number {
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null) {
      const v = parseInt(saved, 10);
      if (!isNaN(v) && v >= min && v <= max) return v;
    }
  } catch {}
  return defaultVal;
}

function saveNumberToStorage(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
}

interface ThemeState {
  currentTheme: ThemeId;
  colorMode: ColorMode;
  systemColorScheme: 'dark' | 'light';
  themes: ThemeConfig[];
  cardOpacity: number;
  blurIntensity: number;
  bgImageBlur: number;
  bgImageScale: number;
  maxBufferSize: number;
  setTheme: (themeId: ThemeId) => void;
  setColorMode: (mode: ColorMode) => void;
  setSystemColorScheme: (scheme: 'dark' | 'light') => void;
  getCurrentThemeConfig: () => ThemeConfig;
  setCardOpacity: (v: number) => void;
  setBlurIntensity: (v: number) => void;
  setBgImageBlur: (v: number) => void;
  setBgImageScale: (v: number) => void;
  setMaxBufferSize: (v: number) => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  currentTheme: loadThemeFromStorage(),
  colorMode: loadColorModeFromStorage(),
  systemColorScheme: 'dark',
  themes: Object.values(themes),
  cardOpacity: loadNumberFromStorage(CARD_OPACITY_KEY, DEFAULT_CARD_OPACITY, 10, 100),
  blurIntensity: loadNumberFromStorage(BLUR_KEY, DEFAULT_BLUR, 0, 100),
  bgImageBlur: loadNumberFromStorage(BG_IMAGE_BLUR_KEY, DEFAULT_BG_IMAGE_BLUR, 0, 100),
  bgImageScale: loadNumberFromStorage(BG_IMAGE_SCALE_KEY, DEFAULT_BG_IMAGE_SCALE, 1, 50),
  maxBufferSize: loadNumberFromStorage(MAX_BUFFER_SIZE_KEY, DEFAULT_MAX_BUFFER_SIZE, 30, 600),

  setTheme: (themeId) => {
    set({ currentTheme: themeId });
    saveThemeToStorage(themeId);
  },

  setColorMode: (mode) => {
    const { systemColorScheme } = get();
    const nextTheme = resolveThemeId(mode, systemColorScheme);
    set({ colorMode: mode, currentTheme: nextTheme });
    saveColorModeToStorage(mode);
    saveThemeToStorage(nextTheme);
  },

  setSystemColorScheme: (scheme) => {
    const { colorMode } = get();
    set({ systemColorScheme: scheme });
    if (colorMode === 'system') {
      set({ currentTheme: scheme });
      saveThemeToStorage(scheme);
    }
  },

  getCurrentThemeConfig: () => {
    return themes[get().currentTheme];
  },

  setCardOpacity: (v) => {
    set({ cardOpacity: v });
    saveNumberToStorage(CARD_OPACITY_KEY, v);
  },

  setBlurIntensity: (v) => {
    set({ blurIntensity: v });
    saveNumberToStorage(BLUR_KEY, v);
  },

  setBgImageBlur: (v) => {
    set({ bgImageBlur: v });
    saveNumberToStorage(BG_IMAGE_BLUR_KEY, v);
  },

  setBgImageScale: (v) => {
    set({ bgImageScale: v });
    saveNumberToStorage(BG_IMAGE_SCALE_KEY, v);
  },

  setMaxBufferSize: (v) => {
    set({ maxBufferSize: v });
    saveNumberToStorage(MAX_BUFFER_SIZE_KEY, v);
  },
}));