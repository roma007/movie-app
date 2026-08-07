import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { themes, DEFAULT_THEME, THEME_KEY } from './config';
import type { ThemeId, ThemeConfig, ThemeColors, ColorMode } from './types';

const COLOR_MODE_KEY = 'movie-app-color-mode';
const BLUR_KEY = 'movie-app-blur-intensity';
const IMAGE_BLUR_KEY = 'movie-app-image-blur';
const IMAGE_SCALE_KEY = 'movie-app-image-scale';
const CARD_OPACITY_KEY = 'movie-app-card-opacity';
const FONT_SIZE_KEY = 'movie-app-font-size-scale';
const DEFAULT_COLOR_MODE: ColorMode = 'system';
const DEFAULT_BLUR = 50;
const DEFAULT_IMAGE_BLUR = 40;
const DEFAULT_IMAGE_SCALE = 1;
const DEFAULT_CARD_OPACITY = 40;
const DEFAULT_FONT_SIZE_SCALE = 1.0;

async function loadColorModeFromStorage(): Promise<ColorMode> {
  try {
    const saved = await AsyncStorage.getItem(COLOR_MODE_KEY);
    if (saved === 'system' || saved === 'dark' || saved === 'light') return saved;
  } catch {}
  return DEFAULT_COLOR_MODE;
}

async function saveColorModeToStorage(mode: ColorMode): Promise<void> {
  try {
    await AsyncStorage.setItem(COLOR_MODE_KEY, mode);
  } catch {}
}

async function loadThemeFromStorage(): Promise<ThemeId> {
  try {
    const saved = await AsyncStorage.getItem(THEME_KEY);
    if (saved && saved in themes) return saved as ThemeId;
  } catch {}
  return DEFAULT_THEME;
}

async function saveThemeToStorage(id: ThemeId): Promise<void> {
  try {
    await AsyncStorage.setItem(THEME_KEY, id);
  } catch {}
}

async function loadBlurFromStorage(): Promise<number> {
  try {
    const saved = await AsyncStorage.getItem(BLUR_KEY);
    if (saved !== null) {
      const v = parseInt(saved, 10);
      if (!isNaN(v) && v >= 0 && v <= 100) return v;
    }
  } catch {}
  return DEFAULT_BLUR;
}

async function saveBlurToStorage(v: number): Promise<void> {
  try {
    await AsyncStorage.setItem(BLUR_KEY, String(v));
  } catch {}
}

async function loadImageBlurFromStorage(): Promise<number> {
  try {
    const saved = await AsyncStorage.getItem(IMAGE_BLUR_KEY);
    if (saved !== null) {
      const v = parseInt(saved, 10);
      if (!isNaN(v) && v >= 0 && v <= 100) return v;
    }
  } catch {}
  return DEFAULT_IMAGE_BLUR;
}

async function saveImageBlurToStorage(v: number): Promise<void> {
  try {
    await AsyncStorage.setItem(IMAGE_BLUR_KEY, String(v));
  } catch {}
}

async function loadImageScaleFromStorage(): Promise<number> {
  try {
    const saved = await AsyncStorage.getItem(IMAGE_SCALE_KEY);
    if (saved !== null) {
      const v = parseInt(saved, 10);
      if (!isNaN(v) && v >= 1 && v <= 50) return v;
    }
  } catch {}
  return DEFAULT_IMAGE_SCALE;
}

async function saveImageScaleToStorage(v: number): Promise<void> {
  try {
    await AsyncStorage.setItem(IMAGE_SCALE_KEY, String(v));
  } catch {}
}

async function loadCardOpacityFromStorage(): Promise<number> {
  try {
    const saved = await AsyncStorage.getItem(CARD_OPACITY_KEY);
    if (saved !== null) {
      const v = parseInt(saved, 10);
      if (!isNaN(v) && v >= 10 && v <= 100) return v;
    }
  } catch {}
  return DEFAULT_CARD_OPACITY;
}

async function saveCardOpacityToStorage(v: number): Promise<void> {
  try {
    await AsyncStorage.setItem(CARD_OPACITY_KEY, String(v));
  } catch {}
}

async function loadFontSizeScaleFromStorage(): Promise<number> {
  try {
    const saved = await AsyncStorage.getItem(FONT_SIZE_KEY);
    if (saved !== null) {
      const v = parseFloat(saved);
      if (!isNaN(v) && v >= 0.5 && v <= 2.0) return v;
    }
  } catch {}
  return DEFAULT_FONT_SIZE_SCALE;
}

async function saveFontSizeScaleToStorage(v: number): Promise<void> {
  try {
    await AsyncStorage.setItem(FONT_SIZE_KEY, String(v));
  } catch {}
}

interface ThemeState {
  currentTheme: ThemeId;
  colorMode: ColorMode;
  systemColorScheme: 'dark' | 'light';
  initialized: boolean;
  blurIntensity: number;
  imageBlur: number;
  imageScale: number;
  cardOpacity: number;
  fontSizeScale: number;
  setTheme: (id: ThemeId) => void;
  initTheme: () => Promise<void>;
  setColorMode: (mode: ColorMode) => void;
  initColorMode: () => Promise<void>;
  setSystemColorScheme: (scheme: 'dark' | 'light') => void;
  getCurrentColors: () => ThemeColors;
  setBlurIntensity: (v: number) => void;
  initBlurIntensity: () => Promise<void>;
  setImageBlur: (v: number) => void;
  initImageBlur: () => Promise<void>;
  setImageScale: (v: number) => void;
  initImageScale: () => Promise<void>;
  setCardOpacity: (v: number) => void;
  initCardOpacity: () => Promise<void>;
  setFontSizeScale: (v: number) => void;
  initFontSizeScale: () => Promise<void>;
}

function resolveThemeId(mode: ColorMode, systemScheme: 'dark' | 'light'): ThemeId {
  if (mode === 'system') return systemScheme;
  return mode;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  currentTheme: DEFAULT_THEME,
  colorMode: DEFAULT_COLOR_MODE,
  systemColorScheme: 'dark',
  initialized: false,
  blurIntensity: DEFAULT_BLUR,
  imageBlur: DEFAULT_IMAGE_BLUR,
  imageScale: DEFAULT_IMAGE_SCALE,
  cardOpacity: DEFAULT_CARD_OPACITY,
  fontSizeScale: DEFAULT_FONT_SIZE_SCALE,
  setTheme: (id: ThemeId) => {
    set({ currentTheme: id });
    saveThemeToStorage(id);
  },
  initTheme: async () => {
    const id = await loadThemeFromStorage();
    set({ currentTheme: id, initialized: true });
  },
  setColorMode: (mode: ColorMode) => {
    const { systemColorScheme } = get();
    const nextTheme = resolveThemeId(mode, systemColorScheme);
    set({ colorMode: mode, currentTheme: nextTheme });
    saveColorModeToStorage(mode);
    saveThemeToStorage(nextTheme);
  },
  initColorMode: async () => {
    const mode = await loadColorModeFromStorage();
    const { systemColorScheme } = get();
    const nextTheme = resolveThemeId(mode, systemColorScheme);
    set({ colorMode: mode, currentTheme: nextTheme });
  },
  setSystemColorScheme: (scheme: 'dark' | 'light') => {
    const { colorMode } = get();
    set({ systemColorScheme: scheme });
    if (colorMode === 'system') {
      set({ currentTheme: scheme });
      saveThemeToStorage(scheme);
    }
  },
  getCurrentColors: () => themes[get().currentTheme].colors,
  setBlurIntensity: (v: number) => {
    set({ blurIntensity: v });
    saveBlurToStorage(v);
  },
  initBlurIntensity: async () => {
    const v = await loadBlurFromStorage();
    set({ blurIntensity: v });
  },
  setImageBlur: (v: number) => {
    set({ imageBlur: v });
    saveImageBlurToStorage(v);
  },
  initImageBlur: async () => {
    const v = await loadImageBlurFromStorage();
    set({ imageBlur: v });
  },
  setImageScale: (v: number) => {
    set({ imageScale: v });
    saveImageScaleToStorage(v);
  },
  initImageScale: async () => {
    const v = await loadImageScaleFromStorage();
    set({ imageScale: v });
  },
  setCardOpacity: (v: number) => {
    set({ cardOpacity: v });
    saveCardOpacityToStorage(v);
  },
  initCardOpacity: async () => {
    const v = await loadCardOpacityFromStorage();
    set({ cardOpacity: v });
  },
  setFontSizeScale: (v: number) => {
    set({ fontSizeScale: v });
    saveFontSizeScaleToStorage(v);
  },
  initFontSizeScale: async () => {
    const v = await loadFontSizeScaleFromStorage();
    set({ fontSizeScale: v });
  },
}));
