import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity } from 'react-native';
import { ArrowLeft, Check } from 'lucide-react-native';
import { useAppStore, getProvider } from '../useAppStore';
import { useThemeColors } from '../themes/useThemeColors';
import { Button } from '../components/ui/Button';
import { useThemeStore } from '../themes/store';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import BlurredBackground from '../components/BlurredBackground';
import { SystemConfigService } from '@movie-app/core';
import type { UserUsageType } from '@movie-app/core';
import { radius } from '../themes/radiusTokens';

interface Props {
  navigation: any;
}

const USAGE_OPTIONS: { type: UserUsageType; label: string; desc: string }[] = [
  { type: 'SEARCH_FIRST', label: '搜索优先', desc: '临时搜片' },
  { type: 'NEW_MOVIES', label: '追新电影', desc: '增量看新片' },
  { type: 'TV_SERIES', label: '追剧/综艺', desc: '追更剧综' },
];

export default function UsagePreferencesScreen({ navigation }: Props) {
  const { userUsageTypes, loadUserUsageTypes, setUserUsageTypes } = useAppStore();
  const provider = getProvider();
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const s = useScaledFontSize();

  const [playbackEnabled, setPlaybackEnabled] = useState(true);
  const [playbackThreshold, setPlaybackThreshold] = useState(10);

  useEffect(() => {
    loadUserUsageTypes();
    new SystemConfigService(provider).getPlaybackConfig().then((cfg: any) => {
      setPlaybackEnabled(cfg.showNextEpisodeOverlay);
      setPlaybackThreshold(cfg.outroThresholdMinutes);
    }).catch(() => {});
  }, []);

  const handleToggleUsage = (type: UserUsageType) => {
    const next = userUsageTypes.includes(type)
      ? userUsageTypes.filter((t) => t !== type)
      : [...userUsageTypes, type];
    if (next.length > 0) setUserUsageTypes(next);
  };

  const handleTogglePlayback = async (next: boolean) => {
    setPlaybackEnabled(next);
    const configService = new SystemConfigService(provider);
    await configService.setPlaybackConfig({ showNextEpisodeOverlay: next });
  };

  const handleThresholdChange = async (minutes: number) => {
    setPlaybackThreshold(minutes);
    const configService = new SystemConfigService(provider);
    await configService.setPlaybackConfig({ outroThresholdMinutes: minutes });
  };

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1 },
    header: { paddingTop: 50, paddingHorizontal: 15, paddingBottom: 15 },
    headerRow: { flexDirection: 'row', alignItems: 'center' },
    title: { flex: 1, fontSize: s(18), fontWeight: 'bold', color: colors.text, textAlign: 'center' },
    placeholder: { width: 40 },
    content: { padding: 15 },
    card: {
      backgroundColor: cardBg,
      borderRadius: radius.lg,
      overflow: 'hidden',
      marginBottom: 20,
    },
    cardTitle: { fontSize: s(15), color: colors.text, paddingHorizontal: 15, paddingTop: 15, paddingBottom: 10 },
    menuItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 15 },
    menuText: { fontSize: s(15), color: colors.text },
    usageRow: {
      flexDirection: 'row',
      paddingHorizontal: 15,
      paddingBottom: 15,
      gap: 10,
    },
    usageOptionBtn: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: radius.md,
      alignItems: 'center',
    },
    usageOptionBtnActive: {
      backgroundColor: hexToRgba(colors.mutedForeground, cardOpacity / 100 * 0.3),
    },
    usageOptionBtnInactive: {
      backgroundColor: hexToRgba(colors.buttonSecondaryBg, cardOpacity / 100),
    },
    usageCheck: {
      position: 'absolute',
      top: 4,
      right: 8,
    },
    usageLabel: {
      fontSize: s(13),
      fontWeight: '600',
      color: colors.text,
      marginBottom: 2,
    },
    usageDesc: {
      fontSize: s(11),
      color: colors.mutedForeground,
    },
    thresholdRow: {
      paddingHorizontal: 15,
      paddingBottom: 15,
    },
    thresholdLabel: {
      fontSize: s(13),
      color: colors.mutedForeground,
      marginBottom: 10,
    },
    thresholdButtons: {
      flexDirection: 'row',
      gap: 10,
    },
    thresholdBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: radius.md,
    },
  }), [colors, cardBg, s, cardOpacity]);

  return (
    <BlurredBackground imageUrl={null}>
      <ScrollView style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Button variant="icon" size="sm" onPress={() => navigation.goBack()}>
              <ArrowLeft size={20} color={colors.text} />
            </Button>
            <Text style={styles.title}>使用偏好</Text>
            <View style={styles.placeholder} />
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>首页偏好（可多选）</Text>
            <View style={styles.usageRow}>
              {USAGE_OPTIONS.map((opt) => {
                const isActive = userUsageTypes.includes(opt.type);
                return (
                  <TouchableOpacity
                    key={opt.type}
                    style={[
                      styles.usageOptionBtn,
                      isActive ? styles.usageOptionBtnActive : styles.usageOptionBtnInactive,
                    ]}
                    onPress={() => handleToggleUsage(opt.type)}
                    activeOpacity={0.7}
                  >
                    {isActive && <Check size={14} color={colors.text} style={styles.usageCheck} />}
                    <Text style={styles.usageLabel}>{opt.label}</Text>
                    <Text style={styles.usageDesc}>{opt.desc}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.menuItem}>
              <Text style={styles.menuText}>启用片尾提示</Text>
              <Switch
                value={playbackEnabled}
                onValueChange={handleTogglePlayback}
                trackColor={{ false: colors.swiftTrack, true: colors.swiftActiveTrack }}
                thumbColor={playbackEnabled ? colors.swiftThumb : colors.disabledForeground}
              />
            </View>
            {playbackEnabled && (
              <View style={styles.thresholdRow}>
                <Text style={styles.thresholdLabel}>提前提示时间</Text>
                <View style={styles.thresholdButtons}>
                  {[5, 10, 15].map((m) => (
                    <Button
                      key={m}
                      variant="secondary"
                      size="sm"
                      active={playbackThreshold === m}
                      style={styles.thresholdBtn}
                      onPress={() => handleThresholdChange(m)}
                    >
                      {m} 分钟
                    </Button>
                  ))}
                </View>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </BlurredBackground>
  );
}
