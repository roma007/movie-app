import { useCallback, useEffect, useRef } from 'react';
import { useCastStore, type CastDevice } from '../stores/castStore';

export interface CastManager {
  isCasting: boolean;
  castDevice: CastDevice | null;
  castState: string;
  castProgress: { currentTime: number; duration: number };
  availableDevices: CastDevice[];
  searchDevices: () => Promise<void>;
  connectToDevice: (device: CastDevice, videoUrl: string, title?: string, duration?: number) => Promise<void>;
  disconnect: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  stop: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
}

export function useCastManager(
  getVideoUrl: () => string,
  getTitle: () => string,
  getDuration: () => number,
  onResumeLocal?: (position: number) => void,
): CastManager {
  const {
    isCasting,
    castDevice,
    castState,
    castProgress,
    availableDevices,
    startCasting,
    stopCasting,
    setCastState,
    setCastProgress,
  } = useCastStore();

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const searchDevices = useCallback(async () => {
    const { discoverChromecastDevices } = await import('../services/chromecastService');
    const { discoverDlnaDevices } = await import('../services/dlnaService');

    const [chromecastDevices, dlnaDevices] = await Promise.allSettled([
      discoverChromecastDevices(),
      discoverDlnaDevices(),
    ]);

    const devices: CastDevice[] = [];
    if (chromecastDevices.status === 'fulfilled') {
      devices.push(...chromecastDevices.value);
    }
    if (dlnaDevices.status === 'fulfilled') {
      devices.push(...dlnaDevices.value);
    }

    useCastStore.getState().setAvailableDevices(devices);
  }, []);

  const connectToDevice = useCallback(
    async (device: CastDevice, videoUrl: string, title?: string, duration?: number) => {
      startCasting(device, 0);

      try {
        if (device.protocol === 'chromecast') {
          const { connectToChromecastDevice, castToChromecast } = await import('../services/chromecastService');
          await connectToChromecastDevice(device.id);
          await castToChromecast(videoUrl, title, duration);
        } else if (device.protocol === 'dlna') {
          const { castToDlna } = await import('../services/dlnaService');
          await castToDlna(device.id, videoUrl, title);
        } else if (device.protocol === 'airplay') {
          const { castToAirplay } = await import('../services/airplayService');
          await castToAirplay(videoUrl);
        }
        setCastState('playing');
      } catch (e) {
        setCastState('error');
        stopCasting();
        throw e;
      }
    },
    [startCasting, stopCasting, setCastState],
  );

  const disconnect = useCallback(async () => {
    clearPoll();
    const device = useCastStore.getState().castDevice;
    if (device) {
      try {
        if (device.protocol === 'chromecast') {
          const { stopChromecast } = await import('../services/chromecastService');
          await stopChromecast();
        } else if (device.protocol === 'dlna') {
          const { stopDlna } = await import('../services/dlnaService');
          await stopDlna(device.id);
        } else if (device.protocol === 'airplay') {
          const { stopAirplay } = await import('../services/airplayService');
          await stopAirplay();
        }
      } catch {
        // ignore cleanup errors
      }
    }
    const progress = useCastStore.getState().castProgress;
    stopCasting();
    onResumeLocal?.(progress.currentTime);
  }, [clearPoll, stopCasting, onResumeLocal]);

  const play = useCallback(async () => {
    const device = useCastStore.getState().castDevice;
    if (!device) return;
    if (device.protocol === 'chromecast') {
      const { chromecastPlay } = await import('../services/chromecastService');
      await chromecastPlay();
    } else if (device.protocol === 'dlna') {
      const { dlnaPlay } = await import('../services/dlnaService');
      await dlnaPlay(device.id);
    }
    setCastState('playing');
  }, [setCastState]);

  const pause = useCallback(async () => {
    const device = useCastStore.getState().castDevice;
    if (!device) return;
    if (device.protocol === 'chromecast') {
      const { chromecastPause } = await import('../services/chromecastService');
      await chromecastPause();
    } else if (device.protocol === 'dlna') {
      const { dlnaPause } = await import('../services/dlnaService');
      await dlnaPause(device.id);
    }
    setCastState('paused');
  }, [setCastState]);

  const stop = useCallback(async () => {
    await disconnect();
  }, [disconnect]);

  const seek = useCallback(async (positionMs: number) => {
    const device = useCastStore.getState().castDevice;
    if (!device) return;
    if (device.protocol === 'chromecast') {
      const { chromecastSeek } = await import('../services/chromecastService');
      await chromecastSeek(positionMs);
    } else if (device.protocol === 'dlna') {
      const { dlnaSeek } = await import('../services/dlnaService');
      await dlnaSeek(device.id, positionMs);
    }
  }, []);

  const setVolume = useCallback(async (volume: number) => {
    const device = useCastStore.getState().castDevice;
    if (!device) return;
    if (device.protocol === 'chromecast') {
      const { chromecastSetVolume } = await import('../services/chromecastService');
      await chromecastSetVolume(volume);
    } else if (device.protocol === 'dlna') {
      const { dlnaSetVolume } = await import('../services/dlnaService');
      await dlnaSetVolume(device.id, volume);
    }
  }, []);

  useEffect(() => {
    if (!isCasting || !castDevice) {
      clearPoll();
      return;
    }

    if (castDevice.protocol === 'dlna') {
      pollRef.current = setInterval(async () => {
        try {
          const { dlnaGetPosition } = await import('../services/dlnaService');
          const pos = await dlnaGetPosition(castDevice.id);
          if (pos) {
            setCastProgress({ currentTime: pos.currentTime, duration: pos.duration });
          }
        } catch {
          // ignore poll errors
        }
      }, 1500);
    }

    return () => clearPoll();
  }, [isCasting, castDevice, clearPoll, setCastProgress]);

  return {
    isCasting,
    castDevice,
    castState,
    castProgress,
    availableDevices,
    searchDevices,
    connectToDevice,
    disconnect,
    play,
    pause,
    stop,
    seek,
    setVolume,
  };
}
