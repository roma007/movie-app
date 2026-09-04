import { Platform } from 'react-native';
import type { CastDevice } from '../stores/castStore';

let airplayModule: typeof import('react-airplay') | null = null;

async function getAirplayModule() {
  if (!airplayModule) {
    try {
      airplayModule = require('react-airplay');
    } catch {
      return null;
    }
  }
  return airplayModule;
}

export async function discoverAirplayDevices(): Promise<CastDevice[]> {
  if (Platform.OS !== 'ios') return [];
  try {
    const mod = await getAirplayModule();
    if (!mod) return [];
    const available = mod.getExternalPlaybackAvailability();
    if (available) {
      // AirPlay 无法枚举本机可投的设备清单，getAvAudioSessionRoutes 只是“当前音频会话路由”，
      // 不能当作可浏览的设备列表。这里仅用一个固定入口表示“存在可用的 AirPlay 目标”，
      // 点击后由系统弹出 AirPlay 路由选择器（showRoutePicker）让用户选择具体设备。
      return [
        {
          id: 'airplay-system',
          name: 'AirPlay',
          protocol: 'airplay' as const,
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
  const mod = await getAirplayModule();
  if (!mod) throw new Error('AirPlay module not available');
  // 仅调起系统 AirPlay 路由选择器，把“正在本地播放的内容”路由到所选的 Apple TV/设备。
  // 系统限制了无法通过 API 直接指定目标或传输 URL，也无法编程断开已建立的 AirPlay 路由。
  await mod.showRoutePicker({ prioritizesVideoDevices: true });
}

export async function stopAirplay(): Promise<void> {
  // AirPlay 路由由系统控制，SDK 不提供编程断开；断开动作由用户通过系统控制中心完成。
  // 此处为空实现以对齐停播语义。
  if (Platform.OS !== 'ios') return;
}

export async function checkAirplayConnectivity(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    const mod = await getAirplayModule();
    if (!mod) return false;
    return !!mod.getExternalPlaybackAvailability();
  } catch {
    return false;
  }
}
