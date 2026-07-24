import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { themes, DEFAULT_THEME, THEME_KEY } from './config';
import type { ThemeId, ThemeConfig, ThemeColors } from './types';

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

interface ThemeState {
  currentTheme: ThemeId;
  initialized: boolean;
  setTheme: (id: ThemeId) => void;
  initTheme: () => Promise<void>;
  getCurrentColors: () => ThemeColors;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  currentTheme: DEFAULT_THEME,
  initialized: false,
  setTheme: (id: ThemeId) => {
    set({ currentTheme: id });
    saveThemeToStorage(id);
  },
  initTheme: async () => {
    const id = await loadThemeFromStorage();
    set({ currentTheme: id, initialized: true });
  },
  getCurrentColors: () => themes[get().currentTheme].colors,
}));
