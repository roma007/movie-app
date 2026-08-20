/**
 * 移动端语音识别服务实现
 * 使用 expo-speech-transcriber
 */

import type { ISpeechRecognitionService } from '@movie-app/core';
import type { VoiceRecognitionResult } from '@movie-app/core';

/**
 * 语音识别结果回调
 */
export type RecognitionCallback = (result: VoiceRecognitionResult) => void;

/**
 * 移动端语音识别服务
 */
export class MobileSpeechRecognitionService implements ISpeechRecognitionService {
  private language: string = 'zh-CN';
  private recognitionCallbacks: RecognitionCallback[] = [];
  private isListening: boolean = false;
  private speechTranscriber: any = null;
  private isInitialized: boolean = false;

  async initialize(): Promise<boolean> {
    try {
      // 动态导入 expo-speech-transcriber
      const SpeechTranscriber = require('expo-speech-transcriber');
      
      this.speechTranscriber = SpeechTranscriber;
      
      // 检查权限
      const { status } = await SpeechTranscriber.requestPermissionsAsync();
      if (status !== 'granted') {
        console.error('Speech recognition permission denied');
        return false;
      }

      this.isInitialized = true;
      console.log('MobileSpeechRecognitionService initialized successfully');
      return true;
    } catch (error) {
      console.error('Failed to initialize MobileSpeechRecognitionService:', error);
      return false;
    }
  }

  async startListening(): Promise<void> {
    if (!this.isInitialized) {
      console.warn('SpeechRecognitionService not initialized');
      return;
    }

    try {
      this.isListening = true;

      // 开始监听
      await this.speechTranscriber.start({
        language: this.language,
        interimResults: true,
      });

      // 监听识别结果
      this.speechTranscriber.onResult((result: any) => {
        if (result.isFinal) {
          this.handleRecognitionResult(result.text, result.confidence || 0.9);
        }
      });

      // 监听错误
      this.speechTranscriber.onError((error: any) => {
        console.error('Speech recognition error:', error);
        this.isListening = false;
      });

      // 监听结束
      this.speechTranscriber.onEnd(() => {
        this.isListening = false;
      });

      console.log('MobileSpeechRecognitionService started listening');
    } catch (error) {
      console.error('Failed to start listening:', error);
      this.isListening = false;
    }
  }

  async stopListening(): Promise<void> {
    if (!this.isInitialized || !this.isListening) {
      return;
    }

    try {
      await this.speechTranscriber.stop();
      this.isListening = false;
      console.log('MobileSpeechRecognitionService stopped listening');
    } catch (error) {
      console.error('Failed to stop listening:', error);
    }
  }

  async recognize(): Promise<VoiceRecognitionResult> {
    // 这个方法在移动端不常用，因为我们使用startListening/stopListening
    return {
      text: '',
      confidence: 0,
      isOffline: true,
      language: this.language,
    };
  }

  setLanguage(language: string): void {
    this.language = language;
    console.log(`MobileSpeechRecognitionService language set to ${language}`);
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
    if (this.speechTranscriber) {
      this.speechTranscriber.destroy();
    }
  }

  /**
   * 处理识别结果
   */
  private handleRecognitionResult(text: string, confidence: number): void {
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
