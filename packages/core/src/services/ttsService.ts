/**
 * 语音反馈服务（TTS）
 * 将文本转换为语音，用于语音控制的反馈
 */

import type { VoiceControlConfig } from '../types/voice';

/**
 * TTS 服务接口
 */
export interface ITTSService {
  /**
   * 初始化 TTS 服务
   */
  initialize(): Promise<boolean>;

  /**
   * 朗读文本
   */
  speak(text: string, options?: {
    language?: string;
    pitch?: number;
    rate?: number;
    volume?: number;
  }): Promise<void>;

  /**
   * 停止朗读
   */
  stop(): void;

  /**
   * 暂停朗读
   */
  pause(): void;

  /**
   * 恢复朗读
   */
  resume(): void;

  /**
   * 设置语言
   */
  setLanguage(language: string): void;

  /**
   * 设置语速
   */
  setRate(rate: number): void;

  /**
   * 设置音调
   */
  setPitch(pitch: number): void;

  /**
   * 设置音量
   */
  setVolume(volume: number): void;

  /**
   * 检查 TTS 是否可用
   */
  isAvailable(): Promise<boolean>;

  /**
   * 释放资源
   */
  dispose(): void;
}

/**
 * 内存 TTS 服务实现
 * 用于测试和桌面端（无语音输出）
 */
export class InMemoryTTSService implements ITTSService {
  private language: string = 'zh-CN';
  private rate: number = 1.0;
  private pitch: number = 1.0;
  private volume: number = 1.0;
  private isSpeaking: boolean = false;

  async initialize(): Promise<boolean> {
    console.log('TTS Service initialized (in-memory)');
    return true;
  }

  async speak(text: string, options?: {
    language?: string;
    pitch?: number;
    rate?: number;
    volume?: number;
  }): Promise<void> {
    if (this.isSpeaking) {
      this.stop();
    }

    this.isSpeaking = true;

    // 模拟朗读延迟
    const speakDuration = Math.min(text.length * 100, 2000);
    
    console.log(`[TTS] Speaking: "${text}" (language: ${options?.language || this.language}, rate: ${options?.rate || this.rate})`);
    
    return new Promise((resolve) => {
      setTimeout(() => {
        this.isSpeaking = false;
        resolve();
      }, speakDuration);
    });
  }

  stop(): void {
    this.isSpeaking = false;
    console.log('[TTS] Stopped');
  }

  pause(): void {
    if (this.isSpeaking) {
      console.log('[TTS] Paused');
    }
  }

  resume(): void {
    console.log('[TTS] Resumed');
  }

  setLanguage(language: string): void {
    this.language = language;
    console.log(`[TTS] Language set to: ${language}`);
  }

  setRate(rate: number): void {
    this.rate = Math.max(0.1, Math.min(2.0, rate));
    console.log(`[TTS] Rate set to: ${this.rate}`);
  }

  setPitch(pitch: number): void {
    this.pitch = Math.max(0.5, Math.min(2.0, pitch));
    console.log(`[TTS] Pitch set to: ${this.pitch}`);
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1.0, volume));
    console.log(`[TTS] Volume set to: ${this.volume}`);
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  dispose(): void {
    this.stop();
    console.log('[TTS] Disposed');
  }
}

/**
 * 预定义的语音反馈消息
 */
export const VOICE_FEEDBACK_MESSAGES = {
  // 唤醒相关
  WAKE_WORD_DETECTED: '我在听',
  WAKE_WORD_TIMEOUT: '未检测到指令',
  
  // 播放控制
  PAUSE_PLAYBACK: '已暂停',
  RESUME_PLAYBACK: '继续播放',
  FAST_FORWARD: (seconds: number) => `快进${seconds}秒`,
  REWIND: (seconds: number) => `快退${seconds}秒`,
  VOLUME_UP: '音量已增加',
  VOLUME_DOWN: '音量已减少',
  MUTE: '已静音',
  UNMUTE: '已取消静音',
  FULLSCREEN_ON: '已进入全屏',
  FULLSCREEN_OFF: '已退出全屏',
  
  // 搜索
  SEARCHING: (keyword: string) => `正在搜索: ${keyword}`,
  SEARCH_NOT_FOUND: '未找到相关内容',
  
  // 列表操作
  NEXT_PAGE: '下一页',
  PREVIOUS_PAGE: '上一页',
  GO_TO_PAGE: (page: number) => `第${page}页`,
  
  // 采集
  START_COLLECT: '开始采集',
  STOP_COLLECT: '停止采集',
  COLLECT_COMPLETE: '采集完成',
  COLLECT_ERROR: '采集出错',
  
  // 设置
  OPEN_SETTINGS: '进入设置',
  VOICE_CONTROL_ON: '语音控制已开启',
  VOICE_CONTROL_OFF: '语音控制已关闭',
  TTS_ON: '语音反馈已开启',
  TTS_OFF: '语音反馈已关闭',
  
  // 导航
  GO_HOME: '返回首页',
  GO_BACK: '返回上一页',
  
  // 错误
  COMMAND_NOT_RECOGNIZED: '未识别的指令',
  SERVICE_UNAVAILABLE: '服务不可用',
} as const;

/**
 * 创建 TTS 服务实例
 */
export function createTTSService(): ITTSService {
  return new InMemoryTTSService();
}
