import { useEffect, useRef } from 'react';
import { View, Image, Animated, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { BlurView } from 'expo-blur';
import { useThemeStore } from '../themes/store';

const DEFAULT_BG = require('../../assets/default-poster.jpg');
const FADE_DURATION = 300;

interface BlurredBackgroundProps {
  imageUrl?: string | null;
  children: React.ReactNode;
}

const OVERLAY_RGB: Record<'dark' | 'light', [number, number, number]> = {
  dark: [0, 0, 0],
  light: [255, 255, 255],
};

export default function BlurredBackground({ imageUrl, children }: BlurredBackgroundProps) {
  const blurIntensity = useThemeStore((s) => s.blurIntensity);
  const imageBlur = useThemeStore((s) => s.imageBlur);
  const imageScale = useThemeStore((s) => s.imageScale);
  const currentTheme = useThemeStore((s) => s.currentTheme);
  const cardOpacity = useThemeStore((s) => s.cardOpacity);

  const posterOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    posterOpacity.setValue(0);
  }, [imageUrl, posterOpacity]);

  const handlePosterLoad = () => {
    Animated.timing(posterOpacity, {
      toValue: 1,
      duration: FADE_DURATION,
      useNativeDriver: true,
    }).start();
  };

  return (
    <View style={styles.container}>
      <ExpoImage
        source={DEFAULT_BG}
        style={[StyleSheet.absoluteFill, { transform: [{ scale: imageScale }] }]}
        contentFit="cover"
        blurRadius={imageBlur}
      />
      {imageUrl ? (
        <Animated.Image
          source={{ uri: imageUrl }}
          style={[StyleSheet.absoluteFill, { transform: [{ scale: imageScale }] }, { opacity: posterOpacity }]}
          resizeMode="cover"
          blurRadius={imageBlur}
          onLoad={handlePosterLoad}
        />
      ) : null}
      <BlurView intensity={blurIntensity} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[styles.overlay, { backgroundColor: `rgba(${OVERLAY_RGB[currentTheme].join(', ')}, ${cardOpacity / 100})` }]} />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
  },
  content: {
    flex: 1,
  },
});
