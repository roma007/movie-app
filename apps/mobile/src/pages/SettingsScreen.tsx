import { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useAppStore } from '../useAppStore';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import BlurredBackground from '../components/BlurredBackground';
import { radius } from '../themes/radiusTokens';

interface Props {
  navigation: any;
}

export default function SettingsScreen({ navigation }: Props) {
  const { clearHistory } = useAppStore();
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const surfaceBg = hexToRgba(colors.surface, cardOpacity / 100);
  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const s = useScaledFontSize();

  const handleClearHistory = () => {
    Alert.alert('确认清除', '确定要清除所有观看历史吗？', [
      { text: '取消', style: 'cancel' },
      { text: '确定', style: 'destructive', onPress: () => clearHistory() },
    ]);
  };

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1 },
    header: { padding: 20, paddingTop: 60 },
    title: { fontSize: s(28), fontWeight: 'bold', color: colors.text },
    section: { marginHorizontal: 15, marginBottom: 20, backgroundColor: cardBg, borderRadius: radius.lg, overflow: 'hidden' },
    sectionPlain: { marginHorizontal: 15, marginBottom: 20, backgroundColor: surfaceBg, borderRadius: radius.lg, overflow: 'hidden' },
    menuItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 15 },
    menuText: { fontSize: s(15), color: colors.text },
    menuValue: { fontSize: s(14), color: colors.mutedForeground },
  }), [colors, surfaceBg, cardBg, s]);

  return (
    <BlurredBackground imageUrl={null}>
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>设置</Text>
      </View>

      <View style={styles.section}>
        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('UsagePreferences')}>
          <Text style={styles.menuText}>使用偏好</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('AppearanceSettings')}>
          <Text style={styles.menuText}>外观设置</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('SourceManager')}>
          <Text style={styles.menuText}>管理视频源</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('CollectConfig')}>
          <Text style={styles.menuText}>采集配置</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('TaskList')}>
          <Text style={styles.menuText}>采集任务</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('VideoManagement')}>
          <Text style={styles.menuText}>视频管理</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem} onPress={handleClearHistory}>
          <Text style={styles.menuText}>清除观看历史</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('CollectGuide')}>
          <Text style={styles.menuText}>采集教程</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('HelpCenter')}>
          <Text style={styles.menuText}>帮助中心</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('TestCollect')}>
          <Text style={styles.menuText}>测试采集</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <View style={styles.menuItem}>
          <Text style={styles.menuText}>版本</Text>
          <Text style={styles.menuValue}>1.0.21</Text>
        </View>
      </View>
    </ScrollView>
    </BlurredBackground>
  );
}
