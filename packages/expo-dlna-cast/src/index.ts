import { requireNativeModule, NativeModule } from 'expo';
import { EventEmitter } from 'expo-modules-core';
import type { DlnaDevice, DlnaPosition, DlnaPlaybackState } from './types';

type ExpoDlnaCastEvents = {
  onDeviceFound: (device: DlnaDevice) => void;
  onDeviceLost: (deviceId: string) => void;
  onPlaybackStateChanged: (state: DlnaPlaybackState) => void;
};

class ExpoDlnaCastModule extends NativeModule<ExpoDlnaCastEvents> {
  searchDevices(timeoutMs: number): Promise<DlnaDevice[]> {
    return Promise.resolve([]);
  }
  connect(deviceId: string): Promise<boolean> {
    return Promise.resolve(false);
  }
  disconnect(deviceId: string): Promise<void> {
    return Promise.resolve();
  }
  cast(deviceId: string, url: string, title: string): Promise<boolean> {
    return Promise.resolve(false);
  }
  play(deviceId: string): Promise<void> {
    return Promise.resolve();
  }
  pause(deviceId: string): Promise<void> {
    return Promise.resolve();
  }
  stop(deviceId: string): Promise<void> {
    return Promise.resolve();
  }
  seek(deviceId: string, positionMs: number): Promise<void> {
    return Promise.resolve();
  }
  getPosition(deviceId: string): Promise<DlnaPosition | null> {
    return Promise.resolve(null);
  }
  getPlaybackState(deviceId: string): Promise<DlnaPlaybackState> {
    return Promise.resolve('NO_MEDIA_PRESENT');
  }
  setVolume(deviceId: string, volume: number): Promise<void> {
    return Promise.resolve();
  }
  getVolume(deviceId: string): Promise<number> {
    return Promise.resolve(0);
  }
}

let moduleInstance: ExpoDlnaCastModule | null = null;

try {
  moduleInstance = requireNativeModule('ExpoDlnaCast');
} catch {
  // Module not available (e.g., during Expo Go or web)
  moduleInstance = null;
}

export const ExpoDlnaCast: ExpoDlnaCastModule | null = moduleInstance;

export { EventEmitter };
export type { DlnaDevice, DlnaPosition, DlnaPlaybackState } from './types';
