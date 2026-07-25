import { useMemo, useRef, useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Dimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useThemeColors } from '../themes/useThemeColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TAB_GAP = 0;
const TAB_PADDING_H = 16;
const SCREEN_PADDING = 15;

const TYPES = [
  { key: 'HOME', label: '首页', route: 'Tabs' },
  { key: 'MOVIE', label: '电影', route: 'Movie' },
  { key: 'TV', label: '电视剧', route: 'TV' },
  { key: 'VARIETY', label: '综艺', route: 'Variety' },
  { key: 'ANIME', label: '动漫', route: 'Anime' },
  { key: 'DOCUMENTARY', label: '纪录片', route: 'Documentary' },
];

interface CategoryHeaderProps {
  activeType: string;
}

export default function CategoryHeader({ activeType }: CategoryHeaderProps) {
  const navigation = useNavigation<any>();
  const colors = useThemeColors();
  const scrollRef = useRef<ScrollView>(null);
  const [tabWidths, setTabWidths] = useState<number[]>([]);
  const screenWidth = Dimensions.get('window').width;
  const insets = useSafeAreaInsets();

  const activeIndex = TYPES.findIndex(t => t.label === activeType);

  const scrollToActive = useCallback((index: number) => {
    if (index < 0 || tabWidths.length === 0) return;

    const screenWidth = Dimensions.get('window').width;

    let centerDistance = 0;
    for (let i = 0; i <= index; i++) {
      const w = tabWidths[i] || 80;
      if (i === index) {
        centerDistance += (w + TAB_GAP) / 2;
      } else {
        centerDistance += w + TAB_GAP;
      }
    }

    const scrollAmount = centerDistance - screenWidth / 2 + SCREEN_PADDING;

    const totalWidth = tabWidths.reduce((sum, w) => sum + w + TAB_GAP, 0);
    const maxScroll = Math.max(0, totalWidth - screenWidth + SCREEN_PADDING * 2);
    const clampedScroll = Math.max(Math.min(scrollAmount, maxScroll), 0);

    scrollRef.current?.scrollTo({ x: clampedScroll, animated: true });
  }, [tabWidths]);

  useEffect(() => {
    if (activeIndex >= 0) {
      scrollToActive(activeIndex);
    }
  }, [activeIndex, scrollToActive]);

  const handleTabLayout = useCallback((index: number, width: number) => {
    setTabWidths(prev => {
      if (prev[index] === width) return prev;
      const next = [...prev];
      next[index] = width;
      return next;
    });
  }, []);

  const styles = useMemo(() => StyleSheet.create({
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      marginHorizontal: SCREEN_PADDING,
      marginTop: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 10,
    },
    searchIcon: {
      fontSize: 16,
      marginRight: 8,
    },
    searchPlaceholder: {
      fontSize: 15,
      color: colors.disabledForeground,
    },
    typeTabs: {
      marginTop: 16,
    },
    typeTabsContent: {
      paddingHorizontal: SCREEN_PADDING,
      alignItems: 'center',
    },
    typeTab: {
      paddingHorizontal: TAB_PADDING_H,
      paddingVertical: 8,
      marginRight: TAB_GAP,
    },
    typeTabText: {
      fontSize: 16,
      color: colors.foreground,
      fontWeight: '400',
      opacity: 0.6,
    },
    typeTabTextActive: {
      fontSize: 20,
      color: colors.text,
      fontWeight: '700',
      opacity: 1,
    },
  }), [colors]);

  return (
    <View style={{ paddingTop: insets.top + 8 }}>
      <TouchableOpacity style={styles.searchBar} onPress={() => navigation.navigate('搜索')}>
        <Text style={styles.searchIcon}>🔍</Text>
        <Text style={styles.searchPlaceholder}>搜索电影、电视剧、综艺...</Text>
      </TouchableOpacity>

      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.typeTabs}
        contentContainerStyle={styles.typeTabsContent}
      >
        {TYPES.map((t, i) => {
          const isActive = activeType === t.label;
          return (
            <TouchableOpacity
              key={t.key}
              style={styles.typeTab}
              onPress={() => navigation.navigate(t.route)}
              onLayout={(e) => handleTabLayout(i, e.nativeEvent.layout.width)}
            >
              <Text style={[styles.typeTabText, isActive && styles.typeTabTextActive, isActive && { transform: [{ translateY: -4 }] }]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}
