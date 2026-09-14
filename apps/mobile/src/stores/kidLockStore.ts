import { create } from 'zustand';
import { KidLockService } from '@movie-app/core';
import { getProvider } from '../useAppStore';

export function getKidLockService(): KidLockService {
  return new KidLockService(getProvider());
}

interface KidLockState {
  active: boolean;
  loaded: boolean;
  refresh: () => Promise<void>;
  setActive: (active: boolean) => void;
}

export const useKidLockStore = create<KidLockState>((set) => ({
  active: false,
  loaded: false,
  async refresh() {
    const active = await getProvider().getKidModeActive();
    set({ active, loaded: true });
  },
  setActive(active) {
    set({ active });
  },
}));