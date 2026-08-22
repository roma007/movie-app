/**
 * 语音控制系统类型定义
 */

/** 语音命令类别 */
export type VoiceCommandCategory = 
  | 'playback'    // 播放控制
  | 'search'      // 搜索
  | 'list'        // 列表操作
  | 'collection'  // 采集
  | 'settings'    // 设置
  | 'navigation'  // 导航
  | 'system';     // 系统

/** 命令参数类型 */
export type CommandParameterType = 'string' | 'number' | 'boolean';

/** 命令参数定义 */
export interface CommandParameter {
  name: string;
  type: CommandParameterType;
  required: boolean;
  defaultValue?: any;
  description?: string;
}

/** 语音命令定义 */
export interface VoiceCommand {
  id: string;
  name: string;
  description: string;
  aliases: string[];
  category: VoiceCommandCategory;
  parameters?: CommandParameter[];
  execute: (params?: Record<string, any>) => Promise<void>;
}

/** 语音识别结果 */
export interface VoiceRecognitionResult {
  text: string;
  confidence: number;
  isOffline: boolean;
  language?: string;
}

/** 唤醒词状态 */
export type WakeWordState = 
  | 'idle'           // 空闲
  | 'listening'      // 监听中
  | 'wakeword_detected' // 唤醒词已检测到
  | 'command_listening' // 命令监听中
  | 'processing'     // 处理中
  | 'error';         // 错误

/** 语音控制系统状态 */
export type VoiceControlSystemState = 
  | 'idle'
  | 'wake_word_listening'
  | 'wakeword_detected'
  | 'listening'
  | 'command_recognized'
  | 'executing_command'
  | 'command_executed'
  | 'error';

/** 语音控制系统状态 */
export interface VoiceControlState {
  enabled: boolean;
  wakeWord: string;
  wakeWordState: WakeWordState;
  systemState: VoiceControlSystemState;
  sensitivity: number;  // 0.0 - 1.0
  feedbackEnabled: boolean;
  offlineEnabled: boolean;
  lastCommand?: string;
  lastError?: string;
}

/** 唤醒词检测结果 */
export interface WakeWordDetectionResult {
  detected: boolean;
  probability: number;
  timestamp: number;
}

/** 音频处理配置 */
export interface AudioConfig {
  sampleRate: number;      // 16000 Hz
  channels: number;        // 1 (mono)
  bitDepth: number;        // 16
  bufferSize: number;      // 帧大小
}

/** 默认音频配置 */
export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  sampleRate: 16000,
  channels: 1,
  bitDepth: 16,
  bufferSize: 1280,  // 80ms at 16kHz
};

/** 语音控制配置 */
export interface VoiceControlConfig {
  enabled: boolean;
  wakeWordEnabled: boolean;
  wakeWord: string;
  wakeWordThreshold?: number;
  sensitivity: number;
  ttsEnabled: boolean;
  ttsLanguage?: string;
  ttsRate?: number;
  ttsPitch?: number;
  ttsVolume?: number;
  recognitionTimeout?: number;
  wakeWordTimeout?: number;
  feedbackEnabled: boolean;
  offlineEnabled: boolean;
  audioConfig: AudioConfig;
}

/** 默认语音控制配置 */
export const DEFAULT_VOICE_CONTROL_CONFIG: VoiceControlConfig = {
  enabled: false,
  wakeWordEnabled: true,
  wakeWord: '小MM',
  wakeWordThreshold: 0.7,
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
  audioConfig: DEFAULT_AUDIO_CONFIG,
};

/** 语音命令解析结果 */
export interface ParsedVoiceCommand {
  command: VoiceCommand;
  params: Record<string, any>;
  confidence: number;
  rawText: string;
}

/** 语音控制事件类型 */
export type VoiceControlEventType = 
  | 'state_changed'
  | 'wakeword_detected'
  | 'command_recognized'
  | 'command_executed'
  | 'error'
  | 'feedback_played';

/** 语音控制事件 */
export interface VoiceControlEvent {
  type: VoiceControlEventType;
  timestamp: number;
  data?: any;
}

/** 语音控制事件监听器 */
export type VoiceControlEventListener = (event: VoiceControlEvent) => void;
