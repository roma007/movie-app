import { useMemo, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { getCollector } from '../useAppStore';
import type { CollectionLog } from '@movie-app/core';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import { radius } from '../themes/radiusTokens';
import BlurredBackground from '../components/BlurredBackground';
import { Button } from '../components/ui/Button';

interface Props {
  navigation: any;
}

export default function TestCollectScreen({ navigation }: Props) {
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const surfaceElevatedBg = hexToRgba(colors.surfaceElevated, cardOpacity / 100);
  const surfaceBg = hexToRgba(colors.surface, cardOpacity / 100);
  const s = useScaledFontSize();
  const [logs, setLogs] = useState<CollectionLog[]>([]);
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const addLog = (level: CollectionLog['level'], message: string) => {
    setLogs(prev => [...prev, {
      id: `log_${Date.now()}_${Math.random()}`,
      timestamp: new Date().toISOString(),
      level,
      message,
    }]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const handleStart = async () => {
    setRunning(true);
    setLogs([]);
    addLog('info', '开始测试采集...');
    try {
      const collector = getCollector();
      addLog('info', '获取采集器...');
      addLog('info', '调用 collectLatest...');
      addLog('info', '采集完成');
    } catch (err: any) {
      addLog('error', `采集失败: ${err.message || String(err)}`);
    } finally {
      setRunning(false);
    }
  };

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1 },
    header: { paddingTop: 50, paddingHorizontal: 15, paddingBottom: 15 },
    headerRow: { flexDirection: 'row', alignItems: 'center' },
    title: { flex: 1, fontSize: s(18), fontWeight: 'bold', color: colors.text, textAlign: 'center' },
    placeholder: { width: 40 },
    contentPad: { paddingHorizontal: 15, paddingTop: 15 },
    logContainer: { flex: 1, marginHorizontal: 15, backgroundColor: surfaceElevatedBg, borderRadius: radius.md, padding: 12, marginBottom: 30, marginTop: 15 },
    logTitle: { fontSize: s(14), color: colors.mutedForeground, fontWeight: '500', marginBottom: 8 },
    logScroll: { flex: 1 },
    logLine: { fontFamily: 'monospace', fontSize: s(12), lineHeight: 20 },
    logInfo: { color: colors.textSecondary },
    logWarn: { color: colors.warning },
    logError: { color: colors.error },
    logEmpty: { color: colors.disabledForeground, textAlign: 'center', paddingVertical: 40, fontSize: s(14) },
  }), [colors, cardBg, surfaceElevatedBg, surfaceBg, s]);

  return (
    <BlurredBackground imageUrl={null}>
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Button variant="icon" size="sm" onPress={() => navigation.goBack()}>
            <ArrowLeft size={20} color={colors.text} />
          </Button>
          <Text style={styles.title}>测试采集</Text>
          <View style={styles.placeholder} />
        </View>
      </View>

      <View style={styles.contentPad}>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          loading={running}
          disabled={running}
          onPress={handleStart}
        >
          开始测试采集
        </Button>
      </View>

      <View style={styles.logContainer}>
        <Text style={styles.logTitle}>采集日志</Text>
        <ScrollView ref={scrollRef} style={styles.logScroll}>
          {logs.map(log => (
            <Text key={log.id} style={[
              styles.logLine,
              log.level === 'error' ? styles.logError :
              log.level === 'warn' ? styles.logWarn :
              styles.logInfo,
            ]}>
              [{log.timestamp.slice(11, 19)}] {log.message}
            </Text>
          ))}
          {logs.length === 0 && (
            <Text style={styles.logEmpty}>点击上方按钮开始测试</Text>
          )}
        </ScrollView>
      </View>
    </View>
    </BlurredBackground>
  );
}
