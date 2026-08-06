import { useMemo, useRef, useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Dimensions, Animated } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Menu } from 'lucide-react-native';
import { useThemeColors } from '../themes/useThemeColors';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSidebarStore } from '../stores/sidebarStore';
import SearchBar from './SearchBar';

const TAB_GAP = 0;
const TAB_PADDING_H = 16;
const SCREEN_PADDING = 15;
const TAB_MARGIN_TOP = 16;

const TYPES = [
  { key: 'HOME', label: '首页', route: 'Home' },
  { key: 'MOVIE', label: '电影', route: 'Movie' },
  { key: 'TV', label: '电视剧', route: 'TV' },
  { key: 'VARIETY', label: '综艺', route: 'Variety' },
  { key: 'ANIME', label: '动漫', route: 'Anime' },
  { key: 'DOCUMENTARY', label: '纪录片', route: 'Documentary' },
];

interface CategoryHeaderProps {
  activeType: string;
  tabsHiddenAnim?: Animated.Value;
}

export default function CategoryHeader({ activeType, tabsHiddenAnim }: CategoryHeaderProps) {
  const navigation = useNavigation<any>();
  const colors = useThemeColors();
  const s = useScaledFontSize();
  const scrollRef = useRef<ScrollView>(null);
  const [tabWidths, setTabWidths] = useState<number[]>([]);
  const [tabsHeight, setTabsHeight] = useState(0);
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

  const handleTabPress = useCallback((route: string) => {
    navigation.replace(route);
  }, [navigation]);

  const fontSizeNormal = s(16);
  const fontSizeActive = s(20);
  const lineHeightNormal = Math.round(fontSizeNormal * 1.4);
  const lineHeightActive = Math.round(fontSizeActive * 1.4);
  const tabPaddingV = Math.max(10, Math.round(12 * (fontSizeNormal / 16)));

  const styles = useMemo(() => StyleSheet.create({
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 15,
      marginTop: 12,
      gap: 8,
    },
    menuButton: {
      padding: 6,
    },
    typeTabs: {
      marginTop: TAB_MARGIN_TOP,
    },
    typeTabsContent: {
      paddingHorizontal: SCREEN_PADDING,
      alignItems: 'center',
    },
    typeTab: {
      paddingHorizontal: TAB_PADDING_H,
      paddingVertical: tabPaddingV,
      marginRight: TAB_GAP,
    },
    typeTabText: {
      fontSize: fontSizeNormal,
      lineHeight: lineHeightNormal,
      color: colors.textSecondary,
      fontWeight: '400',
    },
    typeTabTextActive: {
      fontSize: fontSizeActive,
      lineHeight: lineHeightActive,
      color: colors.text,
      fontWeight: '700',
    },
  }), [colors, fontSizeNormal, fontSizeActive, lineHeightNormal, lineHeightActive, tabPaddingV]);

  const { open: openSidebar } = useSidebarStore();

  // 折叠容器用 maxHeight（封顶）而非 height（强制）：横向 ScrollView 一旦有确定
  // 高度，视口被固定，字形/行盒残差会在底部被裁；maxHeight 下 ScrollView 始终按
  // 实际渲染内容自撑，视口恒等于真实内容高，天然不裁。
  // tabsHeight 取自真实容器/内容高度的测量（内层 View onLayout + onContentSizeChange），
  // 特大字号下标签行实际渲染高度大于各 tab 布局盒之和，必须按真实高度 + 余量封顶。
  const animContainerStyle = useMemo(() => {
    if (!tabsHiddenAnim) return {};
    return {
      maxHeight: tabsHiddenAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [tabsHeight + 20, 0],
        extrapolate: 'clamp',
      }),
      overflow: 'hidden' as const,
    };
  }, [tabsHiddenAnim, tabsHeight]);

  return (
    <View style={{ paddingTop: insets.top + 8, paddingBottom: 12 }}>
      <View style={styles.headerRow}>
        <TouchableOpacity style={styles.menuButton} onPress={openSidebar} activeOpacity={0.6}>
          <Menu size={22} color={colors.text} />
        </TouchableOpacity>
        <SearchBar />
      </View>

      <Animated.View style={animContainerStyle}>
        <View
          style={{ flexShrink: 0 }}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h > 0) {
              setTabsHeight(prev => Math.max(prev, h));
            }
          }}
        >
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.typeTabs}
            contentContainerStyle={styles.typeTabsContent}
            onContentSizeChange={(w, h) => {
              if (h > 0) {
                setTabsHeight(prev => Math.max(prev, h + TAB_MARGIN_TOP));
              }
            }}
          >
            {TYPES.map((t, i) => {
              const isActive = activeType === t.label;
              return (
                <TouchableOpacity
                  key={t.key}
                  style={styles.typeTab}
                  onPress={() => handleTabPress(t.route)}
                  onLayout={(e) => handleTabLayout(i, e.nativeEvent.layout.width)}
                >
                  <Text style={[styles.typeTabText, isActive && styles.typeTabTextActive]}>{t.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </Animated.View>
    </View>
  );
}
