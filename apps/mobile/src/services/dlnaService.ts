import type { CastDevice } from '../stores/castStore';

let dlnaModule: any = null;

async function getDlnaModule() {
  if (!dlnaModule) {
    try {
      dlnaModule = require('expo-dlna-cast');
    } catch {
      return null;
    }
  }
  return dlnaModule;
}

export async function discoverDlnaDevices(): Promise<CastDevice[]> {
  const mod = await getDlnaModule();
  if (!mod) return [];
  try {
    const devices = await mod.searchDevices(3000);
    return (devices || []).map((d: any) => ({
      id: d.id,
      name: d.name,
      protocol: 'dlna' as const,
      isConnected: false,
    }));
  } catch {
    return [];
  }
}

export async function castToDlna(
  deviceId: string,
  videoUrl: string,
  title?: string,
  startPositionMs?: number,
): Promise<void> {
  const mod = await getDlnaModule();
  if (!mod) throw new Error('DLNA module not available');
  await mod.cast(deviceId, videoUrl, title || '', startPositionMs || 0);
}

export async function stopDlna(deviceId: string): Promise<void> {
  const mod = await getDlnaModule();
  if (!mod) return;
  await mod.stop(deviceId);
}

export async function dlnaPlay(deviceId: string): Promise<void> {
  const mod = await getDlnaModule();
  if (!mod) return;
  await mod.play(deviceId);
}

export async function dlnaPause(deviceId: string): Promise<void> {
  const mod = await getDlnaModule();
  if (!mod) return;
  await mod.pause(deviceId);
}

export async function dlnaSeek(deviceId: string, positionMs: number): Promise<void> {
  const mod = await getDlnaModule();
  if (!mod) return;
  await mod.seek(deviceId, positionMs);
}

export async function dlnaSetVolume(deviceId: string, volume: number): Promise<void> {
  const mod = await getDlnaModule();
  if (!mod) return;
  await mod.setVolume(deviceId, volume);
}

export async function dlnaGetPosition(
  deviceId: string,
): Promise<{ currentTime: number; duration: number } | null> {
  const mod = await getDlnaModule();
  if (!mod) return null;
  try {
    const pos = await mod.getPosition(deviceId);
    return pos || null;
  } catch {
    return null;
  }
}
