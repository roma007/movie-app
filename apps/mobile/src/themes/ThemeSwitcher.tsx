import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useThemeStore } from './store';
import { themes } from './config';
import type { ThemeId } from './types';

export default function ThemeSwitcher() {
  const currentTheme = useThemeStore((s) => s.currentTheme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const themeList = useMemo(() => Object.values(themes), []);

  return (
    <View style={styles.grid}>
      {themeList.map((t) => {
        const isActive = t.id === currentTheme;
        return (
          <TouchableOpacity
            key={t.id}
            style={[styles.card, isActive && { borderColor: t.colors.primary }]}
            onPress={() => setTheme(t.id)}
          >
            <View style={styles.colorRow}>
              <View style={[styles.colorDot, { backgroundColor: t.colors.background }]} />
              <View style={[styles.colorDot, { backgroundColor: t.colors.primary }]} />
            </View>
            <Text style={[styles.name, isActive && { color: t.colors.primary }]}>{t.name}</Text>
            <Text style={styles.desc}>{t.description}</Text>
            {isActive && <Text style={[styles.check, { color: t.colors.primary }]}>✓</Text>}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  card: {
    width: '47%',
    backgroundColor: '#1f1f1f',
    borderRadius: 10,
    padding: 12,
    borderWidth: 2,
    borderColor: '#333',
  },
  colorRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  colorDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  name: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  desc: {
    color: '#888',
    fontSize: 11,
    marginTop: 2,
  },
  check: {
    position: 'absolute',
    top: 8,
    right: 8,
    fontSize: 14,
    fontWeight: 'bold',
  },
});
