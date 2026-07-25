import { useMemo } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { useThemeStore } from '../themes/store';

const DEFAULT_BG = require('../../assets/default-poster.jpg');

interface BlurredBackgroundProps {
  imageUrl?: string | null;
  children: React.ReactNode;
}

export default function BlurredBackground({ imageUrl, children }: BlurredBackgroundProps) {
  const blurIntensity = useThemeStore((s) => s.blurIntensity);
  const imageBlur = useThemeStore((s) => s.imageBlur);
  const imageScale = useThemeStore((s) => s.imageScale);

  const imageSource = useMemo(() => {
    if (imageUrl) return { uri: imageUrl };
    return DEFAULT_BG;
  }, [imageUrl]);

  return (
    <View style={styles.container}>
      <Image source={imageSource} style={[StyleSheet.absoluteFill, { transform: [{ scale: imageScale }] }]} resizeMode="cover" blurRadius={imageBlur} />
      <BlurView intensity={blurIntensity} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.overlay} />
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
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  content: {
    flex: 1,
  },
});
