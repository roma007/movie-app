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

/** 语音命令解析结果 */
export interface ParsedVoiceCommand {
  command: VoiceCommand;
  params: Record<string, any>;
  confidence: number;
  rawText: string;
}
