import { create } from 'zustand';

const DEFAULT_BG = '/assets/default-poster.jpg';

interface BackgroundState {
  currentBgImage: string | null;
  setBgImage: (url: string | null) => void;
  clearBgImage: () => void;
  getBgImage: () => string;
}

export const DEFAULT_BG_IMAGE = DEFAULT_BG;

export const useBackgroundStore = create<BackgroundState>((set, get) => ({
  currentBgImage: null,

  setBgImage: (url) => {
    set({ currentBgImage: url });
  },

  clearBgImage: () => {
    set({ currentBgImage: null });
  },

  getBgImage: () => {
    return get().currentBgImage ?? DEFAULT_BG;
  },
}));
