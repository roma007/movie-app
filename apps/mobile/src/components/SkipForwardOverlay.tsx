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
  onSkip: (delta: number) => void;
  onClose: () => void;
}

export function SkipForwardOverlay({ show, onSkip, onClose }: Props) {
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
      gap: 6,
    },
    label: {
      color: colors.text,
      fontSize: s(12),
      fontWeight: '500',
    },
    closeButton: {
      padding: 2,
    },
  }), [colors, s, cardOpacity]);

  if (!show) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>快进</Text>
      <Button variant="secondary" size="sm" onPress={() => onSkip(90)}>
        1分半
      </Button>
      <Button variant="secondary" size="sm" onPress={() => onSkip(120)}>
        2分钟
      </Button>
      <Button variant="icon" size="sm" style={styles.closeButton} onPress={onClose}>
        <X size={14} color={colors.mutedForeground} />
      </Button>
    </View>
  );
}
