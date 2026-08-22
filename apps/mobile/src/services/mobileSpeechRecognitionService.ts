/**
 * 移动端语音识别服务实现
 * 使用 react-native-vosk（纯离线识别）
 *
 * 设计要点：
 * - onPartialResult → 只触发 onRecognitionResult（UI 实时显示文本）
 * - onResult（final）→ 触发 onRecognitionResult + onFinalResult（命令解析）
 * - 不主动重启 Vosk，由 voiceControlSystem 统一管理
 * - startGeneration 计数器防止过期重启竞态
 */

import type { ISpeechRecognitionService } from '@movie-app/core';
import type { VoiceRecognitionResult } from '@movie-app/core';

export type RecognitionCallback = (result: VoiceRecognitionResult) => void;

export class MobileSpeechRecognitionService implements ISpeechRecognitionService {
  private language: string = 'zh-CN';
  private recognitionCallbacks: RecognitionCallback[] = [];
  private finalResultCallbacks: RecognitionCallback[] = [];
  private listeningTimeoutCallbacks: Array<() => void> = [];
  private listening: boolean = false;
  private isInitialized: boolean = false;
  private vosk: any = null;
  private resultSubscription: any = null;
  private partialResultSubscription: any = null;
  private errorSubscription: any = null;
  private timeoutSubscription: any = null;
  private startGeneration: number = 0;
  private startPromise: Promise<void> | null = null;

  async initialize(): Promise<boolean> {
    try {
      const Vosk = require('react-native-vosk');

      if (!Vosk || !Vosk.loadModel) {
        console.warn('react-native-vosk module not available');
        return false;
      }

      this.vosk = Vosk;

      try {
        await this.vosk.loadModel('model-cn');
        console.log('[Vosk] model loaded');
      } catch (e) {
        console.error('[Vosk] model load failed:', e);
        return false;
      }

      this.isInitialized = true;
      console.log('[Vosk] initialized');
      return true;
    } catch (error) {
      console.error('[Vosk] init error:', error);
      return false;
    }
  }

  isListening(): boolean {
    return this.listening;
  }

  async startListening(): Promise<void> {
    if (!this.isInitialized || !this.vosk) {
      console.warn('[Vosk] not initialized');
      return;
    }

    // 如果上一次 start 还在进行中，等它完成
    if (this.startPromise) {
      console.log('[Vosk] startListening: 上一次还在进行，等待...');
      await this.startPromise;
    }

    this.startPromise = this.doStart();
    await this.startPromise;
    this.startPromise = null;
  }

  private async doStart(): Promise<void> {
    const gen = ++this.startGeneration;
    console.log(`[Vosk] doStart gen=${gen}, listening=${this.listening}`);

    try {
      if (this.listening) {
        console.log('[Vosk] 先 stop 旧识别器');
        try { this.vosk.stop(); } catch (e) { /* ignore */ }
        this.listening = false;
        await new Promise<void>(r => setTimeout(r, 500));
      }

      if (gen !== this.startGeneration) {
        console.log(`[Vosk] gen ${gen} 已过期，跳过 (当前 ${this.startGeneration})`);
        return;
      }

      this.cleanupListeners();

      this.resultSubscription = this.vosk.onResult((result: string) => {
        console.log('[Vosk] >>> onResult:', result);
        if (result) {
          this.notifyResult(result, 0.8);
          this.notifyFinalResult(result, 0.8);
        }
      });

      this.partialResultSubscription = this.vosk.onPartialResult((result: string) => {
        console.log('[Vosk] >>> onPartialResult:', result);
        if (result) {
          this.notifyResult(result, 0.5);
        }
      });

      this.errorSubscription = this.vosk.onError((error: string) => {
        console.warn('[Vosk] >>> onError:', error);
        this.listening = false;
      });

      this.timeoutSubscription = this.vosk.onTimeout(() => {
        console.log('[Vosk] >>> onTimeout (不应触发)');
        this.listening = false;
        for (const cb of this.listeningTimeoutCallbacks) {
          try { cb(); } catch (e) { console.error('[Vosk] timeout cb error:', e); }
        }
      });

      console.log('[Vosk] 调用 vosk.start()...');
      // 不传 timeout：让 Vosk 永不停止，由用户点击 X 手动 stop
      // 传 timeout 会因 RN bridge getInt 类型问题导致提前超时
      await this.vosk.start();
      this.listening = true;
      console.log('[Vosk] start 成功, listening=true');
    } catch (error) {
      console.error('[Vosk] start error:', error);
      this.listening = false;
      this.cleanupListeners();
    }
  }

  async stopListening(): Promise<void> {
    if (!this.isInitialized || !this.vosk) {
      return;
    }

    this.startGeneration++;
    this.startPromise = null;

    try {
      if (this.listening) {
        this.vosk.stop();
        this.listening = false;
      }
      this.cleanupListeners();
      console.log('[Vosk] stopped');
    } catch (error) {
      console.error('[Vosk] stop error:', error);
    }
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
    this.cleanupListeners();
    if (this.vosk) {
      try { this.vosk.unload(); } catch (e) { /* ignore */ }
    }
    this.recognitionCallbacks = [];
    this.finalResultCallbacks = [];
    this.listeningTimeoutCallbacks = [];
    this.listening = false;
    this.isInitialized = false;
  }

  private cleanupListeners(): void {
    if (this.resultSubscription) {
      this.resultSubscription.remove();
      this.resultSubscription = null;
    }
    if (this.partialResultSubscription) {
      this.partialResultSubscription.remove();
      this.partialResultSubscription = null;
    }
    if (this.errorSubscription) {
      this.errorSubscription.remove();
      this.errorSubscription = null;
    }
    if (this.timeoutSubscription) {
      this.timeoutSubscription.remove();
      this.timeoutSubscription = null;
    }
  }

  private notifyResult(text: string, confidence: number): void {
    const result: VoiceRecognitionResult = {
      text,
      confidence,
      isOffline: true,
      language: this.language,
    };
    for (const cb of this.recognitionCallbacks) {
      try { cb(result); } catch (e) { console.error('[Vosk] result cb error:', e); }
    }
  }

  private notifyFinalResult(text: string, confidence: number): void {
    const result: VoiceRecognitionResult = {
      text,
      confidence,
      isOffline: true,
      language: this.language,
    };
    for (const cb of this.finalResultCallbacks) {
      try { cb(result); } catch (e) { console.error('[Vosk] finalResult cb error:', e); }
    }
  }
}
