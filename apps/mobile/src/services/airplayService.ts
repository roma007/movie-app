import { NativeModules, Platform } from 'react-native';
import type { CastDevice } from '../stores/castStore';

const AirplayModule = Platform.OS === 'ios' ? NativeModules.AirplayModule : null;

export async function discoverAirplayDevices(): Promise<CastDevice[]> {
  if (Platform.OS !== 'ios') return [];
  try {
    const available = await AirplayModule?.checkExternalPlaybackAvailability?.();
    if (available) {
      return [
        {
          id: 'airplay-system',
          name: 'AirPlay',
          protocol: 'airplay',
          isConnected: false,
        },
      ];
    }
    return [];
  } catch {
    return [];
  }
}

export async function castToAirplay(videoUrl: string): Promise<void> {
  if (Platform.OS !== 'ios') return;
  await AirplayModule?.showRoutePicker?.();
}

export async function stopAirplay(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  await AirplayModule?.hideRoutePicker?.();
}

export async function checkAirplayConnectivity(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AirplayModule?.checkExternalPlaybackAvailability?.() || false;
  } catch {
    return false;
  }
}
