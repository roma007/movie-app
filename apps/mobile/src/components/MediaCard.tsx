import React, { useMemo, useRef } from 'react';
import { Animated, Text, TouchableOpacity, StyleSheet, View, Dimensions } from 'react-native';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import { radius } from '../themes/radiusTokens';
import PosterImage from './PosterImage';
import type { Media } from '@movie-app/core';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = (SCREEN_WIDTH - 30 - 10) / 2;

interface MediaCardProps {
  media: Media;
  onPress: () => void;
  compact?: boolean;
}

export default function MediaCard({ media, onPress, compact = false }: MediaCardProps) {
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const s = useScaledFontSize();
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const onPressIn = () => {
    Animated.timing(scaleAnim, { toValue: 0.98, duration: 100, useNativeDriver: true }).start();
  };
  const onPressOut = () => {
    Animated.timing(scaleAnim, { toValue: 1, duration: 100, useNativeDriver: true }).start();
  };

  const styles = useMemo(() => StyleSheet.create({
    card: {
      width: CARD_WIDTH,
      marginBottom: 14,
      backgroundColor: hexToRgba(colors.card, cardOpacity / 100),
      borderRadius: radius.md,
      overflow: 'hidden',
    },
    poster: {
      width: CARD_WIDTH,
      height: CARD_WIDTH * 1.4,
      backgroundColor: hexToRgba(colors.surface, cardOpacity / 100 * 0.85),
    },
    placeholder: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    placeholderText: {
      fontSize: s(28),
      color: colors.disabledForeground,
      fontWeight: 'bold',
    },
    title: {
      fontSize: s(14),
      color: colors.text,
      marginTop: 6,
      lineHeight: s(18),
    },
    year: {
      fontSize: s(12),
      color: colors.textSecondary,
      marginTop: 2,
    },
    posterContainer: {
      width: CARD_WIDTH,
      height: CARD_WIDTH * 1.4,
      borderRadius: radius.md,
      overflow: 'hidden',
    },
    badgeContainer: {
      position: 'absolute',
      top: 8,
      left: 8,
    },
    badge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.full,
      overflow: 'hidden',
    },
    badgePrimary: {
      backgroundColor: hexToRgba(colors.mutedForeground, 0.8),
    },
    badgeMuted: {
      backgroundColor: hexToRgba(colors.mutedForeground, 0.8),
    },
    badgeText: {
      fontSize: s(11),
      color: '#ffffff',
    },
    actors: {
      fontSize: s(12),
      color: colors.textSecondary,
      marginTop: 2,
    },
    compactCard: {
      width: 100,
      marginRight: 10,
    },
    compactPoster: {
      width: 100,
      height: 140,
      borderRadius: radius.sm,
      backgroundColor: hexToRgba(colors.surface, cardOpacity / 100 * 0.85),
    },
    compactPlaceholder: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    compactTitle: {
      fontSize: s(12),
      color: colors.textSecondary,
      marginTop: 4,
      textAlign: 'center',
    },
  }), [colors, cardOpacity, s]);

  if (compact) {
    return (
      <TouchableOpacity style={styles.compactCard} onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut}>
        <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
          {media.posterUrl ? (
            <PosterImage uri={media.posterUrl} style={styles.compactPoster} placeholder={<Text style={styles.placeholderText}>{media.title[0]}</Text>} />
          ) : (
            <View style={[styles.compactPlaceholder, styles.compactPoster]}>
              <Text style={styles.placeholderText}>{media.title[0]}</Text>
            </View>
          )}
          <Text style={styles.compactTitle} numberOfLines={1}>{media.title}</Text>
        </Animated.View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut}>
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <View style={styles.posterContainer}>
        {media.posterUrl ? (
          <PosterImage uri={media.posterUrl} style={styles.poster} placeholder={<Text style={styles.placeholderText}>{media.title[0]}</Text>} />
        ) : (
          <View style={[styles.placeholder, styles.poster]}>
            <Text style={styles.placeholderText}>{media.title[0]}</Text>
          </View>
        )}
        {(media.status === 'ONGOING' || media.status === 'PUBLISHED') && media.type !== 'VARIETY' && media.currentEpisodes && (
          <View style={styles.badgeContainer}>
            <View style={[styles.badge, styles.badgePrimary]}>
              <Text style={styles.badgeText}>更新至第{media.currentEpisodes}集</Text>
            </View>
          </View>
        )}
        {(media.status === 'ONGOING' || media.status === 'PUBLISHED') && media.type === 'VARIETY' && media.remarks && (
          <View style={styles.badgeContainer}>
            <View style={[styles.badge, styles.badgePrimary]}>
              <Text style={styles.badgeText}>{media.remarks}</Text>
            </View>
          </View>
        )}
        {media.status === 'COMPLETED' && media.type !== 'VARIETY' && media.totalEpisodes != null && (
          <View style={styles.badgeContainer}>
            <View style={[styles.badge, styles.badgeMuted]}>
              <Text style={styles.badgeText}>完结 全{media.totalEpisodes}集</Text>
            </View>
          </View>
        )}
        {media.status === 'COMPLETED' && media.type !== 'VARIETY' && media.totalEpisodes == null && (
          <View style={styles.badgeContainer}>
            <View style={[styles.badge, styles.badgeMuted]}>
              <Text style={styles.badgeText}>已完结</Text>
            </View>
          </View>
        )}
        {media.status === 'COMPLETED' && media.type === 'VARIETY' && media.remarks && (
          <View style={styles.badgeContainer}>
            <View style={[styles.badge, styles.badgeMuted]}>
              <Text style={styles.badgeText}>{media.remarks}</Text>
            </View>
          </View>
        )}
      </View>
      <Text style={styles.title} numberOfLines={1}>{media.title}</Text>
      {media.actors.length > 0 && (
        <Text style={styles.actors} numberOfLines={1}>
          {media.actors.slice(0, 2).join(' / ')}
        </Text>
      )}
      <Text style={styles.year}>{media.year} · {media.area || '未知'}</Text>
      </Animated.View>
    </TouchableOpacity>
  );
}
