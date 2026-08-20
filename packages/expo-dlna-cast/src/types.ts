export interface DlnaDevice {
  id: string;
  name: string;
  address: string;
  type: string;
  isTV: boolean;
}

export interface DlnaPosition {
  currentTime: number;
  duration: number;
}

export type DlnaPlaybackState = 'PLAYING' | 'PAUSED' | 'STOPPED' | 'TRANSITIONING' | 'NO_MEDIA_PRESENT';

export interface DlnaEvents {
  onDeviceFound: (device: DlnaDevice) => void;
  onDeviceLost: (deviceId: string) => void;
  onPlaybackStateChanged: (state: DlnaPlaybackState) => void;
}
