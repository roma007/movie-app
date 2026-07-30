import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { radius } from '../themes/radiusTokens';
import { hexToRgba } from '../themes/colorUtils';
import { Button } from './ui/Button';
import { useAppStore } from '../useAppStore';
import type { UserUsageType } from '@movie-app/core';
import { Search, Film, Tv, Check } from 'lucide-react-native';

const OPTIONS: { type: UserUsageType; label: string; desc: string; icon: any }[] = [
  { type: 'SEARCH_FIRST', label: '搜索优先', desc: '临时搜索采集，找想看的视频', icon: Search },
  { type: 'NEW_MOVIES', label: '新片追逐', desc: '增量采集最新电影，挑选感兴趣的', icon: Film },
  { type: 'TV_SERIES', label: '追剧/综艺', desc: '追更电视剧/综艺，追完再增量采集', icon: Tv },
];

export default function UsageGuideModal() {
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const s = useScaledFontSize();
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState<Set<UserUsageType>>(new Set());
  const { setUserUsageTypes, checkGuideShown, markGuideShown } = useAppStore();

  const styles = useMemo(() => StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.8)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 30,
    },
    container: {
      width: '100%',
      backgroundColor: colors.background,
      borderRadius: radius.xl,
      padding: 24,
    },
    title: {
      fontSize: s(20),
      fontWeight: 'bold',
      color: colors.text,
      textAlign: 'center',
      marginBottom: 8,
    },
    subtitle: {
      fontSize: s(13),
      color: colors.mutedForeground,
      textAlign: 'center',
      marginBottom: 20,
      lineHeight: 18,
    },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      padding: 14,
      borderRadius: radius.lg,
      marginBottom: 10,
      backgroundColor: cardBg,
    },
    optionActive: {
      backgroundColor: hexToRgba(colors.mutedForeground, cardOpacity / 100 * 0.2),
      borderColor: colors.mutedForeground,
      borderWidth: 1,
    },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: radius.sm,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxActive: {
      backgroundColor: colors.mutedForeground,
    },

    optionTextWrap: {
      flex: 1,
    },
    optionLabel: {
      fontSize: s(15),
      fontWeight: '600',
      color: colors.text,
      marginBottom: 2,
    },
    optionLabelActive: {
      color: colors.text,
    },
    optionDesc: {
      fontSize: s(12),
      color: colors.mutedForeground,
    },
    btnRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 6,
    },
  }), [colors, cardBg, s]);

  useEffect(() => {
    checkGuideShown().then((shown) => {
      if (!shown) setVisible(true);
    });
  }, []);

  const handleToggle = (type: UserUsageType) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const dismiss = async () => {
    await markGuideShown();
    setVisible(false);
  };

  const handleConfirm = async () => {
    if (selected.size === 0) return;
    await setUserUsageTypes([...selected]);
    await dismiss();
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <Text style={styles.title}>选择你的使用方式</Text>
          <Text style={styles.subtitle}>
            可多选，首页将展示所有选中类型的核心功能卡片（后续可在设置中修改）
          </Text>

          {OPTIONS.map((opt) => {
            const isActive = selected.has(opt.type);
            const Icon = opt.icon;
            return (
              <TouchableOpacity
                key={opt.type}
                style={[styles.option, isActive && styles.optionActive]}
                onPress={() => handleToggle(opt.type)}
              >
                <View style={[styles.checkbox, isActive && styles.checkboxActive]}>
                  {isActive && <Check size={12} color="#fff" />}
                </View>
                <Icon size={22} color={isActive ? colors.text : colors.mutedForeground} />
                <View style={styles.optionTextWrap}>
                  <Text style={[styles.optionLabel, isActive && styles.optionLabelActive]}>
                    {opt.label}
                  </Text>
                  <Text style={styles.optionDesc}>{opt.desc}</Text>
                </View>
              </TouchableOpacity>
            );
          })}

          <View style={styles.btnRow}>
            <Button variant="secondary" size="md" onPress={dismiss}>
              跳过
            </Button>
            <Button variant="primary" size="md" onPress={handleConfirm} disabled={selected.size === 0}>
              确认（{selected.size} 项）
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

