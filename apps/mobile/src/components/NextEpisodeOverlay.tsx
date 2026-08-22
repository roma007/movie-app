import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useThemeColors } from '../themes/useThemeColors';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import { useThemeStore } from '../themes/store';
import { X } from 'lucide-react-native';
import { Button } from './ui/Button';
import { radius } from '../themes/radiusTokens';

interface Props {
  show: boolean;
  nextEpisodeTitle: string;
  onNext: () => void;
  onClose: () => void;
}

export function NextEpisodeOverlay({ show, nextEpisodeTitle, onNext, onClose }: Props) {
  const colors = useThemeColors();
  const s = useScaledFontSize();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);

  const styles = useMemo(() => StyleSheet.create({
    container: {
      position: 'absolute',
      top: 8,
      right: 8,
      zIndex: 30,
      backgroundColor: hexToRgba(colors.card, cardOpacity / 100),
      borderRadius: radius.sm,
      paddingHorizontal: 10,
      paddingVertical: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    title: {
      color: colors.text,
      fontSize: s(12),
      maxWidth: 120,
    },
    closeButton: {
      padding: 2,
    },
  }), [colors, s, cardOpacity]);

  if (!show) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title} numberOfLines={1}>{nextEpisodeTitle}</Text>
      <Button variant="primary" size="sm" onPress={onNext}>
        播放
      </Button>
      <Button variant="icon" size="sm" style={styles.closeButton} onPress={onClose}>
        <X size={14} color={colors.mutedForeground} />
      </Button>
    </View>
  );
}

