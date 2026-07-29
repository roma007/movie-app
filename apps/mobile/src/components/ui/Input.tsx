import React from 'react';
import { TextInput, StyleSheet, TextInputProps, TextStyle } from 'react-native';
import { useThemeColors } from '../../themes/useThemeColors';
import { useThemeStore } from '../../themes/store';
import { useScaledFontSize } from '../../themes/useScaledFontSize';
import { hexToRgba } from '../../themes/colorUtils';
import { radius } from '../../themes/radiusTokens';

export type InputSize = 'sm' | 'md' | 'lg';

interface InputProps extends TextInputProps {
  size?: InputSize;
  error?: boolean;
}

export function Input({
  size = 'md',
  error = false,
  style,
  ...props
}: InputProps) {
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const s = useScaledFontSize();

  const getSizeStyle = (): TextStyle => {
    switch (size) {
      case 'sm':
        return {
          paddingVertical: 6,
          paddingHorizontal: 10,
          borderRadius: radius.sm,
          fontSize: s(13),
        };
      case 'md':
        return {
          paddingVertical: 10,
          paddingHorizontal: 12,
          borderRadius: radius.md,
          fontSize: s(14),
        };
      case 'lg':
        return {
          paddingVertical: 12,
          paddingHorizontal: 14,
          borderRadius: radius.md,
          fontSize: s(15),
        };
      default:
        return {
          paddingVertical: 10,
          paddingHorizontal: 12,
          borderRadius: radius.md,
          fontSize: s(14),
        };
    }
  };

  const containerStyle = StyleSheet.flatten([
    styles.base,
    {
      backgroundColor: hexToRgba(colors.input, cardOpacity / 100 * 0.9),
      color: colors.text,
      borderColor: error ? colors.error : 'transparent',
    },
    getSizeStyle(),
    style,
  ]);

  return (
    <TextInput
      style={containerStyle}
      placeholderTextColor={colors.mutedForeground}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
  },
});
