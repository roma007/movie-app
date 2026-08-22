/**
 * 全局唤醒词监听服务
 * 在应用启动时开始监听，说"小MM"即可唤醒语音控制
 */

import { AppState, AppStateStatus } from 'react-native';
import { getVoiceControlSystem } from '@movie-app/core';

/**
 * 唤醒词检测回调
 */
export type WakeWordDetectedCallback = () => void;

/**
 * 全局唤醒词监听器状态
 */
type ListenerState = 'stopped' | 'listening' | 'paused';

/**
 * 全局唤醒词监听服务
 */
export class GlobalWakeWordListener {
  private state: ListenerState = 'stopped';
  private callbacks: WakeWordDetectedCallback[] = [];
  private appStateSubscription: any = null;
  private lastAppState: AppStateStatus = 'active';

  constructor() {
    this.setupAppStateListener();
  }

  /**
   * 开始全局监听
   */
  start(): void {
    if (this.state === 'listening') {
      console.log('[GlobalWakeWordListener] Already listening');
      return;
    }

    console.log('[GlobalWakeWordListener] Starting global wake word listener');
    this.state = 'listening';
    this.startWakeWordDetection();
  }

  /**
   * 停止监听
   */
  stop(): void {
    if (this.state === 'stopped') {
      return;
    }

    console.log('[GlobalWakeWordListener] Stopping global wake word listener');
    this.state = 'stopped';
    this.stopWakeWordDetection();
  }

  /**
   * 暂停监听（应用进入后台）
   */
  pause(): void {
    if (this.state !== 'listening') {
      return;
    }

    console.log('[GlobalWakeWordListener] Pausing wake word listener');
    this.state = 'paused';
    this.stopWakeWordDetection();
  }

  /**
   * 恢复监听（应用回到前台）
   */
  resume(): void {
    if (this.state !== 'paused') {
      return;
    }

    console.log('[GlobalWakeWordListener] Resuming wake word listener');
    this.state = 'listening';
    this.startWakeWordDetection();
  }

  /**
   * 注册唤醒词检测回调
   */
  onWakeWordDetected(callback: WakeWordDetectedCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * 移除唤醒词检测回调
   */
  offWakeWordDetected(callback: WakeWordDetectedCallback): void {
    const index = this.callbacks.indexOf(callback);
    if (index > -1) {
      this.callbacks.splice(index, 1);
    }
  }

  /**
   * 获取当前状态
   */
  getState(): ListenerState {
    return this.state;
  }

  /**
   * 清理资源
   */
  dispose(): void {
    this.stop();
    this.callbacks = [];
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
  }

  /**
   * 设置应用状态监听
   */
  private setupAppStateListener(): void {
    this.appStateSubscription = AppState.addEventListener(
      'change',
      this.handleAppStateChange.bind(this)
    );
  }

  /**
   * 处理应用状态变化
   */
  private handleAppStateChange(nextAppState: AppStateStatus): void {
    if (
      this.lastAppState === 'active' &&
      nextAppState.match(/inactive|background/)
    ) {
      // 应用进入后台，暂停监听
      this.pause();
    } else if (
      this.lastAppState.match(/inactive|background/) &&
      nextAppState === 'active'
    ) {
      // 应用回到前台，恢复监听
      this.resume();
    }

    this.lastAppState = nextAppState;
  }

  /**
   * 启动唤醒词检测
   */
  private startWakeWordDetection(): void {
    try {
      const voiceControl = getVoiceControlSystem();
      
      // 注册唤醒词检测回调
      voiceControl.on('*', (event) => {
        if (event.type === 'wake_word_detected') {
          this.notifyWakeWordDetected();
        }
      });

      // 启动唤醒词监听
      voiceControl.setWakeWordEnabled(true);
      
      console.log('[GlobalWakeWordListener] Wake word detection started');
    } catch (error) {
      console.error('[GlobalWakeWordListener] Failed to start wake word detection:', error);
    }
  }

  /**
   * 停止唤醒词检测
   */
  private stopWakeWordDetection(): void {
    try {
      const voiceControl = getVoiceControlSystem();
      voiceControl.setWakeWordEnabled(false);
      
      console.log('[GlobalWakeWordListener] Wake word detection stopped');
    } catch (error) {
      console.error('[GlobalWakeWordListener] Failed to stop wake word detection:', error);
    }
  }

  /**
   * 通知唤醒词检测回调
   */
  private notifyWakeWordDetected(): void {
    console.log('[GlobalWakeWordListener] Wake word detected!');
    
    for (const callback of this.callbacks) {
      try {
        callback();
      } catch (error) {
        console.error('[GlobalWakeWordListener] Error in wake word callback:', error);
      }
    }
  }
}

/**
 * 全局唤醒词监听器单例
 */
let globalListener: GlobalWakeWordListener | null = null;

/**
 * 获取全局唤醒词监听器
 */
export function getGlobalWakeWordListener(): GlobalWakeWordListener {
  if (!globalListener) {
    globalListener = new GlobalWakeWordListener();
  }
  return globalListener;
}
