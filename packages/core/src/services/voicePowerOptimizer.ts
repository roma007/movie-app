/**
 * 语音控制电量优化器
 * 根据使用场景调整监听频率，优化电量消耗
 */

import type { VoiceControlSystemState } from '../types/voice';

/**
 * 使用场景类型
 */
export type UsageScene = 
  | 'idle'           // 空闲状态
  | 'playing'        // 视频播放中
  | 'searching'      // 搜索中
  | 'browsing'       // 浏览列表
  | 'background';    // 应用在后台

/**
 * 监听配置
 */
interface ListeningConfig {
  /** 唤醒词检测间隔（毫秒） */
  wakeWordInterval: number;
  /** 语音识别超时时间（毫秒） */
  recognitionTimeout: number;
  /** 是否启用唤醒词检测 */
  wakeWordEnabled: boolean;
  /** 是否启用语音识别 */
  speechRecognitionEnabled: boolean;
}

/**
 * 场景监听配置映射
 */
const SCENE_CONFIGS: Record<UsageScene, ListeningConfig> = {
  idle: {
    wakeWordInterval: 2000,      // 2秒检测一次
    recognitionTimeout: 10000,   // 10秒超时
    wakeWordEnabled: true,
    speechRecognitionEnabled: false,
  },
  playing: {
    wakeWordInterval: 1000,      // 1秒检测一次（播放时需要快速响应）
    recognitionTimeout: 15000,   // 15秒超时
    wakeWordEnabled: true,
    speechRecognitionEnabled: true,
  },
  searching: {
    wakeWordInterval: 500,       // 500ms检测一次（搜索时需要快速响应）
    recognitionTimeout: 10000,   // 10秒超时
    wakeWordEnabled: true,
    speechRecognitionEnabled: true,
  },
  browsing: {
    wakeWordInterval: 1500,      // 1.5秒检测一次
    recognitionTimeout: 10000,   // 10秒超时
    wakeWordEnabled: true,
    speechRecognitionEnabled: false,
  },
  background: {
    wakeWordInterval: 5000,      // 5秒检测一次（后台省电）
    recognitionTimeout: 5000,    // 5秒超时
    wakeWordEnabled: false,      // 后台不检测唤醒词
    speechRecognitionEnabled: false,
  },
};

/**
 * 电量优化器类
 */
export class VoicePowerOptimizer {
  private currentScene: UsageScene = 'idle';
  private currentConfig: ListeningConfig = SCENE_CONFIGS.idle;
  private sceneChangeCallbacks: Array<(scene: UsageScene, config: ListeningConfig) => void> = [];
  private batteryLevel: number = 100;
  private isCharging: boolean = false;

  constructor() {
    this.setupBatteryMonitoring();
  }

  /**
   * 设置使用场景
   */
  setScene(scene: UsageScene): void {
    if (this.currentScene === scene) return;

    this.currentScene = scene;
    this.currentConfig = this.getOptimizedConfig(scene);
    
    console.log(`[PowerOptimizer] Scene changed to: ${scene}`);
    this.notifySceneChange(scene, this.currentConfig);
  }

  /**
   * 获取当前场景
   */
  getCurrentScene(): UsageScene {
    return this.currentScene;
  }

  /**
   * 获取当前监听配置
   */
  getCurrentConfig(): ListeningConfig {
    return this.currentConfig;
  }

  /**
   * 根据电量优化配置
   */
  private getOptimizedConfig(scene: UsageScene): ListeningConfig {
    const baseConfig = { ...SCENE_CONFIGS[scene] };

    // 低电量时增加检测间隔
    if (this.batteryLevel < 20) {
      baseConfig.wakeWordInterval = Math.min(baseConfig.wakeWordInterval * 2, 10000);
      console.log(`[PowerOptimizer] Low battery mode: interval increased to ${baseConfig.wakeWordInterval}ms`);
    }

    // 充电时可以更频繁地检测
    if (this.isCharging) {
      baseConfig.wakeWordInterval = Math.max(baseConfig.wakeWordInterval / 2, 500);
      console.log(`[PowerOptimizer] Charging mode: interval decreased to ${baseConfig.wakeWordInterval}ms`);
    }

    return baseConfig;
  }

  /**
   * 设置电池电量
   */
  setBatteryLevel(level: number): void {
    this.batteryLevel = Math.max(0, Math.min(100, level));
    
    // 重新计算当前场景的配置
    this.currentConfig = this.getOptimizedConfig(this.currentScene);
  }

  /**
   * 设置充电状态
   */
  setChargingStatus(charging: boolean): void {
    this.isCharging = charging;
    
    // 重新计算当前场景的配置
    this.currentConfig = this.getOptimizedConfig(this.currentScene);
  }

  /**
   * 注册场景变化回调
   */
  onSceneChange(callback: (scene: UsageScene, config: ListeningConfig) => void): void {
    this.sceneChangeCallbacks.push(callback);
  }

  /**
   * 移除场景变化回调
   */
  offSceneChange(callback: (scene: UsageScene, config: ListeningConfig) => void): void {
    const index = this.sceneChangeCallbacks.indexOf(callback);
    if (index > -1) {
      this.sceneChangeCallbacks.splice(index, 1);
    }
  }

  /**
   * 设置电池监控
   */
  private setupBatteryMonitoring(): void {
    // 在React Native中，可以通过Battery API获取电池信息
    // 这里先使用模拟数据，实际实现需要根据平台调整
    
    // 模拟电池电量变化
    setInterval(() => {
      // 模拟电量缓慢下降
      if (this.batteryLevel > 0 && !this.isCharging) {
        this.setBatteryLevel(this.batteryLevel - 1);
      }
    }, 60000); // 每分钟更新一次
  }

  /**
   * 通知场景变化
   */
  private notifySceneChange(scene: UsageScene, config: ListeningConfig): void {
    for (const callback of this.sceneChangeCallbacks) {
      try {
        callback(scene, config);
      } catch (error) {
        console.error('[PowerOptimizer] Error in scene change callback:', error);
      }
    }
  }

  /**
   * 获取省电建议
   */
  getPowerSavingTips(): string[] {
    const tips: string[] = [];

    if (this.batteryLevel < 20) {
      tips.push('电池电量较低，建议关闭语音控制或连接充电器');
    }

    if (this.currentScene === 'background') {
      tips.push('应用在后台时，语音控制已自动降低检测频率');
    }

    if (!this.isCharging && this.batteryLevel < 50) {
      tips.push('建议在充电时使用语音控制以获得最佳体验');
    }

    return tips;
  }

  /**
   * 获取电量消耗估算
   */
  getPowerConsumptionEstimate(): {
    hourlyRate: number;
    dailyEstimate: number;
    recommendation: string;
  } {
    const baseRate = 5; // 基础每小时消耗百分比
    const sceneMultiplier: Record<UsageScene, number> = {
      idle: 1.0,
      playing: 1.5,
      searching: 2.0,
      browsing: 1.2,
      background: 0.5,
    };

    const hourlyRate = baseRate * sceneMultiplier[this.currentScene];
    const dailyEstimate = hourlyRate * 24;

    let recommendation = '正常使用';
    if (hourlyRate > 10) {
      recommendation = '高耗电模式，建议减少使用时间';
    } else if (hourlyRate > 7) {
      recommendation = '中等耗电，可正常使用';
    } else {
      recommendation = '低耗电模式，适合长时间使用';
    }

    return {
      hourlyRate,
      dailyEstimate,
      recommendation,
    };
  }
}

/**
 * 创建电量优化器实例
 */
export function createPowerOptimizer(): VoicePowerOptimizer {
  return new VoicePowerOptimizer();
}

/**
 * 全局电量优化器单例
 */
let globalPowerOptimizer: VoicePowerOptimizer | null = null;

/**
 * 获取全局电量优化器
 */
export function getPowerOptimizer(): VoicePowerOptimizer {
  if (!globalPowerOptimizer) {
    globalPowerOptimizer = new VoicePowerOptimizer();
  }
  return globalPowerOptimizer;
}
