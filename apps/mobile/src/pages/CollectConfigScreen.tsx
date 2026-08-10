import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Switch } from 'react-native';
import { useAppStore } from '../useAppStore';
import { ArrowLeft, Save, RotateCcw } from 'lucide-react-native';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import { radius } from '../themes/radiusTokens';
import BlurredBackground from '../components/BlurredBackground';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

interface Props {
  navigation: any;
}

export default function CollectConfigScreen({ navigation }: Props) {
  const { collectConfig, loadCollectConfig, updateCollectConfig } = useAppStore();
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const surfaceBg = hexToRgba(colors.surface, cardOpacity / 100);
  const s = useScaledFontSize();

  const [localConfig, setLocalConfig] = useState({
    minYear: '2025',
    retryTimes: '3',
    pageSize: '20',
    maxPages: '10',
    incrementalMaxPages: '100',
    maxIncrementalHours: '720',
    concurrency: '1',
    autoEnabled: false,
    autoIntervalHours: '24',
    autoOnStartup: false,
  });
  const [autoLastRunAt, setAutoLastRunAt] = useState<string | null>(null);
  const savedConfigRef = useRef('');

  useEffect(() => {
    loadCollectConfig();
  }, []);

  useEffect(() => {
    if (collectConfig) {
      savedConfigRef.current = JSON.stringify({
        minYear: collectConfig.minYear,
        retryTimes: collectConfig.retryTimes,
        pageSize: collectConfig.pageSize,
        maxPages: collectConfig.maxPages,
        incrementalMaxPages: collectConfig.incrementalMaxPages,
        maxIncrementalHours: collectConfig.maxIncrementalHours,
        concurrency: collectConfig.concurrency,
        autoEnabled: collectConfig.autoEnabled,
        autoIntervalHours: collectConfig.autoIntervalHours,
        autoOnStartup: collectConfig.autoOnStartup,
      });
      setLocalConfig({
        minYear: String(collectConfig.minYear),
        retryTimes: String(collectConfig.retryTimes),
        pageSize: String(collectConfig.pageSize),
        maxPages: String(collectConfig.maxPages),
        incrementalMaxPages: String(collectConfig.incrementalMaxPages),
        maxIncrementalHours: String(collectConfig.maxIncrementalHours),
        concurrency: String(collectConfig.concurrency),
        autoEnabled: collectConfig.autoEnabled,
        autoIntervalHours: String(collectConfig.autoIntervalHours),
        autoOnStartup: collectConfig.autoOnStartup,
      });
      setAutoLastRunAt(collectConfig.autoLastRunAt);
    }
  }, [collectConfig]);

  const hasChanges = useMemo(() => {
    if (!collectConfig || !savedConfigRef.current) return false;
    const current = JSON.stringify({
      minYear: parseInt(localConfig.minYear) || 2025,
      retryTimes: parseInt(localConfig.retryTimes) || 3,
      pageSize: parseInt(localConfig.pageSize) || 20,
      maxPages: parseInt(localConfig.maxPages) || 10,
      incrementalMaxPages: parseInt(localConfig.incrementalMaxPages) || 100,
      maxIncrementalHours: parseInt(localConfig.maxIncrementalHours) || 720,
      concurrency: parseInt(localConfig.concurrency) || 1,
      autoEnabled: localConfig.autoEnabled,
      autoIntervalHours: parseInt(localConfig.autoIntervalHours) || 24,
      autoOnStartup: localConfig.autoOnStartup,
    });
    return current !== savedConfigRef.current;
  }, [localConfig, collectConfig]);

  const handleSave = async () => {
    await updateCollectConfig({
      minYear: parseInt(localConfig.minYear) || 2025,
      retryTimes: Math.min(10, Math.max(0, parseInt(localConfig.retryTimes) || 3)),
      pageSize: Math.min(100, Math.max(5, parseInt(localConfig.pageSize) || 20)),
      maxPages: Math.max(1, parseInt(localConfig.maxPages) || 10),
      incrementalMaxPages: Math.max(1, parseInt(localConfig.incrementalMaxPages) || 100),
      maxIncrementalHours: Math.max(0, parseInt(localConfig.maxIncrementalHours) || 720),
      concurrency: Math.min(20, Math.max(1, parseInt(localConfig.concurrency) || 1)),
      autoEnabled: localConfig.autoEnabled,
      autoIntervalHours: Math.min(8760, Math.max(1, parseInt(localConfig.autoIntervalHours) || 24)),
      autoOnStartup: localConfig.autoOnStartup,
    });

    savedConfigRef.current = JSON.stringify({
      minYear: parseInt(localConfig.minYear) || 2025,
      retryTimes: parseInt(localConfig.retryTimes) || 3,
      pageSize: parseInt(localConfig.pageSize) || 20,
      maxPages: parseInt(localConfig.maxPages) || 10,
      incrementalMaxPages: parseInt(localConfig.incrementalMaxPages) || 100,
      maxIncrementalHours: parseInt(localConfig.maxIncrementalHours) || 720,
      concurrency: parseInt(localConfig.concurrency) || 1,
      autoEnabled: localConfig.autoEnabled,
      autoIntervalHours: Math.min(8760, Math.max(1, parseInt(localConfig.autoIntervalHours) || 24)),
      autoOnStartup: localConfig.autoOnStartup,
    });

    Alert.alert('成功', '配置已保存');
  };

  const handleReset = () => {
    setLocalConfig({
      minYear: '2025',
      retryTimes: '3',
      pageSize: '20',
      maxPages: '100',
      incrementalMaxPages: '100',
      maxIncrementalHours: '720',
      concurrency: '6',
      autoEnabled: false,
      autoIntervalHours: '24',
      autoOnStartup: false,
    });
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      if (!hasChanges) return;
      e.preventDefault();
      Alert.alert(
        '提示',
        '有未保存的配置，是否保存？',
        [
          {
            text: '不保存',
            style: 'destructive' as const,
            onPress: () => navigation.dispatch(e.data.action),
          },
          { text: '取消', style: 'cancel' as const },
          {
            text: '保存',
            onPress: async () => {
              await updateCollectConfig({
                minYear: parseInt(localConfig.minYear) || 2025,
                retryTimes: Math.min(10, Math.max(0, parseInt(localConfig.retryTimes) || 3)),
                pageSize: Math.min(100, Math.max(5, parseInt(localConfig.pageSize) || 20)),
                maxPages: Math.max(1, parseInt(localConfig.maxPages) || 10),
                incrementalMaxPages: Math.max(1, parseInt(localConfig.incrementalMaxPages) || 100),
                maxIncrementalHours: Math.max(0, parseInt(localConfig.maxIncrementalHours) || 720),
                concurrency: Math.min(20, Math.max(1, parseInt(localConfig.concurrency) || 1)),
                autoEnabled: localConfig.autoEnabled,
                autoIntervalHours: Math.min(8760, Math.max(1, parseInt(localConfig.autoIntervalHours) || 24)),
                autoOnStartup: localConfig.autoOnStartup,
              });
              navigation.dispatch(e.data.action);
            },
          },
        ]
      );
    });
    return () => unsubscribe();
  }, [hasChanges, navigation, localConfig, updateCollectConfig]);

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1 },
    header: { paddingTop: 50, paddingHorizontal: 15, paddingBottom: 15 },
    headerRow: { flexDirection: 'row', alignItems: 'center' },
    title: { flex: 1, fontSize: s(18), fontWeight: 'bold', color: colors.text, textAlign: 'center' },
    headerActions: { flexDirection: 'row', gap: 8 },
    content: { paddingHorizontal: 15, paddingTop: 15, paddingBottom: 30 },
    card: {
      backgroundColor: cardBg,
      borderRadius: radius.lg,
      overflow: 'hidden',
      marginBottom: 20,
    },
    cardTitle: {
      fontSize: s(15),
      fontWeight: '600',
      color: colors.text,
      paddingHorizontal: 15,
      paddingTop: 15,
      paddingBottom: 10,
    },
    fieldRow: {
      flexDirection: 'row',
      paddingHorizontal: 15,
      paddingVertical: 10,
    },
    fieldCol: { flex: 1 },
    fieldColLeft: {
      flex: 1,
      paddingRight: 10,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: hexToRgba(colors.disabledForeground, 0.15),
    },
    fieldColRight: { flex: 1, paddingLeft: 10 },
    fieldLabel: { fontSize: s(13), color: colors.mutedForeground, marginBottom: 6 },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 15,
      paddingVertical: 10,
    },
    switchInfo: { flex: 1, paddingRight: 12 },
    switchTitle: { fontSize: s(14), fontWeight: '500', color: colors.text },
    switchDesc: { fontSize: s(12), color: colors.mutedForeground, marginTop: 3 },
    lastRunBox: {
      paddingHorizontal: 15,
      paddingVertical: 6,
    },
    lastRunText: {
      fontSize: s(12),
      color: colors.mutedForeground,
      backgroundColor: surfaceBg,
      borderRadius: radius.sm,
      paddingHorizontal: 10,
      paddingVertical: 6,
      overflow: 'hidden',
    },
  }), [colors, cardBg, surfaceBg, s]);

  return (
    <BlurredBackground imageUrl={null}>
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Button variant="icon" size="sm" onPress={() => navigation.goBack()}>
            <ArrowLeft size={20} color={colors.text} />
          </Button>
          <Text style={styles.title}>采集配置</Text>
          <View style={styles.headerActions}>
            <Button variant="secondary" size="sm" onPress={handleReset}>
              <RotateCcw size={16} color={colors.text} />
            </Button>
            <Button variant="primary" size="sm" onPress={handleSave}>
              <Save size={16} color={colors.text} />
            </Button>
          </View>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>基本设置</Text>
          <View style={styles.fieldRow}>
            <View style={styles.fieldColLeft}>
              <Text style={styles.fieldLabel}>最小年份</Text>
              <Input
                size="sm"
                keyboardType="numeric"
                value={localConfig.minYear}
                onChangeText={(text) => setLocalConfig({ ...localConfig, minYear: text })}
              />
            </View>
            <View style={styles.fieldColRight}>
              <Text style={styles.fieldLabel}>失败重试次数</Text>
              <Input
                size="sm"
                keyboardType="numeric"
                value={localConfig.retryTimes}
                onChangeText={(text) => setLocalConfig({ ...localConfig, retryTimes: text })}
              />
            </View>
          </View>
          <View style={styles.fieldRow}>
            <View style={styles.fieldCol}>
              <Text style={styles.fieldLabel}>每页大小</Text>
              <Input
                size="sm"
                keyboardType="numeric"
                value={localConfig.pageSize}
                onChangeText={(text) => setLocalConfig({ ...localConfig, pageSize: text })}
              />
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>采集限制</Text>
          <View style={styles.fieldRow}>
            <View style={styles.fieldColLeft}>
              <Text style={styles.fieldLabel}>全量最大页数</Text>
              <Input
                size="sm"
                keyboardType="numeric"
                value={localConfig.maxPages}
                onChangeText={(text) => setLocalConfig({ ...localConfig, maxPages: text })}
              />
            </View>
            <View style={styles.fieldColRight}>
              <Text style={styles.fieldLabel}>增量最大页数</Text>
              <Input
                size="sm"
                keyboardType="numeric"
                value={localConfig.incrementalMaxPages}
                onChangeText={(text) => setLocalConfig({ ...localConfig, incrementalMaxPages: text })}
              />
            </View>
          </View>
          <View style={styles.fieldRow}>
            <View style={styles.fieldColLeft}>
              <Text style={styles.fieldLabel}>增量最大追溯时间（小时）</Text>
              <Input
                size="sm"
                keyboardType="numeric"
                value={localConfig.maxIncrementalHours}
                onChangeText={(text) => setLocalConfig({ ...localConfig, maxIncrementalHours: text })}
              />
            </View>
            <View style={styles.fieldColRight}>
              <Text style={styles.fieldLabel}>并发数量</Text>
              <Input
                size="sm"
                keyboardType="numeric"
                value={localConfig.concurrency}
                onChangeText={(text) => setLocalConfig({ ...localConfig, concurrency: text })}
              />
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>自动增量采集</Text>
          <View style={styles.switchRow}>
            <View style={styles.switchInfo}>
              <Text style={styles.switchTitle}>启用自动采集</Text>
              <Text style={styles.switchDesc}>定时自动执行增量采集，与手动采集互斥，无启用源时自动跳过</Text>
            </View>
            <Switch
              value={localConfig.autoEnabled}
              onValueChange={(checked) => setLocalConfig({ ...localConfig, autoEnabled: checked })}
              trackColor={{ false: colors.swiftTrack, true: colors.swiftActiveTrack }}
              thumbColor={colors.swiftThumb}
            />
          </View>

          <View style={[styles.switchRow, { opacity: localConfig.autoEnabled ? 1 : 0.4 }]}>
            <View style={styles.switchInfo}>
              <Text style={styles.switchTitle}>采集间隔（小时）</Text>
              <Text style={styles.switchDesc}>距上次自动采集达到该间隔后触发</Text>
            </View>
            <Input
              size="sm"
              style={{ width: 90 }}
              keyboardType="numeric"
              editable={localConfig.autoEnabled}
              value={localConfig.autoIntervalHours}
              onChangeText={(text) => setLocalConfig({ ...localConfig, autoIntervalHours: text })}
            />
          </View>

          <View style={styles.switchRow}>
            <View style={styles.switchInfo}>
              <Text style={styles.switchTitle}>启动时立即采集</Text>
              <Text style={styles.switchDesc}>应用启动后自动执行一次增量采集</Text>
            </View>
            <Switch
              value={localConfig.autoOnStartup}
              onValueChange={(checked) => setLocalConfig({ ...localConfig, autoOnStartup: checked })}
              disabled={!localConfig.autoEnabled}
              trackColor={{ false: colors.swiftTrack, true: colors.swiftActiveTrack }}
              thumbColor={colors.swiftThumb}
            />
          </View>

          <View style={styles.lastRunBox}>
            <Text style={styles.lastRunText}>
              上次自动采集：{autoLastRunAt ? new Date(autoLastRunAt).toLocaleString() : '从未执行'}
            </Text>
          </View>
        </View>
      </View>
    </ScrollView>
    </BlurredBackground>
  );
}
