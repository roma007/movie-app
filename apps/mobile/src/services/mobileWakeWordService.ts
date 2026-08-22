/**
 * 移动端唤醒词检测服务实现
 * 使用 react-native-openwakeword（如果可用），否则降级为按钮触发模式
 */

import type { IWakeWordService } from '@movie-app/core';
import type { WakeWordDetectionResult, WakeWordState } from '@movie-app/core';

export type WakeWordCallback = (result: WakeWordDetectionResult) => void;
export type StateChangeCallback = (state: WakeWordState) => void;

/**
 * 移动端唤醒词检测服务
 * 
 * 当 react-native-openwakeword / NitroModules 不可用时，降级为按钮触发模式：
 * - startListening → 直接切换到 'listening' 状态（无实际唤醒词检测）
 * - 外部通过按钮触发 startListening → 手动调用 handleWakeWordDetected()
 */
export class MobileWakeWordService implements IWakeWordService {
  private state: WakeWordState = 'idle';
  private threshold: number = 0.7;
  private wakeWordCallbacks: WakeWordCallback[] = [];
  private stateChangeCallbacks: StateChangeCallback[] = [];
  private openwakeword: any = null;
  private wakeWordDetector: any = null;
  private isInitialized: boolean = false;
  private wakeWordAvailable: boolean = false;

  async initialize(modelPaths: {
    melspectrogram: string;
    embedding: string;
    wakeWord: string;
  }): Promise<boolean> {
    try {
      const { Openwakeword } = require('react-native-openwakeword');
      
      if (!Openwakeword || typeof Openwakeword.createDetector !== 'function') {
        console.warn('react-native-openwakeword not available, using button-only mode');
        this.isInitialized = true;
        this.wakeWordAvailable = false;
        return true;
      }
      
      this.openwakeword = Openwakeword;
      
      try {
        this.wakeWordDetector = await this.openwakeword.createDetector({
          melspectrogram: modelPaths.melspectrogram,
          embedding: modelPaths.embedding,
          wakeWord: modelPaths.wakeWord,
        });
        this.wakeWordAvailable = true;
        console.log('MobileWakeWordService initialized with wake word detection');
      } catch (e) {
        console.warn('Wake word model loading failed, using button-only mode:', e);
        this.wakeWordAvailable = false;
      }

      this.isInitialized = true;
      return true;
    } catch (error) {
      console.warn('react-native-openwakeword not available, using button-only mode:', error);
      this.isInitialized = true;
      this.wakeWordAvailable = false;
      return true;
    }
  }

  async startListening(): Promise<void> {
    if (!this.isInitialized) {
      console.warn('WakeWordService not initialized');
      return;
    }

    try {
      this.setState('listening');
      
      if (this.wakeWordAvailable && this.wakeWordDetector) {
        // TODO: 使用真实唤醒词检测器监听
        // wakeWordDetector 会在检测到唤醒词时触发回调
        console.log('Wake word detection started (native)');
      } else {
        console.log('Wake word detection started (button-only mode)');
      }
    } catch (error) {
      console.error('Failed to start listening:', error);
      this.setState('error');
    }
  }

  async stopListening(): Promise<void> {
    try {
      this.setState('idle');
      console.log('MobileWakeWordService stopped listening');
    } catch (error) {
      console.error('Failed to stop listening:', error);
    }
  }

  setThreshold(threshold: number): void {
    this.threshold = threshold;
  }

  reset(): void {
    this.setState('idle');
  }

  getState(): WakeWordState {
    return this.state;
  }

  onWakeWordDetected(callback: WakeWordCallback): void {
    this.wakeWordCallbacks.push(callback);
  }

  onStateChange(callback: StateChangeCallback): void {
    this.stateChangeCallbacks.push(callback);
  }

  offWakeWordDetected(callback: WakeWordCallback): void {
    const index = this.wakeWordCallbacks.indexOf(callback);
    if (index > -1) {
      this.wakeWordCallbacks.splice(index, 1);
    }
  }

  offStateChange(callback: StateChangeCallback): void {
    const index = this.stateChangeCallbacks.indexOf(callback);
    if (index > -1) {
      this.stateChangeCallbacks.splice(index, 1);
    }
  }

  dispose(): void {
    this.wakeWordCallbacks = [];
    this.stateChangeCallbacks = [];
    this.setState('idle');
  }

  /**
   * 手动触发唤醒词检测（按钮模式）
   */
  handleWakeWordDetected(probability: number = 0.9): void {
    if (probability >= this.threshold) {
      this.setState('wakeword_detected');
      this.notifyWakeWordDetected({
        detected: true,
        probability,
        timestamp: Date.now(),
      });
    }
  }

  isWakeWordAvailable(): boolean {
    return this.wakeWordAvailable;
  }

  private setState(newState: WakeWordState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.notifyStateChange(newState);
    }
  }

  private notifyWakeWordDetected(result: WakeWordDetectionResult): void {
    for (const callback of this.wakeWordCallbacks) {
      try {
        callback(result);
      } catch (error) {
        console.error('Error in wake word callback:', error);
      }
    }
  }

  private notifyStateChange(state: WakeWordState): void {
    for (const callback of this.stateChangeCallbacks) {
      try {
        callback(state);
      } catch (error) {
        console.error('Error in state change callback:', error);
      }
    }
  }
}
