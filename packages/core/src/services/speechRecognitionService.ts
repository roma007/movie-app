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
   * 是否正在监听
   */
  isListening(): boolean;

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
   * 注册识别结果回调（partial + final 都会触发）
   */
  onRecognitionResult(callback: RecognitionCallback): void;

  /**
   * 移除识别结果回调
   */
  offRecognitionResult(callback: RecognitionCallback): void;

  /**
   * 注册最终识别结果回调（仅 final，用于命令解析）
   */
  onFinalResult(callback: RecognitionCallback): void;

  /**
   * 移除最终识别结果回调
   */
  offFinalResult(callback: RecognitionCallback): void;

  /**
   * 监听超时回调
   */
  onListeningTimeout(callback: () => void): void;

  /**
   * 移除监听超时回调
   */
  offListeningTimeout(callback: () => void): void;

  /**
   * 释放资源
   */
  dispose(): void;
}

/**
 * 语音识别服务的内存实现
 */
export class InMemorySpeechRecognitionService implements ISpeechRecognitionService {
  private language: string = 'zh-CN';
  private recognitionCallbacks: RecognitionCallback[] = [];
  private finalResultCallbacks: RecognitionCallback[] = [];
  private listeningTimeoutCallbacks: Array<() => void> = [];
  private listening: boolean = false;

  async initialize(): Promise<boolean> {
    return true;
  }

  isListening(): boolean {
    return this.listening;
  }

  async startListening(): Promise<void> {
    this.listening = true;
  }

  async stopListening(): Promise<void> {
    this.listening = false;
  }

  async recognize(): Promise<VoiceRecognitionResult> {
    return { text: '', confidence: 0, isOffline: true, language: this.language };
  }

  setLanguage(language: string): void {
    this.language = language;
  }

  onRecognitionResult(callback: RecognitionCallback): void {
    this.recognitionCallbacks.push(callback);
  }

  offRecognitionResult(callback: RecognitionCallback): void {
    const index = this.recognitionCallbacks.indexOf(callback);
    if (index > -1) this.recognitionCallbacks.splice(index, 1);
  }

  onFinalResult(callback: RecognitionCallback): void {
    this.finalResultCallbacks.push(callback);
  }

  offFinalResult(callback: RecognitionCallback): void {
    const index = this.finalResultCallbacks.indexOf(callback);
    if (index > -1) this.finalResultCallbacks.splice(index, 1);
  }

  onListeningTimeout(callback: () => void): void {
    this.listeningTimeoutCallbacks.push(callback);
  }

  offListeningTimeout(callback: () => void): void {
    const index = this.listeningTimeoutCallbacks.indexOf(callback);
    if (index > -1) this.listeningTimeoutCallbacks.splice(index, 1);
  }

  dispose(): void {
    this.recognitionCallbacks = [];
    this.finalResultCallbacks = [];
    this.listeningTimeoutCallbacks = [];
    this.listening = false;
  }
}
