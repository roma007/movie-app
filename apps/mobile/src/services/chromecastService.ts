import GoogleCast, {
  CastState,
  RemoteMediaClient,
} from 'react-native-google-cast';
import type { CastDevice } from '../stores/castStore';

export async function discoverChromecastDevices(): Promise<CastDevice[]> {
  try {
    const discoveryManager = GoogleCast.getDiscoveryManager();
    const devices = await discoveryManager.getDevices();
    return devices.map((device) => ({
      id: device.deviceId,
      name: device.friendlyName || 'Chromecast',
      protocol: 'chromecast' as const,
      isConnected: false,
    }));
  } catch {
    return [];
  }
}

export async function connectToChromecastDevice(deviceId: string): Promise<void> {
  const sessionManager = GoogleCast.getSessionManager();
  await sessionManager.startSession(deviceId);
}

export async function castToChromecast(
  videoUrl: string,
  title?: string,
  duration?: number,
): Promise<void> {
  const sessionManager = GoogleCast.getSessionManager();
  const session = await sessionManager.getCurrentCastSession();
  
  if (!session) throw new Error('No Chromecast session');

  const client = session.getClient();
  if (!client) throw new Error('No remote media client');

  await client.loadMedia({
    mediaInfo: {
      contentUrl: videoUrl,
      contentType: 'video/mp4',
    },
    autoplay: true,
  });
}

export async function stopChromecast(): Promise<void> {
  try {
    const sessionManager = GoogleCast.getSessionManager();
    const session = await sessionManager.getCurrentCastSession();
    await session?.getClient()?.stop();
    await sessionManager.endCurrentSession(true);
  } catch {
    // ignore
  }
}

export async function chromecastPlay(): Promise<void> {
  const sessionManager = GoogleCast.getSessionManager();
  const session = await sessionManager.getCurrentCastSession();
  await session?.getClient()?.play();
}

export async function chromecastPause(): Promise<void> {
  const sessionManager = GoogleCast.getSessionManager();
  const session = await sessionManager.getCurrentCastSession();
  await session?.getClient()?.pause();
}

export async function chromecastSeek(positionMs: number): Promise<void> {
  const sessionManager = GoogleCast.getSessionManager();
  const session = await sessionManager.getCurrentCastSession();
  await session?.getClient()?.seek({
    position: positionMs / 1000,
  });
}

export async function chromecastSetVolume(volume: number): Promise<void> {
  const sessionManager = GoogleCast.getSessionManager();
  const session = await sessionManager.getCurrentCastSession();
  await session?.getClient()?.setStreamVolume(volume);
}

export async function chromecastGetProgress(): Promise<{ currentTime: number; duration: number } | null> {
  try {
    const sessionManager = GoogleCast.getSessionManager();
    const session = await sessionManager.getCurrentCastSession();
    const client = session?.getClient();
    const status = await client?.getMediaStatus();
    if (status) {
      return {
        currentTime: status.streamPosition || 0,
        duration: status.mediaInfo?.streamDuration || 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}
