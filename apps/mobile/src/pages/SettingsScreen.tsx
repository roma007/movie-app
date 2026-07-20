import { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity, Alert } from 'react-native';
import { useAppStore } from '../useAppStore';
import type { UserUsageType } from '@movie-app/core';

interface Props {
  navigation: any;
}

const USAGE_OPTIONS: { type: UserUsageType; label: string; desc: string; icon: string }[] = [
  { type: 'SEARCH_FIRST', label: '搜索优先', desc: '临时搜片', icon: '🔍' },
  { type: 'NEW_MOVIES', label: '新片追逐', desc: '增量看新片', icon: '🎬' },
  { type: 'TV_SERIES', label: '追剧/综艺', desc: '追更剧综', icon: '📺' },
];

export default function SettingsScreen({ navigation }: Props) {
  const { videoSources, loadVideoSources, toggleSourceEnabled, clearHistory, userUsageTypes, loadUserUsageTypes, setUserUsageTypes } = useAppStore();

  useEffect(() => {
    loadVideoSources();
    loadUserUsageTypes();
  }, []);

  const handleToggleUsage = (type: UserUsageType) => {
    const next = userUsageTypes.includes(type)
      ? userUsageTypes.filter((t) => t !== type)
      : [...userUsageTypes, type];
    if (next.length > 0) setUserUsageTypes(next);
  };

  const handleClearHistory = () => {
    Alert.alert('确认清除', '确定要清除所有观看历史吗？', [
      { text: '取消', style: 'cancel' },
      { text: '确定', style: 'destructive', onPress: () => clearHistory() },
    ]);
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>设置</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>视频源管理</Text>
        {videoSources.map((source: any) => (
          <View key={source.id} style={styles.sourceItem}>
            <View style={styles.sourceInfo}>
              <Text style={styles.sourceName}>{source.name}</Text>
              <Text style={styles.sourceUrl} numberOfLines={1}>{source.baseUrl}</Text>
            </View>
            <Switch
              value={source.isEnabled}
              onValueChange={(value) => toggleSourceEnabled(source.id, value)}
              trackColor={{ false: '#333', true: '#4a9eff' }}
              thumbColor={source.isEnabled ? '#fff' : '#666'}
            />
          </View>
        ))}
        <TouchableOpacity
          style={styles.manageButton}
          onPress={() => navigation.navigate('SourceManager')}
        >
          <Text style={styles.manageButtonText}>管理视频源</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>使用偏好（可多选）</Text>
        <View style={styles.usageRow}>
          {USAGE_OPTIONS.map((opt) => {
            const isActive = userUsageTypes.includes(opt.type);
            return (
              <TouchableOpacity
                key={opt.type}
                style={[styles.usageOption, isActive && styles.usageOptionActive]}
                onPress={() => handleToggleUsage(opt.type)}
              >
                <Text style={styles.usageCheck}>{isActive ? '✓' : ''}</Text>
                <Text style={styles.usageIcon}>{opt.icon}</Text>
                <Text style={[styles.usageLabel, isActive && styles.usageLabelActive]}>{opt.label}</Text>
                <Text style={styles.usageDesc}>{opt.desc}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>数据管理</Text>
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
        <Text style={styles.sectionTitle}>辅助</Text>
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
        <Text style={styles.sectionTitle}>关于</Text>
        <View style={styles.menuItem}>
          <Text style={styles.menuText}>版本</Text>
          <Text style={styles.menuValue}>1.0.6</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  header: { padding: 20, paddingTop: 60 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#fff' },
  section: { marginHorizontal: 15, marginBottom: 20, backgroundColor: '#1a1a1a', borderRadius: 12, overflow: 'hidden' },
  sectionTitle: { fontSize: 14, color: '#888', paddingHorizontal: 15, paddingTop: 15, paddingBottom: 10 },
  sourceItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 15, borderBottomWidth: 1, borderBottomColor: '#222' },
  sourceInfo: { flex: 1 },
  sourceName: { fontSize: 15, color: '#fff', marginBottom: 4 },
  sourceUrl: { fontSize: 12, color: '#666' },
  manageButton: { paddingVertical: 14, alignItems: 'center', backgroundColor: '#1f1f1f' },
  manageButtonText: { color: '#4a9eff', fontSize: 15 },
  menuItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 15, borderBottomWidth: 1, borderBottomColor: '#222' },
  menuText: { fontSize: 15, color: '#fff' },
  menuValue: { fontSize: 14, color: '#888' },
  usageRow: {
    flexDirection: 'row',
    paddingHorizontal: 15,
    paddingBottom: 15,
    gap: 10,
  },
  usageOption: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#1a1a1a',
  },
  usageOptionActive: {
    borderColor: '#4a9eff',
    backgroundColor: 'rgba(74, 158, 255, 0.1)',
  },
  usageCheck: {
    position: 'absolute',
    top: 4,
    right: 8,
    fontSize: 14,
    color: '#4a9eff',
    fontWeight: 'bold',
  },
  usageIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  usageLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 2,
  },
  usageLabelActive: {
    color: '#4a9eff',
  },
  usageDesc: {
    fontSize: 11,
    color: '#888',
  },
});
