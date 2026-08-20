/**
 * 移动端唤醒词检测服务实现
 * 使用 react-native-openwakeword
 */

import type { IWakeWordService } from '@movie-app/core';
import type { WakeWordDetectionResult, WakeWordState } from '@movie-app/core';

/**
 * 唤醒词检测回调
 */
export type WakeWordCallback = (result: WakeWordDetectionResult) => void;

/**
 * 状态变化回调
 */
export type StateChangeCallback = (state: WakeWordState) => void;

/**
 * 移动端唤醒词检测服务
 */
export class MobileWakeWordService implements IWakeWordService {
  private state: WakeWordState = 'idle';
  private threshold: number = 0.7;
  private wakeWordCallbacks: WakeWordCallback[] = [];
  private stateChangeCallbacks: StateChangeCallback[] = [];
  private wakeWordInstance: any = null;
  private isInitialized: boolean = false;

  async initialize(modelPaths: {
    melspectrogram: string;
    embedding: string;
    wakeWord: string;
  }): Promise<boolean> {
    try {
      // 动态导入 react-native-openwakeword
      const OpenWakeWord = require('react-native-openwakeword');
      
      // 初始化唤醒词检测器
      this.wakeWordInstance = new OpenWakeWord.default();
      
      // 加载模型
      // 注意：实际使用时需要提供正确的模型路径
      // 这里假设模型已经打包到assets中
      await this.wakeWordInstance.loadModel({
        melspectrogram: modelPaths.melspectrogram,
        embedding: modelPaths.embedding,
        wakeWord: modelPaths.wakeWord,
      });

      this.isInitialized = true;
      console.log('MobileWakeWordService initialized successfully');
      return true;
    } catch (error) {
      console.error('Failed to initialize MobileWakeWordService:', error);
      return false;
    }
  }

  async startListening(): Promise<void> {
    if (!this.isInitialized) {
      console.warn('WakeWordService not initialized');
      return;
    }

    try {
      this.setState('listening');
      
      // 开始监听唤醒词
      this.wakeWordInstance.on('wakeWordDetected', (result: any) => {
        this.handleWakeWordDetected(result);
      });

      await this.wakeWordInstance.start();
      console.log('MobileWakeWordService started listening');
    } catch (error) {
      console.error('Failed to start listening:', error);
      this.setState('error');
    }
  }

  async stopListening(): Promise<void> {
    try {
      if (this.wakeWordInstance) {
        await this.wakeWordInstance.stop();
      }
      this.setState('idle');
      console.log('MobileWakeWordService stopped listening');
    } catch (error) {
      console.error('Failed to stop listening:', error);
    }
  }

  setThreshold(threshold: number): void {
    this.threshold = threshold;
    console.log(`MobileWakeWordService threshold set to ${threshold}`);
  }

  reset(): void {
    this.setState('idle');
    console.log('MobileWakeWordService reset');
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
    if (this.wakeWordInstance) {
      this.wakeWordInstance.destroy();
    }
    this.setState('idle');
  }

  /**
   * 处理唤醒词检测
   */
  private handleWakeWordDetected(result: any): void {
    const detectionResult: WakeWordDetectionResult = {
      detected: true,
      probability: result.probability || 0.9,
      timestamp: Date.now(),
    };

    if (detectionResult.probability >= this.threshold) {
      this.setState('wakeword_detected');
      this.notifyWakeWordDetected(detectionResult);
    }
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
