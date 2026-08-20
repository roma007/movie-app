/**
 * 语音识别服务
 * 将语音转换为文本
 */

import type { VoiceRecognitionResult } from '../types/voice';

/**
 * 语音识别结果回调
 */
export type RecognitionCallback = (result: VoiceRecognitionResult) => void;

/**
 * 语音识别服务接口
 */
export interface ISpeechRecognitionService {
  /**
   * 初始化语音识别服务
   */
  initialize(): Promise<boolean>;

  /**
   * 开始监听语音
   */
  startListening(): Promise<void>;

  /**
   * 停止监听语音
   */
  stopListening(): Promise<void>;

  /**
   * 识别音频数据
   */
  recognize(audioData: ArrayBuffer): Promise<VoiceRecognitionResult>;

  /**
   * 设置识别语言
   */
  setLanguage(language: string): void;

  /**
   * 注册识别结果回调
   */
  onRecognitionResult(callback: RecognitionCallback): void;

  /**
   * 移除识别结果回调
   */
  offRecognitionResult(callback: RecognitionCallback): void;

  /**
   * 释放资源
   */
  dispose(): void;
}

/**
 * 语音识别服务的内存实现
 * 用于测试和桌面端
 */
export class InMemorySpeechRecognitionService implements ISpeechRecognitionService {
  private language: string = 'zh-CN';
  private recognitionCallbacks: RecognitionCallback[] = [];
  private isListening: boolean = false;

  async initialize(): Promise<boolean> {
    console.log('SpeechRecognitionService initialized (in-memory)');
    return true;
  }

  async startListening(): Promise<void> {
    this.isListening = true;
    console.log('SpeechRecognitionService started listening');
  }

  async stopListening(): Promise<void> {
    this.isListening = false;
    console.log('SpeechRecognitionService stopped listening');
  }

  async recognize(): Promise<VoiceRecognitionResult> {
    // 内存实现：返回模拟结果
    return {
      text: '',
      confidence: 0,
      isOffline: true,
      language: this.language,
    };
  }

  setLanguage(language: string): void {
    this.language = language;
    console.log(`SpeechRecognitionService language set to ${language}`);
  }

  onRecognitionResult(callback: RecognitionCallback): void {
    this.recognitionCallbacks.push(callback);
  }

  offRecognitionResult(callback: RecognitionCallback): void {
    const index = this.recognitionCallbacks.indexOf(callback);
    if (index > -1) {
      this.recognitionCallbacks.splice(index, 1);
    }
  }

  dispose(): void {
    this.recognitionCallbacks = [];
    this.isListening = false;
  }

  /**
   * 模拟语音识别（用于测试）
   */
  simulateRecognition(text: string, confidence: number = 0.9): void {
    if (!this.isListening) {
      return;
    }

    const result: VoiceRecognitionResult = {
      text,
      confidence,
      isOffline: true,
      language: this.language,
    };

    this.notifyRecognitionResult(result);
  }

  private notifyRecognitionResult(result: VoiceRecognitionResult): void {
    for (const callback of this.recognitionCallbacks) {
      try {
        callback(result);
      } catch (error) {
        console.error('Error in recognition callback:', error);
      }
    }
  }
}
