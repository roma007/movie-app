import { useCallback, useEffect, useRef } from 'react';
import { useCastStore, type CastDevice } from '../stores/castStore';

export interface CastManager {
  isCasting: boolean;
  castDevice: CastDevice | null;
  castState: string;
  castProgress: { currentTime: number; duration: number };
  availableDevices: CastDevice[];
  isSearching: boolean;
  searchDevices: () => Promise<void>;
  connectToDevice: (device: CastDevice, videoUrl: string, title?: string, duration?: number, startPositionMs?: number) => Promise<void>;
  recast: (videoUrl: string, title?: string, startPositionMs?: number) => Promise<void>;
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
    isSearching,
    startCasting,
    stopCasting,
    setCastState,
    setCastProgress,
  } = useCastStore();

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resumingRef = useRef(false);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const searchDevices = useCallback(async () => {
    useCastStore.getState().setSearching(true);
    useCastStore.getState().setCastError(null);
    try {
      const { discoverDlnaDevices } = await import('../services/dlnaService');
      const { discoverAirplayDevices } = await import('../services/airplayService');

      const [dlnaDevices, airplayDevices] = await Promise.allSettled([
        discoverDlnaDevices(),
        discoverAirplayDevices(),
      ]);

      const devices: CastDevice[] = [];
      if (dlnaDevices.status === 'fulfilled') {
        devices.push(...dlnaDevices.value);
      }
      if (airplayDevices.status === 'fulfilled') {
        devices.push(...airplayDevices.value);
      }

      useCastStore.getState().setAvailableDevices(devices);
    } finally {
      useCastStore.getState().setSearching(false);
    }
  }, []);

  const connectToDevice = useCallback(
    async (
      device: CastDevice,
      videoUrl: string,
      title?: string,
      duration?: number,
      startPositionMs?: number,
    ) => {
      startCasting(device, 0);

      try {
        if (device.protocol === 'dlna') {
          const { castToDlna } = await import('../services/dlnaService');
          await castToDlna(device.id, videoUrl, title, startPositionMs);
        } else if (device.protocol === 'airplay') {
          const { castToAirplay } = await import('../services/airplayService');
          await castToAirplay(videoUrl);
        }
        setCastState('playing');
      } catch (e) {
        setCastState('error');
        useCastStore.getState().setCastError(e instanceof Error ? e.message : '投屏失败');
        stopCasting();
        throw e;
      }
    },
    [startCasting, stopCasting, setCastState],
  );

  const recast = useCallback(
    async (videoUrl: string, title?: string, startPositionMs?: number) => {
      const device = useCastStore.getState().castDevice;
      if (!device) return;
      if (device.protocol === 'dlna') {
        const { castToDlna } = await import('../services/dlnaService');
        await castToDlna(device.id, videoUrl, title, startPositionMs);
        setCastState('playing');
      }
    },
    [setCastState],
  );

  const disconnect = useCallback(async () => {
    clearPoll();
    resumingRef.current = true;
    const device = useCastStore.getState().castDevice;
    if (device) {
      try {
        if (device.protocol === 'dlna') {
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
    resumingRef.current = false;
    onResumeLocal?.(progress.currentTime);
  }, [clearPoll, stopCasting, onResumeLocal]);

  const play = useCallback(async () => {
    const device = useCastStore.getState().castDevice;
    if (!device) return;
    if (device.protocol === 'dlna') {
      const { dlnaPlay } = await import('../services/dlnaService');
      await dlnaPlay(device.id);
    }
    setCastState('playing');
  }, [setCastState]);

  const pause = useCallback(async () => {
    const device = useCastStore.getState().castDevice;
    if (!device) return;
    if (device.protocol === 'dlna') {
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
    if (device.protocol === 'dlna') {
      const { dlnaSeek } = await import('../services/dlnaService');
      await dlnaSeek(device.id, positionMs);
    }
  }, []);

  const setVolume = useCallback(async (volume: number) => {
    const device = useCastStore.getState().castDevice;
    if (!device) return;
    if (device.protocol === 'dlna') {
      const { dlnaSetVolume } = await import('../services/dlnaService');
      await dlnaSetVolume(device.id, volume * 100);
    }
  }, []);

  useEffect(() => {
    if (!isCasting || !castDevice) {
      clearPoll();
      return;
    }

    let failCount = 0;

    const pollPosition = async (getPosition: () => Promise<{ currentTime: number; duration: number } | null>) => {
      try {
        const pos = await getPosition();
        if (pos && pos.duration > 0) {
          setCastProgress({ currentTime: pos.currentTime, duration: pos.duration });
          failCount = 0;
          return;
        }
        throw new Error('no-position');
      } catch {
        failCount += 1;
        if (failCount >= 3) {
          clearPoll();
          resumingRef.current = true;
          stopCasting();
          resumingRef.current = false;
          onResumeLocal?.(useCastStore.getState().castProgress.currentTime);
        }
      }
    };

    if (castDevice.protocol === 'dlna') {
      pollRef.current = setInterval(() => {
        pollPosition(async () => {
          const { dlnaGetPosition } = await import('../services/dlnaService');
          return dlnaGetPosition(castDevice.id);
        });
      }, 1500);
    }

    return () => clearPoll();
  }, [isCasting, castDevice, clearPoll, setCastProgress, stopCasting, onResumeLocal]);

  return {
    isCasting,
    castDevice,
    castState,
    castProgress,
    availableDevices,
    isSearching,
    searchDevices,
    connectToDevice,
    recast,
    disconnect,
    play,
    pause,
    stop,
    seek,
    setVolume,
  };
}
