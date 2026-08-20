/**
 * 唤醒词检测服务
 * 抽象接口，具体实现在移动端
 */

import type { WakeWordDetectionResult, WakeWordState } from '../types/voice';

/**
 * 唤醒词检测回调
 */
export type WakeWordCallback = (result: WakeWordDetectionResult) => void;

/**
 * 状态变化回调
 */
export type StateChangeCallback = (state: WakeWordState) => void;

/**
 * 唤醒词检测服务接口
 */
export interface IWakeWordService {
  /**
   * 初始化唤醒词检测器
   */
  initialize(modelPaths: {
    melspectrogram: string;
    embedding: string;
    wakeWord: string;
  }): Promise<boolean>;

  /**
   * 开始监听唤醒词
   */
  startListening(): Promise<void>;

  /**
   * 停止监听唤醒词
   */
  stopListening(): Promise<void>;

  /**
   * 设置唤醒词检测阈值
   */
  setThreshold(threshold: number): void;

  /**
   * 重置检测器状态
   */
  reset(): void;

  /**
   * 获取当前状态
   */
  getState(): WakeWordState;

  /**
   * 注册唤醒词检测回调
   */
  onWakeWordDetected(callback: WakeWordCallback): void;

  /**
   * 注册状态变化回调
   */
  onStateChange(callback: StateChangeCallback): void;

  /**
   * 移除唤醒词检测回调
   */
  offWakeWordDetected(callback: WakeWordCallback): void;

  /**
   * 移除状态变化回调
   */
  offStateChange(callback: StateChangeCallback): void;

  /**
   * 释放资源
   */
  dispose(): void;
}

/**
 * 唤醒词检测服务的内存实现
 * 用于测试和桌面端
 */
export class InMemoryWakeWordService implements IWakeWordService {
  private state: WakeWordState = 'idle';
  private threshold: number = 0.7;
  private wakeWordCallbacks: WakeWordCallback[] = [];
  private stateChangeCallbacks: StateChangeCallback[] = [];

  async initialize(modelPaths: {
    melspectrogram: string;
    embedding: string;
    wakeWord: string;
  }): Promise<boolean> {
    console.log('WakeWordService initialized (in-memory)');
    return true;
  }

  async startListening(): Promise<void> {
    this.setState('listening');
    console.log('WakeWordService started listening');
  }

  async stopListening(): Promise<void> {
    this.setState('idle');
    console.log('WakeWordService stopped listening');
  }

  setThreshold(threshold: number): void {
    this.threshold = threshold;
    console.log(`WakeWordService threshold set to ${threshold}`);
  }

  reset(): void {
    this.setState('idle');
    console.log('WakeWordService reset');
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
   * 模拟唤醒词检测（用于测试）
   */
  simulateWakeWordDetection(probability: number = 0.9): void {
    if (this.state !== 'listening') {
      return;
    }

    if (probability >= this.threshold) {
      const result: WakeWordDetectionResult = {
        detected: true,
        probability,
        timestamp: Date.now(),
      };

      this.setState('wakeword_detected');
      this.notifyWakeWordDetected(result);
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
