import { create } from 'zustand';

export type CastProtocol = 'airplay' | 'dlna';
export type CastState = 'idle' | 'connecting' | 'playing' | 'paused' | 'buffering' | 'error' | 'disconnected';

export interface CastDevice {
  id: string;
  name: string;
  protocol: CastProtocol;
  isConnected: boolean;
}

export interface CastProgress {
  currentTime: number;
  duration: number;
}

interface CastState_ {
  isCasting: boolean;
  castDevice: CastDevice | null;
  castProtocol: CastProtocol | null;
  castProgress: CastProgress;
  castState: CastState;
  availableDevices: CastDevice[];
  localProgressBeforeCast: number;
  isSearching: boolean;
  castError: string | null;

  setSearching: (searching: boolean) => void;
  setCastError: (error: string | null) => void;
  setAvailableDevices: (devices: CastDevice[]) => void;
  addDevice: (device: CastDevice) => void;
  removeDevice: (deviceId: string) => void;
  startCasting: (device: CastDevice, localProgress?: number) => void;
  stopCasting: () => void;
  setCastState: (state: CastState) => void;
  setCastProgress: (progress: CastProgress) => void;
  updateCastProgress: (currentTime: number) => void;
}

export const useCastStore = create<CastState_>((set) => ({
  isCasting: false,
  castDevice: null,
  castProtocol: null,
  castProgress: { currentTime: 0, duration: 0 },
  castState: 'idle',
  availableDevices: [],
  localProgressBeforeCast: 0,
  isSearching: false,
  castError: null,

  setSearching: (searching) => set({ isSearching: searching }),
  setCastError: (error) => set({ castError: error }),
  setAvailableDevices: (devices) => set({ availableDevices: devices }),

  addDevice: (device) =>
    set((s) => {
      const exists = s.availableDevices.some((d) => d.id === device.id);
      if (exists) {
        return {
          availableDevices: s.availableDevices.map((d) =>
            d.id === device.id ? { ...d, isConnected: device.isConnected } : d,
          ),
        };
      }
      return { availableDevices: [...s.availableDevices, device] };
    }),

  removeDevice: (deviceId) =>
    set((s) => ({
      availableDevices: s.availableDevices.filter((d) => d.id !== deviceId),
    })),

  startCasting: (device, localProgress = 0) =>
    set({
      isCasting: true,
      castDevice: device,
      castProtocol: device.protocol,
      castState: 'connecting',
      castProgress: { currentTime: localProgress, duration: 0 },
      localProgressBeforeCast: localProgress,
    }),

  stopCasting: () =>
    set({
      isCasting: false,
      castDevice: null,
      castProtocol: null,
      castState: 'idle',
      castProgress: { currentTime: 0, duration: 0 },
      localProgressBeforeCast: 0,
    }),

  setCastState: (state) => set({ castState: state }),

  setCastProgress: (progress) => set({ castProgress: progress }),

  updateCastProgress: (currentTime) =>
    set((s) => ({
      castProgress: { ...s.castProgress, currentTime },
    })),
}));
