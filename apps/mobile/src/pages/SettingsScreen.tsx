import { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity, Alert } from 'react-native';
import Slider from '@react-native-community/slider';
import { useAppStore } from '../useAppStore';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { hexToRgba } from '../themes/colorUtils';
import ThemeSwitcher from '../themes/ThemeSwitcher';
import BlurredBackground from '../components/BlurredBackground';
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
  const colors = useThemeColors();
  const blurIntensity = useThemeStore((s) => s.blurIntensity);
  const setBlurIntensity = useThemeStore((s) => s.setBlurIntensity);
  const imageBlur = useThemeStore((s) => s.imageBlur);
  const setImageBlur = useThemeStore((s) => s.setImageBlur);
  const imageScale = useThemeStore((s) => s.imageScale);
  const setImageScale = useThemeStore((s) => s.setImageScale);
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const setCardOpacity = useThemeStore((s) => s.setCardOpacity);

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

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1 },
    header: { padding: 20, paddingTop: 60 },
    title: { fontSize: 28, fontWeight: 'bold', color: colors.text },
    section: { marginHorizontal: 15, marginBottom: 20, backgroundColor: hexToRgba(colors.card, cardOpacity / 100), borderRadius: 12, overflow: 'hidden' },
    sectionTitle: { fontSize: 14, color: colors.mutedForeground, paddingHorizontal: 15, paddingTop: 15, paddingBottom: 10 },
    sourceItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 15, borderBottomWidth: 1, borderBottomColor: colors.border },
    sourceInfo: { flex: 1 },
    sourceName: { fontSize: 15, color: colors.text, marginBottom: 4 },
    sourceUrl: { fontSize: 12, color: colors.disabledForeground },
    manageButton: { paddingVertical: 14, alignItems: 'center', backgroundColor: colors.surface },
    manageButtonText: { color: colors.primary, fontSize: 15 },
    menuItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 15, borderBottomWidth: 1, borderBottomColor: colors.border },
    menuText: { fontSize: 15, color: colors.text },
    menuValue: { fontSize: 14, color: colors.mutedForeground },
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
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    usageOptionActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primaryLight,
    },
    usageCheck: {
      position: 'absolute',
      top: 4,
      right: 8,
      fontSize: 14,
      color: colors.primary,
      fontWeight: 'bold',
    },
    usageIcon: {
      fontSize: 20,
      marginBottom: 4,
    },
    usageLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
      marginBottom: 2,
    },
    usageLabelActive: {
      color: colors.primary,
    },
    usageDesc: {
      fontSize: 11,
      color: colors.mutedForeground,
    },
    blurRow: {
      paddingHorizontal: 15,
      paddingBottom: 15,
    },
    blurLabels: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 4,
    },
    blurLabel: {
      fontSize: 12,
      color: colors.mutedForeground,
    },
    blurValue: {
      fontSize: 14,
      color: colors.text,
      fontWeight: '600',
      textAlign: 'center',
      marginBottom: 8,
    },
  }), [colors, cardOpacity]);

  return (
    <BlurredBackground imageUrl={null}>
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>设置</Text>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>🎨 主题切换</Text>
        <ThemeSwitcher />
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>🌫️ 磨砂强度</Text>
        <View style={styles.blurRow}>
          <Text style={styles.blurValue}>{blurIntensity}</Text>
          <Slider
            minimumValue={0}
            maximumValue={100}
            step={5}
            value={blurIntensity}
            onValueChange={setBlurIntensity}
            minimumTrackTintColor={colors.primary}
            maximumTrackTintColor={colors.border}
            thumbTintColor={colors.primary}
          />
          <View style={styles.blurLabels}>
            <Text style={styles.blurLabel}>关闭</Text>
            <Text style={styles.blurLabel}>最强</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>🖼️ 背景图模糊</Text>
        <View style={styles.blurRow}>
          <Text style={styles.blurValue}>{imageBlur}</Text>
          <Slider
            minimumValue={0}
            maximumValue={100}
            step={5}
            value={imageBlur}
            onValueChange={setImageBlur}
            minimumTrackTintColor={colors.primary}
            maximumTrackTintColor={colors.border}
            thumbTintColor={colors.primary}
          />
          <View style={styles.blurLabels}>
            <Text style={styles.blurLabel}>清晰</Text>
            <Text style={styles.blurLabel}>最糊</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>🔍 背景图缩放</Text>
        <View style={styles.blurRow}>
          <Text style={styles.blurValue}>{imageScale}x</Text>
          <Slider
            minimumValue={1}
            maximumValue={50}
            step={1}
            value={imageScale}
            onValueChange={setImageScale}
            minimumTrackTintColor={colors.primary}
            maximumTrackTintColor={colors.border}
            thumbTintColor={colors.primary}
          />
<View style={styles.blurLabels}>
             <Text style={styles.blurLabel}>1x</Text>
             <Text style={styles.blurLabel}>50x</Text>
           </View>
         </View>
       </View>

       <View style={styles.section}>
         <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>🎨 卡片透明度</Text>
         <View style={styles.blurRow}>
           <Text style={styles.blurValue}>{cardOpacity}%</Text>
           <Slider
             minimumValue={10}
             maximumValue={100}
             step={1}
             value={cardOpacity}
             onValueChange={setCardOpacity}
             minimumTrackTintColor={colors.primary}
             maximumTrackTintColor={colors.border}
             thumbTintColor={colors.primary}
           />
           <View style={styles.blurLabels}>
             <Text style={styles.blurLabel}>10%</Text>
             <Text style={styles.blurLabel}>100%</Text>
           </View>
         </View>
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
              trackColor={{ false: colors.switchTrack, true: colors.primary }}
              thumbColor={source.isEnabled ? colors.primaryForeground : colors.disabledForeground}
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
          <Text style={styles.menuValue}>1.0.20</Text>
        </View>
      </View>
    </ScrollView>
    </BlurredBackground>
  );
}
