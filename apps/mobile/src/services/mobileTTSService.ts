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
      const TtsModule = require('react-native-tts');
      const Tts = TtsModule.default || TtsModule;
      
      if (!Tts) {
        console.warn('react-native-tts module not available');
        return false;
      }
      
      this.tts = Tts;
      
      try {
        await this.tts.getInitStatus();
      } catch (e) {
        console.warn('TTS getInitStatus failed, trying to continue:', e);
      }
      
      try {
        await this.tts.setDefaultLanguage(this.language);
      } catch (e) {
        console.warn('TTS setDefaultLanguage failed:', e);
      }
      
      try {
        await this.tts.setDefaultRate(this.rate);
      } catch (e) {
        console.warn('TTS setDefaultRate failed:', e);
      }
      
      try {
        await this.tts.setDefaultPitch(this.pitch);
      } catch (e) {
        console.warn('TTS setDefaultPitch failed:', e);
      }

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
    if (!this.isInitialized || !this.tts) {
      console.warn('TTS Service not initialized');
      return;
    }

    try {
      await this.tts.speak(text, {
        iosVoiceId: '',
        rate: options?.rate || this.rate,
        androidParams: {
          KEY_PARAM_STREAM: 'STREAM_MUSIC',
          KEY_PARAM_VOLUME: options?.volume || this.volume,
          KEY_PARAM_PAN: 0,
        },
      });
    } catch (error) {
      console.error('Failed to speak:', error);
    }
  }

  stop(): void {
    if (this.tts) {
      try { this.tts.stop(); } catch (e) { /* ignore */ }
    }
  }

  pause(): void {
    if (this.tts) {
      try { this.tts.pause(); } catch (e) { /* ignore */ }
    }
  }

  resume(): void {
    if (this.tts) {
      try { this.tts.resume(); } catch (e) { /* ignore */ }
    }
  }

  setLanguage(language: string): void {
    this.language = language;
    if (this.tts) {
      try { this.tts.setDefaultLanguage(language); } catch (e) { /* ignore */ }
    }
  }

  setRate(rate: number): void {
    this.rate = Math.max(0.1, Math.min(2.0, rate));
    if (this.tts) {
      try { this.tts.setDefaultRate(this.rate); } catch (e) { /* ignore */ }
    }
  }

  setPitch(pitch: number): void {
    this.pitch = Math.max(0.5, Math.min(2.0, pitch));
    if (this.tts) {
      try { this.tts.setDefaultPitch(this.pitch); } catch (e) { /* ignore */ }
    }
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1.0, volume));
  }

  async isAvailable(): Promise<boolean> {
    if (!this.tts) return false;
    try {
      const voices = await this.tts.voices();
      return voices && voices.length > 0;
    } catch (error) {
      return false;
    }
  }

  dispose(): void {
    if (this.tts) {
      try { this.tts.stop(); } catch (e) { /* ignore */ }
    }
    this.isInitialized = false;
  }
}
