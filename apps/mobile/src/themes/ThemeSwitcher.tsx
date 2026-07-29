import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useThemeStore } from './store';
import { useThemeColors } from './useThemeColors';
import { useScaledFontSize } from './useScaledFontSize';
import { radius } from './radiusTokens';
import { Check } from 'lucide-react-native';
import { themes } from './config';
import { hexToRgba } from './colorUtils';
import type { ThemeId } from './types';

export default function ThemeSwitcher() {
  const currentTheme = useThemeStore((s) => s.currentTheme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const colors = useThemeColors();
  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const s = useScaledFontSize();

  const themeList = useMemo(() => Object.values(themes), []);

  const styles = useMemo(() => StyleSheet.create({
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      paddingHorizontal: 15,
      paddingBottom: 15,
    },
    card: {
      width: '47%',
      backgroundColor: cardBg,
      borderRadius: radius.md,
      padding: 12,
    },
    colorRow: {
      flexDirection: 'row',
      gap: 6,
      marginBottom: 8,
    },
    colorDot: {
      width: 20,
      height: 20,
      borderRadius: radius.md,
    },
    name: {
      color: colors.text,
      fontSize: s(14),
      fontWeight: '600',
    },
    desc: {
      color: colors.mutedForeground,
      fontSize: s(11),
      marginTop: 2,
    },
    check: {
      position: 'absolute',
      top: 8,
      right: 8,
    },
  }), [colors, cardBg, s]);

  return (
    <View style={styles.grid}>
      {themeList.map((t) => {
        const isActive = t.id === currentTheme;
        return (
          <TouchableOpacity
            key={t.id}
            style={[styles.card, isActive && { backgroundColor: hexToRgba(t.colors.mutedForeground, cardOpacity / 100 * 0.2) }]}
            onPress={() => setTheme(t.id)}
          >
            <View style={styles.colorRow}>
              <View style={[styles.colorDot, { backgroundColor: t.colors.background }]} />
              <View style={[styles.colorDot, { backgroundColor: t.colors.mutedForeground }]} />
            </View>
            <Text style={[styles.name, isActive && { color: t.colors.text }]}>{t.name}</Text>
            <Text style={styles.desc}>{t.description}</Text>
            {isActive && <Check size={14} color={t.colors.text} style={styles.check} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
