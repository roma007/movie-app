import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { themes, DEFAULT_THEME, THEME_KEY } from './config';
import type { ThemeId, ThemeConfig, ThemeColors } from './types';

const BLUR_KEY = 'movie-app-blur-intensity';
const IMAGE_BLUR_KEY = 'movie-app-image-blur';
const IMAGE_SCALE_KEY = 'movie-app-image-scale';
const CARD_OPACITY_KEY = 'movie-app-card-opacity';
const DEFAULT_BLUR = 50;
const DEFAULT_IMAGE_BLUR = 0;
const DEFAULT_IMAGE_SCALE = 10;
const DEFAULT_CARD_OPACITY = 85;

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

interface ThemeState {
  currentTheme: ThemeId;
  initialized: boolean;
  blurIntensity: number;
  imageBlur: number;
  imageScale: number;
  cardOpacity: number;
  setTheme: (id: ThemeId) => void;
  initTheme: () => Promise<void>;
  getCurrentColors: () => ThemeColors;
  setBlurIntensity: (v: number) => void;
  initBlurIntensity: () => Promise<void>;
  setImageBlur: (v: number) => void;
  initImageBlur: () => Promise<void>;
  setImageScale: (v: number) => void;
  initImageScale: () => Promise<void>;
  setCardOpacity: (v: number) => void;
  initCardOpacity: () => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  currentTheme: DEFAULT_THEME,
  initialized: false,
  blurIntensity: DEFAULT_BLUR,
  imageBlur: DEFAULT_IMAGE_BLUR,
  imageScale: DEFAULT_IMAGE_SCALE,
  cardOpacity: DEFAULT_CARD_OPACITY,
  setTheme: (id: ThemeId) => {
    set({ currentTheme: id });
    saveThemeToStorage(id);
  },
  initTheme: async () => {
    const id = await loadThemeFromStorage();
    set({ currentTheme: id, initialized: true });
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
}));
