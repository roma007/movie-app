import { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, Alert, Pressable } from 'react-native';
import { ArrowLeft, Mic, Volume2, Settings, ChevronRight, Sliders, WifiOff } from 'lucide-react-native';
import { useThemeColors } from '../themes/useThemeColors';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import BlurredBackground from '../components/BlurredBackground';
import { Button } from '../components/ui/Button';
import { radius } from '../themes/radiusTokens';
import { getVoiceControlSystem, type VoiceControlConfig } from '@movie-app/core';
import { getProvider } from '../init';

interface Props {
  navigation: any;
}

// 预置唤醒词选项
const WAKE_WORD_OPTIONS = [
  { id: 'xiao_mm', label: '小MM', value: '小MM' },
  { id: 'xiao_zhushou', label: '小助手', value: '小助手' },
  { id: 'nihao_dianying', label: '你好电影', value: '你好电影' },
  { id: 'dianying_jingling', label: '电影精灵', value: '电影精灵' },
];

// 灵敏度选项
const SENSITIVITY_OPTIONS = [
  { id: 'low', label: '低', value: 0.5 },
  { id: 'medium', label: '中', value: 0.7 },
  { id: 'high', label: '高', value: 0.9 },
];

export default function VoiceControlSettingsScreen({ navigation }: Props) {
  const colors = useThemeColors();
  const s = useScaledFontSize();
  const voiceControl = getVoiceControlSystem();
  const config = voiceControl.getConfig();

  const [voiceEnabled, setVoiceEnabled] = useState(config.enabled);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(config.wakeWordEnabled);
  const [ttsEnabled, setTtsEnabled] = useState(config.ttsEnabled);
  const [wakeWord, setWakeWord] = useState(config.wakeWord);
  const [sensitivity, setSensitivity] = useState(config.sensitivity || 0.7);
  const [offlineEnabled, setOfflineEnabled] = useState(true);

  const cardBg = hexToRgba(colors.card, 0.95);

  // 加载数据库配置
  useEffect(() => {
    loadDbConfig();
  }, []);

  const loadDbConfig = async () => {
    try {
      const provider = getProvider();
      if (!provider) return;

      const savedSensitivity = await provider.getVoiceConfig('voice.sensitivity');
      const savedOffline = await provider.getVoiceConfig('voice.offlineEnabled');
      const savedWakeWord = await provider.getVoiceConfig('voice.wakeWord');

      if (savedSensitivity) setSensitivity(parseFloat(savedSensitivity));
      if (savedOffline) setOfflineEnabled(savedOffline === 'true');
      if (savedWakeWord) setWakeWord(savedWakeWord);
    } catch (error) {
      console.error('Failed to load voice config:', error);
    }
  };

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1 },
    header: { paddingTop: 50, paddingHorizontal: 15, paddingBottom: 15 },
    headerRow: { flexDirection: 'row', alignItems: 'center' },
    title: { flex: 1, fontSize: s(18), fontWeight: 'bold', color: colors.text, textAlign: 'center' },
    placeholder: { width: 40 },
    content: { padding: 15 },
    cardTitle: { 
      fontSize: s(15), 
      fontWeight: '600', 
      color: colors.text, 
      paddingHorizontal: 15, 
      paddingTop: 15, 
      paddingBottom: 10 
    },
    card: {
      backgroundColor: cardBg,
      borderRadius: radius.lg,
      overflow: 'hidden',
      marginBottom: 20,
    },
    row: {
      paddingVertical: 18,
      paddingHorizontal: 15,
      flexDirection: 'row',
      alignItems: 'center',
    },
    rowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: hexToRgba(colors.disabledForeground, 0.15),
    },
    rowLeft: { flex: 1, paddingRight: 12 },
    rowLabel: { fontSize: s(16), color: colors.text, fontWeight: '500' },
    rowDesc: { fontSize: s(13), color: colors.mutedForeground, marginTop: 4 },
    icon: { marginRight: 12 },
    testButton: {
      marginHorizontal: 15,
      marginBottom: 20,
    },
    statusCard: {
      backgroundColor: hexToRgba(colors.success, 0.1),
      borderRadius: radius.lg,
      padding: 15,
      marginBottom: 20,
    },
    statusTitle: {
      fontSize: s(14),
      fontWeight: '600',
      color: colors.success,
      marginBottom: 8,
    },
    statusText: {
      fontSize: s(13),
      color: colors.text,
      lineHeight: 20,
    },
    wakeWordOptions: {
      backgroundColor: cardBg,
      borderRadius: radius.lg,
      overflow: 'hidden',
      marginBottom: 20,
    },
    wakeWordOption: {
      paddingVertical: 14,
      paddingHorizontal: 15,
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: hexToRgba(colors.disabledForeground, 0.1),
    },
    wakeWordOptionLast: {
      borderBottomWidth: 0,
    },
    wakeWordLabel: {
      flex: 1,
      fontSize: s(15),
      color: colors.text,
    },
    wakeWordCheck: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: colors.mutedForeground,
      justifyContent: 'center',
      alignItems: 'center',
    },
    wakeWordCheckSelected: {
      backgroundColor: colors.success,
      borderColor: colors.success,
    },
    sensitivityOptions: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 15,
      paddingVertical: 12,
    },
    sensitivityOption: {
      flex: 1,
      paddingVertical: 10,
      marginHorizontal: 5,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.mutedForeground,
      alignItems: 'center',
    },
    sensitivityOptionSelected: {
      backgroundColor: hexToRgba(colors.success, 0.2),
      borderColor: colors.success,
    },
    sensitivityLabel: {
      fontSize: s(14),
      color: colors.text,
    },
    sensitivityLabelSelected: {
      color: colors.success,
      fontWeight: '600',
    },
    commandsCard: {
      backgroundColor: cardBg,
      borderRadius: radius.lg,
      padding: 15,
      marginBottom: 20,
    },
    commandItem: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: hexToRgba(colors.disabledForeground, 0.1),
    },
    commandText: {
      fontSize: s(13),
      color: colors.text,
    },
    commandCategory: {
      fontSize: s(12),
      color: colors.mutedForeground,
    },
  }), [colors, s, cardBg]);

  const handleToggleVoice = (value: boolean) => {
    setVoiceEnabled(value);
    voiceControl.setEnabled(value);
    saveConfig('voice.enabled', value.toString());
  };

  const handleToggleWakeWord = (value: boolean) => {
    setWakeWordEnabled(value);
    voiceControl.setWakeWordEnabled(value);
    saveConfig('voice.wakeWordEnabled', value.toString());
  };

  const handleToggleTTS = (value: boolean) => {
    setTtsEnabled(value);
    voiceControl.setTTSEnabled(value);
    saveConfig('voice.ttsEnabled', value.toString());
  };

  const handleSelectWakeWord = async (selectedWakeWord: string) => {
    setWakeWord(selectedWakeWord);
    voiceControl.updateWakeWord(selectedWakeWord);
    await saveConfig('voice.wakeWord', selectedWakeWord);
    Alert.alert('唤醒词已更改', `新的唤醒词: "${selectedWakeWord}"\n请重新训练唤醒词模型以使用新词。`);
  };

  const handleSelectSensitivity = async (value: number) => {
    setSensitivity(value);
    await saveConfig('voice.sensitivity', value.toString());
  };

  const handleToggleOffline = async (value: boolean) => {
    setOfflineEnabled(value);
    await saveConfig('voice.offlineEnabled', value.toString());
  };

  const saveConfig = async (key: string, value: string) => {
    try {
      const provider = getProvider();
      if (provider) {
        await provider.setVoiceConfig(key, value);
      }
    } catch (error) {
      console.error('Failed to save voice config:', error);
    }
  };

  const handleTestVoice = async () => {
    try {
      await voiceControl.triggerVoiceRecognition();
    } catch (error) {
      Alert.alert('测试失败', '无法启动语音识别');
    }
  };

  const commandCategories = [
    { name: '播放控制', commands: ['暂停', '播放', '快进', '快退', '音量增加', '音量减少', '静音', '全屏'] },
    { name: '搜索', commands: ['搜索', '搜索电影', '搜索电视剧'] },
    { name: '列表操作', commands: ['下一页', '上一页', '跳转到指定页'] },
    { name: '采集', commands: ['开始采集', '停止采集', '查看采集状态'] },
    { name: '设置', commands: ['打开设置', '语音控制设置', '播放设置'] },
    { name: '导航', commands: ['返回首页', '返回'] },
  ];

  return (
    <View style={styles.container}>
      <BlurredBackground>
        <ScrollView style={styles.content}>
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <Button
                variant="icon"
                size="sm"
                onPress={() => navigation.goBack()}
              >
                <ArrowLeft size={20} color={colors.text} />
              </Button>
              <Text style={styles.title}>语音控制</Text>
              <View style={styles.placeholder} />
            </View>
          </View>

          {/* 状态卡片 */}
          <View style={styles.statusCard}>
            <Text style={styles.statusTitle}>当前状态</Text>
            <Text style={styles.statusText}>
              语音控制: {voiceEnabled ? '已开启' : '已关闭'}{'\n'}
              唤醒词: {wakeWordEnabled ? '已开启' : '已关闭'} ({wakeWord}){'\n'}
              语音反馈: {ttsEnabled ? '已开启' : '已关闭'}{'\n'}
              灵敏度: {SENSITIVITY_OPTIONS.find(o => o.value === sensitivity)?.label || '中'}{'\n'}
              离线识别: {offlineEnabled ? '已开启' : '已关闭'}
            </Text>
          </View>

          {/* 主开关 */}
          <Text style={styles.cardTitle}>基本设置</Text>
          <View style={styles.card}>
            <View style={[styles.row, styles.rowBorder]}>
              <Mic size={20} color={colors.success} style={styles.icon} />
              <View style={styles.rowLeft}>
                <Text style={styles.rowLabel}>启用语音控制</Text>
                <Text style={styles.rowDesc}>开启后可通过语音控制应用</Text>
              </View>
              <Switch
                value={voiceEnabled}
                onValueChange={handleToggleVoice}
                trackColor={{ false: colors.disabledForeground, true: hexToRgba(colors.success, 0.5) }}
                thumbColor={voiceEnabled ? colors.success : colors.disabledForeground}
              />
            </View>

            <View style={[styles.row, styles.rowBorder]}>
              <Settings size={20} color={colors.success} style={styles.icon} />
              <View style={styles.rowLeft}>
                <Text style={styles.rowLabel}>唤醒词检测</Text>
                <Text style={styles.rowDesc}>说"{wakeWord}"唤醒语音控制</Text>
              </View>
              <Switch
                value={wakeWordEnabled}
                onValueChange={handleToggleWakeWord}
                disabled={!voiceEnabled}
                trackColor={{ false: colors.disabledForeground, true: hexToRgba(colors.success, 0.5) }}
                thumbColor={wakeWordEnabled ? colors.success : colors.disabledForeground}
              />
            </View>

            <View style={styles.row}>
              <Volume2 size={20} color={colors.success} style={styles.icon} />
              <View style={styles.rowLeft}>
                <Text style={styles.rowLabel}>语音反馈</Text>
                <Text style={styles.rowDesc}>执行命令后播放语音提示</Text>
              </View>
              <Switch
                value={ttsEnabled}
                onValueChange={handleToggleTTS}
                disabled={!voiceEnabled}
                trackColor={{ false: colors.disabledForeground, true: hexToRgba(colors.success, 0.5) }}
                thumbColor={ttsEnabled ? colors.success : colors.disabledForeground}
              />
            </View>
          </View>

          {/* 唤醒词选择 */}
          <Text style={styles.cardTitle}>唤醒词选择</Text>
          <View style={styles.wakeWordOptions}>
            {WAKE_WORD_OPTIONS.map((option, index) => (
              <Pressable
                key={option.id}
                style={[
                  styles.wakeWordOption,
                  index === WAKE_WORD_OPTIONS.length - 1 && styles.wakeWordOptionLast,
                ]}
                onPress={() => handleSelectWakeWord(option.value)}
                disabled={!voiceEnabled}
              >
                <Text style={styles.wakeWordLabel}>{option.label}</Text>
                <View style={[
                  styles.wakeWordCheck,
                  wakeWord === option.value && styles.wakeWordCheckSelected,
                ]}>
                  {wakeWord === option.value && (
                    <Text style={{ color: colors.background, fontSize: 12 }}>✓</Text>
                  )}
                </View>
              </Pressable>
            ))}
          </View>

          {/* 灵敏度设置 */}
          <Text style={styles.cardTitle}>唤醒词灵敏度</Text>
          <View style={styles.card}>
            <View style={styles.sensitivityOptions}>
              {SENSITIVITY_OPTIONS.map((option) => (
                <Pressable
                  key={option.id}
                  style={[
                    styles.sensitivityOption,
                    sensitivity === option.value && styles.sensitivityOptionSelected,
                  ]}
                  onPress={() => handleSelectSensitivity(option.value)}
                  disabled={!voiceEnabled}
                >
                  <Text style={[
                    styles.sensitivityLabel,
                    sensitivity === option.value && styles.sensitivityLabelSelected,
                  ]}>
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* 识别模式设置 */}
          <Text style={styles.cardTitle}>识别模式</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <WifiOff size={20} color={colors.success} style={styles.icon} />
              <View style={styles.rowLeft}>
                <Text style={styles.rowLabel}>离线识别</Text>
                <Text style={styles.rowDesc}>使用设备本地识别，无需网络</Text>
              </View>
              <Switch
                value={offlineEnabled}
                onValueChange={handleToggleOffline}
                disabled={!voiceEnabled}
                trackColor={{ false: colors.disabledForeground, true: hexToRgba(colors.success, 0.5) }}
                thumbColor={offlineEnabled ? colors.success : colors.disabledForeground}
              />
            </View>
          </View>

          {/* 测试按钮 */}
          <Button
            variant="ghost"
            size="lg"
            style={styles.testButton}
            onPress={handleTestVoice}
            disabled={!voiceEnabled}
          >
            <Mic size={16} color={colors.text} />
            <Text style={{ marginLeft: 8, color: colors.text }}>测试语音识别</Text>
          </Button>

          {/* 支持的命令 */}
          <Text style={styles.cardTitle}>支持的语音命令</Text>
          <View style={styles.commandsCard}>
            {commandCategories.map((category, index) => (
              <View key={category.name}>
                <View style={styles.commandItem}>
                  <Text style={styles.commandCategory}>{category.name}</Text>
                </View>
                {category.commands.map((cmd) => (
                  <View key={cmd} style={styles.commandItem}>
                    <Text style={styles.commandText}>• {cmd}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      </BlurredBackground>
    </View>
  );
}
