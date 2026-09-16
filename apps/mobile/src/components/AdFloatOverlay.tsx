import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, type ImageSourcePropType } from 'react-native';
import { Image } from 'expo-image';
import type { AdFloatItem } from '@movie-app/core';

interface AdFloatOverlayProps {
  ad: AdFloatItem;
  /** 顶部偏移（避开返回栏/安全区）。 */
  topOffset?: number;
  /** 到时自动消失回调。 */
  onDismissed: () => void;
}

const DEFAULT_DURATION_MS = 5000;
const BANNER_HEIGHT = 52;

/**
 * 播放中顶部横幅广告（移动端）。不打断播放，全宽横条、高度固定、
 * 从顶部滑入、到时自动滑出。
 */
export function AdFloatOverlay({ ad, topOffset = 0, onDismissed }: AdFloatOverlayProps) {
  const [visible, setVisible] = useState(false);
  const onDismissedRef = useRef(onDismissed);
  onDismissedRef.current = onDismissed;

  useEffect(() => {
    setVisible(false);
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, [ad]);

  useEffect(() => {
    const duration = ad.durationMs ?? DEFAULT_DURATION_MS;
    const timer = setTimeout(() => onDismissedRef.current(), duration);
    return () => clearTimeout(timer);
  }, [ad]);

  const imageSrc: ImageSourcePropType | null = ad.imageUrl ? { uri: ad.imageUrl } : null;

  return (
    <View
      pointerEvents="box-none"
      style={StyleSheet.absoluteFill}
    >
      <TouchableOpacity
        activeOpacity={0.85}
        style={[
          styles.wrap,
          {
            top: topOffset,
            height: BANNER_HEIGHT,
            transform: [{ translateY: visible ? 0 : -BANNER_HEIGHT }],
            opacity: visible ? 1 : 0,
          },
        ]}
        onPress={() => {
          if (ad.linkUrl) {
            Linking.openURL(ad.linkUrl).catch(() => {});
          }
        }}
      >
        {imageSrc ? (
          <Image source={imageSrc} style={styles.image} contentFit="cover" transition={120} />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderTitle} numberOfLines={1}>
              {ad.title}
            </Text>
            {ad.durationMs ? (
              <Text style={styles.placeholderBadge}>展示 {Math.round(ad.durationMs / 1000)}s</Text>
            ) : null}
          </View>
        )}
        <Text style={styles.adTag}>广告</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    overflow: 'hidden',
    backgroundColor: '#111827',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 24,
  },
  image: { width: '100%', height: '100%' },
  placeholder: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: '#1e293b',
  },
  placeholderTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 1,
  },
  placeholderBadge: {
    marginLeft: 8,
    color: 'rgba(255,255,255,0.8)',
    fontSize: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  adTag: {
    position: 'absolute',
    left: 6,
    top: 6,
    color: 'rgba(255,255,255,0.9)',
    fontSize: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    overflow: 'hidden',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
});

export const AD_FLOAT_DEFAULT_DURATION_MS = DEFAULT_DURATION_MS;