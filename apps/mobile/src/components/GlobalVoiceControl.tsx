/**
 * 全局语音控制悬浮组件
 * 显示悬浮麦克风按钮，支持全局唤醒词激活
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity, Dimensions, PanResponder } from 'react-native';
import { Mic, MicOff, X } from 'lucide-react-native';
import { useThemeColors } from '../themes/useThemeColors';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import { radius } from '../themes/radiusTokens';
import { getVoiceControlSystem, type VoiceControlSystemState } from '@movie-app/core';
import { getGlobalWakeWordListener } from '../services/globalWakeWordListener';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

/**
 * 全局语音控制悬浮组件
 */
export function GlobalVoiceControl() {
  const colors = useThemeColors();
  const s = useScaledFontSize();
  const voiceControl = getVoiceControlSystem();
  const wakeWordListener = getGlobalWakeWordListener();
  
  const [isActive, setIsActive] = useState(false);
  const [systemState, setSystemState] = useState<VoiceControlSystemState>('idle');
  const [transcript, setTranscript] = useState('');
  const [realListening, setRealListening] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [fadeAnim] = useState(new Animated.Value(0));
  const [buttonX] = useState(new Animated.Value(SCREEN_WIDTH - 80));
  const [buttonY] = useState(new Animated.Value(SCREEN_HEIGHT / 2 - 30));
  const [isDragging, setIsDragging] = useState(false);
  const lastTouch = useRef({ x: 0, y: 0 });
  const buttonPositionRef = useRef({ x: SCREEN_WIDTH - 80, y: SCREEN_HEIGHT / 2 - 30 });
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 注册唤醒词检测回调
  useEffect(() => {
    const handleWakeWordDetected = () => {
      console.log('[GlobalVoiceControl] Wake word detected, showing overlay');
      setShowOverlay(true);
      setIsActive(true);
    };

    wakeWordListener.onWakeWordDetected(handleWakeWordDetected);

    return () => {
      wakeWordListener.offWakeWordDetected(handleWakeWordDetected);
    };
  }, [wakeWordListener]);

  // 监听语音控制系统状态
  useEffect(() => {
    const handleStateChange = (state: VoiceControlSystemState) => {
      setSystemState(state);

      // 命令执行成功后，延迟关闭弹窗（等 TTS 播完反馈）
      if (state === 'command_executed') {
        if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current);
        autoCloseTimerRef.current = setTimeout(() => {
          voiceControl.stop();
          setTranscript('');
          setShowOverlay(false);
          setIsActive(false);
          autoCloseTimerRef.current = null;
        }, 1500);
      }
    };

    const handleEvent = (event: any) => {
      if (event.type === 'recognition_result') {
        setTranscript(event.data?.text || '');
      }
    };

    voiceControl.onStateChange(handleStateChange);
    voiceControl.on('*', handleEvent);

    return () => {
      voiceControl.offStateChange(handleStateChange);
      if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current);
    };
  }, [voiceControl]);

  // 动画效果
  useEffect(() => {
    if (showOverlay) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [showOverlay, fadeAnim]);

  // 轮询 Vosk 实际监听状态
  useEffect(() => {
    if (!showOverlay) return;
    const timer = setInterval(() => {
      setRealListening(voiceControl.isListening());
    }, 500);
    return () => clearInterval(timer);
  }, [showOverlay, voiceControl]);

  // 创建 PanResponder 处理拖拽
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        lastTouch.current = { x: evt.nativeEvent.pageX, y: evt.nativeEvent.pageY };
        setIsDragging(false);
      },
      onPanResponderMove: (evt) => {
        const deltaX = evt.nativeEvent.pageX - lastTouch.current.x;
        const deltaY = evt.nativeEvent.pageY - lastTouch.current.y;
        
        if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
          setIsDragging(true);
          const newX = buttonPositionRef.current.x + deltaX;
          const newY = buttonPositionRef.current.y + deltaY;
          buttonX.setValue(newX);
          buttonY.setValue(newY);
          buttonPositionRef.current = { x: newX, y: newY };
          lastTouch.current = { x: evt.nativeEvent.pageX, y: evt.nativeEvent.pageY };
        }
      },
      onPanResponderRelease: () => {
        // 边界检查
        const x = Math.max(0, Math.min(SCREEN_WIDTH - 60, buttonPositionRef.current.x));
        const y = Math.max(100, Math.min(SCREEN_HEIGHT - 100, buttonPositionRef.current.y));
        
        Animated.spring(buttonX, { toValue: x, useNativeDriver: false }).start();
        Animated.spring(buttonY, { toValue: y, useNativeDriver: false }).start();
        buttonPositionRef.current = { x, y };

        // 如果没有拖拽，则触发点击
        if (!isDragging) {
          setShowOverlay(true);
          setIsActive(true);
          voiceControl.triggerVoiceRecognition();
        }
      },
    })
  ).current;

  // 关闭覆盖层
  const handleClose = useCallback(() => {
    if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current);
    voiceControl.stop();
    setTranscript('');
    setShowOverlay(false);
    setIsActive(false);
  }, [voiceControl]);

  // 获取状态文本
  const getStatusText = () => {
    switch (systemState) {
      case 'idle':
        return '准备就绪';
      case 'wake_word_listening':
        return '等待唤醒词...';
      case 'wakeword_detected':
        return '已唤醒，请说出指令';
      case 'listening':
        return '正在聆听...';
      case 'command_recognized':
        return '已识别指令';
      case 'executing_command':
        return '执行中...';
      case 'command_executed':
        return '已完成';
      case 'error':
        return '出错了，请重试';
      default:
        return '';
    }
  };

  // 获取状态颜色
  const getStatusColor = () => {
    switch (systemState) {
      case 'listening':
      case 'wakeword_detected':
        return colors.success;
      case 'executing_command':
      case 'command_executed':
        return colors.success;
      case 'error':
        return colors.error;
      default:
        return colors.mutedForeground;
    }
  };

  return (
    <>
      {/* 悬浮麦克风按钮 */}
      <Animated.View
        style={[
          styles.floatingButton,
          {
            left: buttonX,
            top: buttonY,
            backgroundColor: hexToRgba(colors.card, 0.9),
          },
        ]}
        {...panResponder.panHandlers}
      >
        <View style={[
          styles.buttonInner,
          isActive && styles.buttonInnerActive,
        ]}>
          {isActive ? (
            <Mic size={24} color={colors.success} />
          ) : (
            <Mic size={24} color={colors.mutedForeground} />
          )}
        </View>
        {wakeWordListener.getState() === 'listening' && (
          <View style={[styles.pulseIndicator, { backgroundColor: colors.success }]} />
        )}
      </Animated.View>

      {/* 语音控制覆盖层 */}
      {showOverlay && (
        <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
          <View style={styles.backdrop} />
          <View style={[styles.overlayContent, { backgroundColor: hexToRgba(colors.card, 0.95) }]}>
            <View style={styles.overlayHeader}>
              <Text style={[styles.overlayTitle, { color: colors.text }]}>语音控制</Text>
              <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
                <X size={20} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.statusContainer}>
              <View style={styles.micContainer}>
                {systemState === 'listening' || systemState === 'wakeword_detected' ? (
                  <View style={[styles.micPulse, { backgroundColor: hexToRgba(colors.success, 0.2) }]}>
                    <Mic size={32} color={colors.success} />
                  </View>
                ) : (
                  <MicOff size={32} color={colors.mutedForeground} />
                )}
              </View>

              <Text style={[styles.statusText, { color: getStatusColor() }]}>
                {getStatusText()}
              </Text>

              {transcript ? (
                <Text style={[styles.transcript, { color: colors.text }]}>
                  "{transcript}"
                </Text>
              ) : null}

              <Text style={[styles.realListeningStatus, { color: realListening ? colors.success : colors.error }]}>
                Vosk: {realListening ? '监听中' : '未连接'}
              </Text>
            </View>

            <View style={styles.commandsContainer}>
              <Text style={[styles.commandsTitle, { color: colors.mutedForeground }]}>
                可用命令：
              </Text>
              <Text style={[styles.commandsList, { color: colors.text }]}>
                暂停、播放、快进、快退、音量增加、音量减少、下一集
              </Text>
            </View>
          </View>
        </Animated.View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  floatingButton: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  buttonInner: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  buttonInnerActive: {
    backgroundColor: 'rgba(76, 175, 80, 0.2)',
  },
  pulseIndicator: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 10000,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  overlayContent: {
    width: '80%',
    maxWidth: 320,
    borderRadius: radius.lg,
    padding: 20,
  },
  overlayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  overlayTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 4,
  },
  statusContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  micContainer: {
    marginBottom: 16,
  },
  micPulse: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  transcript: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    fontStyle: 'italic',
  },
  realListeningStatus: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  commandsContainer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0, 0, 0, 0.1)',
    paddingTop: 16,
  },
  commandsTitle: {
    fontSize: 12,
    marginBottom: 4,
  },
  commandsList: {
    fontSize: 12,
    lineHeight: 18,
  },
});
