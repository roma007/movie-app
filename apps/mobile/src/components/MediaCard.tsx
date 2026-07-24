import React, { useMemo } from 'react';
import { Image, Text, TouchableOpacity, StyleSheet, View, Dimensions } from 'react-native';
import { useThemeColors } from '../themes/useThemeColors';
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

  const styles = useMemo(() => StyleSheet.create({
    card: {
      width: CARD_WIDTH,
      marginBottom: 14,
    },
    poster: {
      width: CARD_WIDTH,
      height: CARD_WIDTH * 1.4,
      borderRadius: 8,
      backgroundColor: '#222',
    },
    placeholder: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    placeholderText: {
      fontSize: 28,
      color: colors.disabledForeground,
      fontWeight: 'bold',
    },
    title: {
      fontSize: 14,
      color: colors.text,
      marginTop: 6,
      lineHeight: 18,
    },
    year: {
      fontSize: 12,
      color: colors.mutedForeground,
      marginTop: 2,
    },
    compactCard: {
      width: 100,
      marginRight: 10,
    },
    compactPoster: {
      width: 100,
      height: 140,
      borderRadius: 6,
      backgroundColor: '#222',
    },
    compactPlaceholder: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    compactTitle: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 4,
      textAlign: 'center',
    },
  }), [colors]);

  if (compact) {
    return (
      <TouchableOpacity style={styles.compactCard} onPress={onPress}>
        {media.posterUrl ? (
          <Image source={{ uri: media.posterUrl }} style={styles.compactPoster} />
        ) : (
          <View style={[styles.compactPlaceholder, styles.compactPoster]}>
            <Text style={styles.placeholderText}>{media.title[0]}</Text>
          </View>
        )}
        <Text style={styles.compactTitle} numberOfLines={1}>{media.title}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      {media.posterUrl ? (
        <Image source={{ uri: media.posterUrl }} style={styles.poster} />
      ) : (
        <View style={[styles.placeholder, styles.poster]}>
          <Text style={styles.placeholderText}>{media.title[0]}</Text>
        </View>
      )}
      <Text style={styles.title} numberOfLines={1}>{media.title}</Text>
      <Text style={styles.year}>{media.year}</Text>
    </TouchableOpacity>
  );
}
