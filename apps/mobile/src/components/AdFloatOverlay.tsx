import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, type ImageSourcePropType, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { X } from 'lucide-react-native';
import type { AdFloatItem } from '@movie-app/core';

interface AdFloatOverlayProps {
  ad: AdFloatItem;
  /** 播放器容器宽度（px），用于按比例计算浮窗尺寸。 */
  containerWidth: number;
  /** 浮窗宽占容器宽的最大比例。 */
  maxWidthRatio: number;
  /** 关闭按钮回调（用户主动关闭）。 */
  onClose: () => void;
  /** 到时自动消失回调。 */
  onDismissed: () => void;
  /** 顶部偏移（避开返回栏）。 */
  topOffset?: number;
}

const DEFAULT_DURATION_MS = 5000;

/** 播放中浮窗广告（移动端）。不打断播放，尺寸按广告素材等比缩放。 */
export function AdFloatOverlay({
  ad,
  containerWidth,
  maxWidthRatio,
  onClose,
  onDismissed,
  topOffset = 56,
}: AdFloatOverlayProps) {
  const [fadeIn, setFadeIn] = useState(false);
  const onDismissedRef = useRef(onDismissed);
  onDismissedRef.current = onDismissed;

  useEffect(() => {
    setFadeIn(false);
    const t = setTimeout(() => setFadeIn(true), 30);
    return () => clearTimeout(t);
  }, [ad]);

  useEffect(() => {
    const duration = ad.durationMs ?? DEFAULT_DURATION_MS;
    const timer = setTimeout(() => onDismissedRef.current(), duration);
    return () => clearTimeout(timer);
  }, [ad]);

  if (!ad.width || !ad.height) return null;

  const ratio = ad.height / ad.width;
  const width = Math.min(containerWidth * maxWidthRatio, 320);
  const height = Math.round(width * ratio);

  const imageSrc: ImageSourcePropType | null = ad.imageUrl ? { uri: ad.imageUrl } : null;

  return (
    <View
      pointerEvents="box-none"
      style={StyleSheet.absoluteFill}
    >
      <TouchableOpacity
        activeOpacity={0.85}
        style={[styles.wrap, { top: topOffset, right: 12, width, height, opacity: fadeIn ? 1 : 0 }]}
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
            <Text style={styles.placeholderTitle} numberOfLines={2}>
              {ad.title}
            </Text>
            {ad.durationMs ? (
              <Text style={styles.placeholderBadge}>展示 {Math.round(ad.durationMs / 1000)}s</Text>
            ) : null}
          </View>
        )}
        <Text style={styles.adTag}>广告</Text>
        <TouchableOpacity
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.close}
          onPress={(e) => {
            e.stopPropagation();
            onClose();
          }}
          accessibilityLabel="关闭广告"
        >
          <X size={14} color="#fff" />
        </TouchableOpacity>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    overflow: 'hidden',
    borderRadius: 10,
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
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    backgroundColor: '#1e293b',
  },
  placeholderTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  placeholderBadge: {
    marginTop: 6,
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
  close: {
    position: 'absolute',
    right: 6,
    top: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// 保证 StyleSheet 类型引用（上方 wrap 已作为 ViewStyle 使用）
export type { ViewStyle };
export const AD_FLOAT_DEFAULT_DURATION_MS = DEFAULT_DURATION_MS;