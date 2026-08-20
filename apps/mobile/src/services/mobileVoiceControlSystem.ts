/**
 * 移动端语音控制系统初始化
 * 使用真实的服务实现
 */

import { 
  VoiceControlSystem, 
  type VoiceControlConfig,
  type VoiceControlDependencies,
  setGlobalVoiceControlSystem 
} from '@movie-app/core';
import { MobileWakeWordService } from './mobileWakeWordService';
import { MobileSpeechRecognitionService } from './mobileSpeechRecognitionService';
import { MobileTTSService } from './mobileTTSService';

/**
 * 创建移动端语音控制系统
 */
export function createMobileVoiceControlSystem(config?: Partial<VoiceControlConfig>): VoiceControlSystem {
  // 创建移动端服务实例
  const dependencies: VoiceControlDependencies = {
    wakeWordService: new MobileWakeWordService(),
    speechRecognitionService: new MobileSpeechRecognitionService(),
    ttsService: new MobileTTSService(),
  };

  // 创建语音控制系统
  const system = new VoiceControlSystem(config, dependencies);

  return system;
}

/**
 * 初始化移动端语音控制系统
 */
export async function initializeMobileVoiceControl(config?: Partial<VoiceControlConfig>): Promise<VoiceControlSystem> {
  const system = createMobileVoiceControlSystem(config);
  await system.initialize();
  
  // 设置为全局系统
  setGlobalVoiceControlSystem(system);
  
  return system;
}
