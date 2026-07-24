import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Animated, Text, StyleSheet } from 'react-native';
import { useThemeColors } from '../themes/useThemeColors';

type ToastType = 'success' | 'error' | 'info';

interface ToastMessage {
  message: string;
  type: ToastType;
}

let globalToastFn: ((message: string, type?: ToastType) => void) | null = null;

export function showToast(message: string, type: ToastType = 'success') {
  globalToastFn?.(message, type);
}

export default function Toast() {
  const colors = useThemeColors();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-60)).current;

  const styles = useMemo(() => StyleSheet.create({
    container: {
      position: 'absolute',
      top: 60,
      left: 16,
      right: 16,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 10,
      zIndex: 9999,
      elevation: 9999,
      shadowColor: colors.playerBg,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
    },
    text: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '500',
    },
  }), [colors]);

  useEffect(() => {
    globalToastFn = (message: string, type: ToastType = 'success') => {
      setToast({ message, type });
    };
    return () => { globalToastFn = null; };
  }, []);

  useEffect(() => {
    if (toast) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]).start();

      const timer = setTimeout(() => {
        Animated.parallel([
          Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
          Animated.timing(translateY, { toValue: -60, duration: 250, useNativeDriver: true }),
        ]).start(() => setToast(null));
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [toast, opacity, translateY]);

  if (!toast) return null;

  const bgColor = toast.type === 'success' ? colors.success : toast.type === 'error' ? colors.error : colors.primary;

  return (
    <Animated.View
      style={[
        styles.container,
        { backgroundColor: bgColor, opacity, transform: [{ translateY }] },
      ]}
    >
      <Text style={styles.text} numberOfLines={2}>{toast.message}</Text>
    </Animated.View>
  );
}

