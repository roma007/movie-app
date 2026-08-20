/**
 * 移动端TTS服务实现
 * 使用 react-native-tts
 */

import type { ITTSService } from '@movie-app/core';

/**
 * 移动端TTS服务
 */
export class MobileTTSService implements ITTSService {
  private language: string = 'zh-CN';
  private rate: number = 1.0;
  private pitch: number = 1.0;
  private volume: number = 1.0;
  private tts: any = null;
  private isInitialized: boolean = false;

  async initialize(): Promise<boolean> {
    try {
      // 动态导入 react-native-tts
      const Tts = require('react-native-tts');
      
      this.tts = Tts;
      
      // 初始化TTS
      await this.tts.init();
      
      // 设置默认语言
      await this.tts.setDefaultLanguage(this.language);
      
      // 设置默认语速
      await this.tts.setDefaultRate(this.rate);
      
      // 设置默认音调
      await this.tts.setDefaultPitch(this.pitch);

      this.isInitialized = true;
      console.log('MobileTTSService initialized successfully');
      return true;
    } catch (error) {
      console.error('Failed to initialize MobileTTSService:', error);
      return false;
    }
  }

  async speak(text: string, options?: {
    language?: string;
    pitch?: number;
    rate?: number;
    volume?: number;
  }): Promise<void> {
    if (!this.isInitialized) {
      console.warn('TTS Service not initialized');
      return;
    }

    try {
      await this.tts.speak(text, {
        language: options?.language || this.language,
        pitch: options?.pitch || this.pitch,
        rate: options?.rate || this.rate,
        volume: options?.volume || this.volume,
      });
    } catch (error) {
      console.error('Failed to speak:', error);
    }
  }

  stop(): void {
    if (this.tts) {
      this.tts.stop();
    }
  }

  pause(): void {
    if (this.tts) {
      this.tts.pause();
    }
  }

  resume(): void {
    if (this.tts) {
      this.tts.resume();
    }
  }

  setLanguage(language: string): void {
    this.language = language;
    if (this.tts) {
      this.tts.setDefaultLanguage(language);
    }
    console.log(`MobileTTSService language set to ${language}`);
  }

  setRate(rate: number): void {
    this.rate = Math.max(0.1, Math.min(2.0, rate));
    if (this.tts) {
      this.tts.setDefaultRate(this.rate);
    }
    console.log(`MobileTTSService rate set to ${this.rate}`);
  }

  setPitch(pitch: number): void {
    this.pitch = Math.max(0.5, Math.min(2.0, pitch));
    if (this.tts) {
      this.tts.setDefaultPitch(this.pitch);
    }
    console.log(`MobileTTSService pitch set to ${this.pitch}`);
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1.0, volume));
    // react-native-tts 可能不支持直接设置音量
    console.log(`MobileTTSService volume set to ${this.volume}`);
  }

  async isAvailable(): Promise<boolean> {
    if (!this.tts) {
      return false;
    }

    try {
      const voices = await this.tts.voices();
      return voices.length > 0;
    } catch (error) {
      console.error('Failed to check TTS availability:', error);
      return false;
    }
  }

  dispose(): void {
    if (this.tts) {
      this.tts.stop();
    }
    this.isInitialized = false;
  }
}
