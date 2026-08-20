/**
 * 语音控制系统主模块
 * 协调唤醒词检测、语音识别、命令解析和语音反馈
 */

import type {
  VoiceControlConfig,
  VoiceControlSystemState,
  VoiceCommand,
  ParsedVoiceCommand,
} from '../types/voice';

import type { IWakeWordService } from './wakeWordService';
import type { ISpeechRecognitionService } from './speechRecognitionService';
import type { ITTSService } from './ttsService';

import { VoiceCommandParser, createDefaultParser } from './voiceCommandParser';
import { InMemoryWakeWordService } from './wakeWordService';
import { InMemorySpeechRecognitionService } from './speechRecognitionService';
import { InMemoryTTSService, VOICE_FEEDBACK_MESSAGES } from './ttsService';

/**
 * 语音控制事件
 */
export type VoiceControlEventType = 
  | 'state_change'
  | 'wake_word_detected'
  | 'recognition_result'
  | 'command_parsed'
  | 'command_executed'
  | 'error'
  | 'tts_message';

/**
 * 语音控制事件数据
 */
export interface VoiceControlEvent {
  type: VoiceControlEventType;
  data: any;
  timestamp: number;
}

/**
 * 语音控制事件回调
 */
export type VoiceControlEventCallback = (event: VoiceControlEvent) => void;

/**
 * 语音控制系统依赖注入选项
 */
export interface VoiceControlDependencies {
  wakeWordService?: IWakeWordService;
  speechRecognitionService?: ISpeechRecognitionService;
  ttsService?: ITTSService;
}

/**
 * 语音控制系统主模块
 */
export class VoiceControlSystem {
  private state: VoiceControlSystemState = 'idle';
  private config: VoiceControlConfig;
  
  private wakeWordService: IWakeWordService;
  private speechRecognitionService: ISpeechRecognitionService;
  private ttsService: ITTSService;
  private commandParser: VoiceCommandParser;
  
  private eventCallbacks: VoiceControlEventCallback[] = [];
  private stateChangeCallbacks: Array<(state: VoiceControlSystemState) => void> = [];
  
  private listenTimeout: ReturnType<typeof setTimeout> | null = null;
  private currentTranscript: string = '';

  constructor(config?: Partial<VoiceControlConfig>, dependencies?: VoiceControlDependencies) {
    // 默认配置
    this.config = {
      enabled: true,
      wakeWordEnabled: true,
      wakeWord: '小MM',
      sensitivity: 0.7,
      ttsEnabled: true,
      ttsLanguage: 'zh-CN',
      ttsRate: 1.0,
      ttsPitch: 1.0,
      ttsVolume: 1.0,
      recognitionTimeout: 10000,
      wakeWordTimeout: 5000,
      feedbackEnabled: true,
      offlineEnabled: true,
      onlineApiEnabled: false,
      audioConfig: {
        sampleRate: 16000,
        channels: 1,
        bitDepth: 16,
        bufferSize: 1280,
      },
      ...config,
    };

    // 初始化服务（使用注入的依赖或默认的内存实现）
    this.wakeWordService = dependencies?.wakeWordService || new InMemoryWakeWordService();
    this.speechRecognitionService = dependencies?.speechRecognitionService || new InMemorySpeechRecognitionService();
    this.ttsService = dependencies?.ttsService || new InMemoryTTSService();
    this.commandParser = createDefaultParser();

    // 注册回调
    this.setupCallbacks();
  }

  /**
   * 初始化语音控制系统
   */
  async initialize(): Promise<boolean> {
    try {
      console.log('Initializing Voice Control System...');

      // 初始化各服务
      await this.wakeWordService.initialize({
        melspectrogram: '',
        embedding: '',
        wakeWord: this.config.wakeWord,
      });
      await this.speechRecognitionService.initialize();
      await this.ttsService.initialize();

      // 应用配置
      this.applyConfig();

      console.log('Voice Control System initialized successfully');
      return true;
    } catch (error) {
      console.error('Failed to initialize Voice Control System:', error);
      this.emitEvent('error', { error: 'Failed to initialize voice control' });
      return false;
    }
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<VoiceControlConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.applyConfig();
  }

  /**
   * 获取当前配置
   */
  getConfig(): VoiceControlConfig {
    return { ...this.config };
  }

  /**
   * 启用/禁用语音控制
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    if (enabled) {
      this.start();
    } else {
      this.stop();
    }
  }

  /**
   * 启用/禁用唤醒词
   */
  setWakeWordEnabled(enabled: boolean): void {
    this.config.wakeWordEnabled = enabled;
    if (enabled && this.config.enabled) {
      this.wakeWordService.startListening();
    } else {
      this.wakeWordService.stopListening();
    }
  }

  /**
   * 更新唤醒词
   */
  updateWakeWord(wakeWord: string): void {
    this.config.wakeWord = wakeWord;
    // 注意：更新唤醒词需要重新训练模型
    // 这里只更新配置，实际模型更新需要在移动端实现
    console.log(`Wake word updated to: ${wakeWord}`);
  }

  /**
   * 启用/禁用 TTS 反馈
   */
  setTTSEnabled(enabled: boolean): void {
    this.config.ttsEnabled = enabled;
    if (!enabled) {
      this.ttsService.stop();
    }
  }

  /**
   * 启动语音控制
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      console.log('Voice control is disabled');
      return;
    }

    if (this.state === 'listening' || this.state === 'wake_word_listening') {
      console.log('Voice control is already active');
      return;
    }

    this.setState('wake_word_listening');

    if (this.config.wakeWordEnabled) {
      await this.wakeWordService.startListening();
    } else {
      // 如果唤醒词禁用，直接开始监听语音
      await this.startVoiceListening();
    }
  }

  /**
   * 停止语音控制
   */
  async stop(): Promise<void> {
    this.clearListenTimeout();
    
    await this.wakeWordService.stopListening();
    await this.speechRecognitionService.stopListening();
    
    this.setState('idle');
    this.currentTranscript = '';
  }

  /**
   * 获取当前状态
   */
  getState(): VoiceControlSystemState {
    return this.state;
  }

  /**
   * 获取当前识别文本
   */
  getCurrentTranscript(): string {
    return this.currentTranscript;
  }

  /**
   * 注册事件监听
   */
  on(eventType: VoiceControlEventType | '*', callback: VoiceControlEventCallback): void {
    this.eventCallbacks.push(callback);
  }

  /**
   * 移除事件监听
   */
  off(eventType: VoiceControlEventType | '*', callback: VoiceControlEventCallback): void {
    const index = this.eventCallbacks.indexOf(callback);
    if (index > -1) {
      this.eventCallbacks.splice(index, 1);
    }
  }

  /**
   * 注册状态变化回调
   */
  onStateChange(callback: (state: VoiceControlSystemState) => void): void {
    this.stateChangeCallbacks.push(callback);
  }

  /**
   * 移除状态变化回调
   */
  offStateChange(callback: (state: VoiceControlSystemState) => void): void {
    const index = this.stateChangeCallbacks.indexOf(callback);
    if (index > -1) {
      this.stateChangeCallbacks.splice(index, 1);
    }
  }

  /**
   * 注册自定义命令
   */
  registerCommand(command: VoiceCommand): void {
    this.commandParser.registerCommand(command);
  }

  /**
   * 批量注册命令
   */
  registerCommands(commands: VoiceCommand[]): void {
    this.commandParser.registerCommands(commands);
  }

  /**
   * 手动触发语音识别（用于按钮触发）
   */
  async triggerVoiceRecognition(): Promise<void> {
    if (!this.config.enabled) {
      console.log('Voice control is disabled');
      return;
    }

    await this.startVoiceListening();
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.clearListenTimeout();
    
    this.wakeWordService.dispose();
    this.speechRecognitionService.dispose();
    this.ttsService.dispose();
    
    this.eventCallbacks = [];
    this.stateChangeCallbacks = [];
    
    this.setState('idle');
  }

  // ============ 私有方法 ============

  /**
   * 应用配置到各服务
   */
  private applyConfig(): void {
    this.wakeWordService.setThreshold(this.config.wakeWordThreshold || 0.7);
    this.speechRecognitionService.setLanguage(this.config.ttsLanguage || 'zh-CN');
    this.ttsService.setLanguage(this.config.ttsLanguage || 'zh-CN');
    this.ttsService.setRate(this.config.ttsRate || 1.0);
    this.ttsService.setPitch(this.config.ttsPitch || 1.0);
    this.ttsService.setVolume(this.config.ttsVolume || 1.0);
  }

  /**
   * 设置回调
   */
  private setupCallbacks(): void {
    // 唤醒词检测回调
    this.wakeWordService.onWakeWordDetected((result) => {
      if (result.detected) {
        this.handleWakeWordDetected();
      }
    });

    // 语音识别回调
    this.speechRecognitionService.onRecognitionResult((result) => {
      this.handleRecognitionResult(result.text, result.confidence);
    });
  }

  /**
   * 处理唤醒词检测
   */
  private handleWakeWordDetected(): void {
    this.setState('wakeword_detected');
    this.emitEvent('wake_word_detected', { timestamp: Date.now() });

    // 播放提示音或 TTS
    if (this.config.ttsEnabled) {
      this.ttsService.speak(VOICE_FEEDBACK_MESSAGES.WAKE_WORD_DETECTED);
    }

    // 开始监听语音命令
    this.startVoiceListening();
  }

  /**
   * 开始语音监听
   */
  private async startVoiceListening(): Promise<void> {
    this.setState('listening');
    this.currentTranscript = '';

    await this.speechRecognitionService.startListening();

    // 设置超时
    this.clearListenTimeout();
    this.listenTimeout = setTimeout(() => {
      this.handleListenTimeout();
    }, this.config.recognitionTimeout);
  }

  /**
   * 处理语音识别结果
   */
  private handleRecognitionResult(text: string, confidence: number): void {
    this.currentTranscript = text;
    this.emitEvent('recognition_result', { text, confidence });

    // 解析命令
    const parsedCommand = this.commandParser.parse(text);
    
    if (parsedCommand) {
      this.setState('command_recognized');
      this.emitEvent('command_parsed', parsedCommand);

      // 执行命令
      this.executeCommand(parsedCommand);
    } else {
      // 未识别的命令
      if (this.config.ttsEnabled) {
        this.ttsService.speak(VOICE_FEEDBACK_MESSAGES.COMMAND_NOT_RECOGNIZED);
      }
      this.setState('error');
      this.emitEvent('error', { message: 'Command not recognized', text });
    }
  }

  /**
   * 执行命令
   */
  private async executeCommand(parsedCommand: ParsedVoiceCommand): Promise<void> {
    try {
      this.setState('executing_command');

      await parsedCommand.command.execute(parsedCommand.params);

      this.setState('command_executed');
      this.emitEvent('command_executed', {
        command: parsedCommand.command,
        params: parsedCommand.params,
      });

      // 执行成功反馈
      if (this.config.ttsEnabled) {
        this.ttsService.speak(parsedCommand.command.name);
      }

      // 重新开始监听（如果配置了持续监听）
      if (this.config.enabled) {
        setTimeout(() => {
          this.start();
        }, 1000);
      }
    } catch (error) {
      console.error('Failed to execute command:', error);
      this.setState('error');
      this.emitEvent('error', { error: 'Failed to execute command', command: parsedCommand.command });
    }
  }

  /**
   * 处理监听超时
   */
  private handleListenTimeout(): void {
    this.setState('error');
    
    if (this.config.ttsEnabled) {
      this.ttsService.speak(VOICE_FEEDBACK_MESSAGES.WAKE_WORD_TIMEOUT);
    }

    this.emitEvent('error', { message: 'Listening timeout' });

    // 重新开始监听
    if (this.config.enabled) {
      setTimeout(() => {
        this.start();
      }, 1000);
    }
  }

  /**
   * 清除监听超时
   */
  private clearListenTimeout(): void {
    if (this.listenTimeout) {
      clearTimeout(this.listenTimeout);
      this.listenTimeout = null;
    }
  }

  /**
   * 设置状态
   */
  private setState(newState: VoiceControlSystemState): void {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;
      
      this.emitEvent('state_change', { oldState, newState });
      
      for (const callback of this.stateChangeCallbacks) {
        try {
          callback(newState);
        } catch (error) {
          console.error('Error in state change callback:', error);
        }
      }
    }
  }

  /**
   * 发送事件
   */
  private emitEvent(type: VoiceControlEventType, data: any): void {
    const event: VoiceControlEvent = {
      type,
      data,
      timestamp: Date.now(),
    };

    for (const callback of this.eventCallbacks) {
      try {
        callback(event);
      } catch (error) {
        console.error('Error in event callback:', error);
      }
    }
  }
}

/**
 * 创建语音控制系统实例
 */
export function createVoiceControlSystem(
  config?: Partial<VoiceControlConfig>,
  dependencies?: VoiceControlDependencies
): VoiceControlSystem {
  return new VoiceControlSystem(config, dependencies);
}

/**
 * 全局语音控制系统单例
 */
let globalVoiceControlSystem: VoiceControlSystem | null = null;

/**
 * 获取全局语音控制系统
 */
export function getVoiceControlSystem(): VoiceControlSystem {
  if (!globalVoiceControlSystem) {
    globalVoiceControlSystem = new VoiceControlSystem();
  }
  return globalVoiceControlSystem;
}

/**
 * 设置全局语音控制系统
 */
export function setGlobalVoiceControlSystem(system: VoiceControlSystem): void {
  globalVoiceControlSystem = system;
}

/**
 * 初始化全局语音控制系统
 */
export async function initializeVoiceControl(config?: Partial<VoiceControlConfig>): Promise<VoiceControlSystem> {
  const system = getVoiceControlSystem();
  if (config) {
    system.updateConfig(config);
  }
  await system.initialize();
  return system;
}
