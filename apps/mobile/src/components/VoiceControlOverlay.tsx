/**
 * 语音控制叠加层组件
 * 用于在播放器中显示语音控制状态和触发语音识别
 */

import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { Mic, MicOff, X } from 'lucide-react-native';
import { useThemeColors } from '../themes/useThemeColors';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import { radius } from '../themes/radiusTokens';
import { getVoiceControlSystem, type VoiceControlSystemState } from '@movie-app/core';

interface VoiceControlOverlayProps {
  visible: boolean;
  onClose: () => void;
}

export function VoiceControlOverlay({ visible, onClose }: VoiceControlOverlayProps) {
  const colors = useThemeColors();
  const s = useScaledFontSize();
  const voiceControl = getVoiceControlSystem();
  
  const [systemState, setSystemState] = useState<VoiceControlSystemState>('idle');
  const [transcript, setTranscript] = useState('');
  const [fadeAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    if (visible) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();

      // 注册状态变化回调
      const handleStateChange = (state: VoiceControlSystemState) => {
        setSystemState(state);
      };

      const handleRecognitionResult = (result: { text: string }) => {
        setTranscript(result.text);
      };

      voiceControl.onStateChange(handleStateChange);
      voiceControl.on('*', (event) => {
        if (event.type === 'recognition_result') {
          handleRecognitionResult(event.data);
        }
      });

      // 启动语音识别
      voiceControl.triggerVoiceRecognition();

      return () => {
        voiceControl.offStateChange(handleStateChange);
      };
    } else {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, voiceControl]);

  const handleClose = useCallback(() => {
    voiceControl.stop();
    setTranscript('');
    onClose();
  }, [voiceControl, onClose]);

  if (!visible) return null;

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
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <View style={styles.backdrop} />
      <View style={[styles.content, { backgroundColor: hexToRgba(colors.card, 0.95) }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>语音控制</Text>
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
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  content: {
    width: '80%',
    maxWidth: 320,
    borderRadius: radius.lg,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
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
