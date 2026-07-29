import React, { useState } from 'react';
import { TouchableOpacity, Text, ActivityIndicator, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { useThemeColors } from '../../themes/useThemeColors';
import { useThemeStore } from '../../themes/store';
import { useScaledFontSize } from '../../themes/useScaledFontSize';
import { hexToRgba } from '../../themes/colorUtils';
import { radius } from '../../themes/radiusTokens';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost' | 'link' | 'icon';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  disabled?: boolean;
  loading?: boolean;
  active?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  onPress?: () => void;
  children?: React.ReactNode;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  disabled = false,
  loading = false,
  active = false,
  leftIcon,
  rightIcon,
  onPress,
  children,
  style,
  textStyle,
}: ButtonProps) {
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const s = useScaledFontSize();
  const [pressed, setPressed] = useState(false);

  const getVariantStyle = (): { container: ViewStyle; text: TextStyle } => {
    switch (variant) {
      case 'primary':
        return {
          container: {
            backgroundColor: active
              ? hexToRgba(colors.mutedForeground, cardOpacity / 100 * 0.3)
              : hexToRgba(colors.buttonPrimaryBg, cardOpacity / 100 * 0.2),
          },
          text: { color: colors.buttonPrimaryText },
        };
      case 'secondary':
        return {
          container: {
            backgroundColor: active
              ? hexToRgba(colors.mutedForeground, cardOpacity / 100 * 0.3)
              : hexToRgba(colors.buttonSecondaryBg, cardOpacity / 100 * 0.2),
          },
          text: { color: colors.buttonSecondaryText },
        };
      case 'destructive':
        return {
          container: {
            backgroundColor: hexToRgba(colors.buttonDestructiveText, cardOpacity / 100 * 0.15),
          },
          text: { color: colors.buttonDestructiveText },
        };
      case 'ghost':
        return {
          container: { backgroundColor: 'transparent' },
          text: { color: colors.text },
        };
      case 'link':
        return {
          container: { backgroundColor: 'transparent' },
          text: { color: colors.text },
        };
      case 'icon':
        return {
          container: { backgroundColor: 'transparent' },
          text: { color: colors.text },
        };
      default:
        return {
          container: { backgroundColor: colors.buttonPrimaryBg },
          text: { color: colors.buttonPrimaryText },
        };
    }
  };

  const getSizeStyle = (): { container: ViewStyle; text: TextStyle } => {
    switch (size) {
      case 'sm':
        return {
          container: {
            paddingVertical: 6,
            paddingHorizontal: 12,
            borderRadius: radius.sm,
          },
          text: { fontSize: s(12) },
        };
      case 'md':
        return {
          container: {
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: radius.md,
          },
          text: { fontSize: s(14) },
        };
      case 'lg':
        return {
          container: {
            paddingVertical: 14,
            paddingHorizontal: 20,
            borderRadius: radius.md,
          },
          text: { fontSize: s(15) },
        };
      default:
        return {
          container: {
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: radius.md,
          },
          text: { fontSize: s(14) },
        };
    }
  };

  const hoverBg = hexToRgba(colors.hover, cardOpacity / 100);
  const variantStyle = getVariantStyle();
  const sizeStyle = getSizeStyle();

  const pressContainerBg = !active && !disabled && pressed && variant !== 'destructive' && variant !== 'link'
    ? hoverBg
    : undefined;
  const pressTextColor = !active && !disabled && pressed && (variant === 'secondary' || variant === 'ghost')
    ? colors.buttonPrimaryText
    : undefined;

  const containerStyle: ViewStyle = StyleSheet.flatten([
    styles.base,
    variantStyle.container,
    pressContainerBg && { backgroundColor: pressContainerBg },
    sizeStyle.container,
    fullWidth && styles.fullWidth,
    disabled && styles.disabled,
    style,
  ]);

  const textStyles: TextStyle = StyleSheet.flatten([
    styles.text,
    variantStyle.text,
    pressTextColor && { color: pressTextColor },
    sizeStyle.text,
    textStyle,
  ]);

  if (variant === 'icon') {
    return (
      <TouchableOpacity
        style={containerStyle}
        onPress={onPress}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        disabled={disabled || loading}
        activeOpacity={1}
      >
        {loading ? (
          <ActivityIndicator size="small" color={variantStyle.text.color} />
        ) : (
          children
        )}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={containerStyle}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled || loading}
      activeOpacity={1}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variantStyle.text.color} />
      ) : (
        <>
          {leftIcon ? <>{leftIcon}</> : null}
          {children ? <Text style={textStyles}>{children}</Text> : null}
          {rightIcon ? <>{rightIcon}</> : null}
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  text: {
    fontWeight: '500',
  },
  fullWidth: {
    width: '100%',
  },
  disabled: {
    opacity: 0.5,
  },
});
