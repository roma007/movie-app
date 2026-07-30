import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Dimensions, Animated } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getProvider } from '../useAppStore';
import { useThemeColors } from '../themes/useThemeColors';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import MediaCard from '../components/MediaCard';
import CategoryHeader from '../components/CategoryHeader';
import FilterDropdown from '../components/FilterDropdown';
import BlurredBackground from '../components/BlurredBackground';
import type { Media, PaginatedMeta } from '@movie-app/core';

const PAGE_SIZE = 20;

const filterCache = new Map<string, { subTypes: string[]; years: number[]; areas: string[] }>();
const shortDramaCache = new Map<string, boolean>();

function useDebounce(fn: () => void, delay: number, deps: any[]) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(fn, delay);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, deps);
}

const typeNames: Record<string, string> = {
  MOVIE: '电影',
  TV: '电视剧',
  VARIETY: '综艺',
  ANIME: '动漫',
  DOCUMENTARY: '纪录片',
};

interface CategoryScreenProps {
  type: string;
}

export default function CategoryScreen({ type }: CategoryScreenProps) {
  const navigation = useNavigation<any>();
  const provider = getProvider();
  const colors = useThemeColors();
  const s = useScaledFontSize();

  const [mediaList, setMediaList] = useState<Media[]>([]);
  const [meta, setMeta] = useState<PaginatedMeta | null>(null);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [subTypes, setSubTypes] = useState<string[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [selectedSubType, setSelectedSubType] = useState('');
  const [selectedYear, setSelectedYear] = useState<number | undefined>();
  const [selectedArea, setSelectedArea] = useState('');
  const [selectedEpisodeType, setSelectedEpisodeType] = useState<'short' | 'long' | undefined>();
  const [showShortDramaFilter, setShowShortDramaFilter] = useState(false);

  const [expandedFilter, setExpandedFilter] = useState<string | null>(null);

  const isLoadingRef = useRef(false);
  const flatListRef = useRef<FlatList>(null);
  const tabsHidden = useRef(new Animated.Value(0)).current;
  const prevScrollY = useRef(0);

  const loadList = useCallback(async (pageNum: number, replace: boolean) => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    setIsLoading(true);
    try {
      const params: Record<string, any> = { page: pageNum, pageSize: PAGE_SIZE, type };
      if (selectedSubType) params.subType = selectedSubType;
      if (selectedYear) params.year = selectedYear;
      if (selectedArea) params.area = selectedArea;
      if (selectedEpisodeType === 'short') params.isShortDrama = true;
      else if (selectedEpisodeType === 'long') params.isShortDrama = false;

      const result = await provider.listMedia(params);

      if (replace) {
        setMediaList(result.items);
      } else {
        setMediaList(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const newItems = result.items.filter((m: Media) => !existingIds.has(m.id));
          return [...prev, ...newItems];
        });
      }
      setMeta(result.meta);
      setPage(pageNum);
    } catch (err) {
      console.error('loadMediaList failed:', err);
    } finally {
      setIsLoading(false);
      isLoadingRef.current = false;
    }
  }, [type, selectedSubType, selectedYear, selectedArea, selectedEpisodeType, provider]);

  const loadFilterOptions = useCallback(async () => {
    const cached = filterCache.get(type);
    if (cached) {
      setSubTypes(cached.subTypes);
      setYears(cached.years);
      setAreas(cached.areas);
      return;
    }
    try {
      const [subs, yrs, areasList] = await Promise.all([
        provider.getSubTypesByType(type),
        provider.getYearsByType(type),
        provider.getAreasByType(type),
      ]);
      filterCache.set(type, { subTypes: subs, years: yrs, areas: areasList });
      setSubTypes(subs);
      setYears(yrs);
      setAreas(areasList);
    } catch (err) {
      console.error('loadFilterOptions failed:', err);
    }
  }, [type, provider]);

  useEffect(() => {
    loadFilterOptions();
  }, [loadFilterOptions]);

  useEffect(() => {
    if (type === 'TV') {
      const cached = shortDramaCache.get(type);
      if (cached !== undefined) {
        setShowShortDramaFilter(cached);
        return;
      }
      provider.hasShortDrama('TV').then((has) => {
        shortDramaCache.set(type, has);
        setShowShortDramaFilter(has);
      }).catch(() => setShowShortDramaFilter(false));
    } else {
      setShowShortDramaFilter(false);
    }
  }, [type, provider]);

  useDebounce(() => {
    loadList(1, true);
  }, 200, [selectedSubType, selectedYear, selectedArea, selectedEpisodeType, loadList]);

  const handleScroll = useCallback((event: any) => {
    const currentY = event.nativeEvent.contentOffset.y;
    const dy = currentY - prevScrollY.current;
    if (dy > 30 && currentY > 40) {
      Animated.timing(tabsHidden, { toValue: 1, duration: 150, useNativeDriver: false }).start();
    } else if (dy < -10) {
      Animated.timing(tabsHidden, { toValue: 0, duration: 150, useNativeDriver: false }).start();
    }
    prevScrollY.current = currentY;
  }, [tabsHidden]);

  const handleEndReached = () => {
    if (isLoadingRef.current || !meta || page >= meta.totalPages) return;
    loadList(page + 1, false);
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadList(1, true).finally(() => setIsRefreshing(false));
  };

  const toggleFilter = (name: string) => {
    setExpandedFilter(prev => prev === name ? null : name);
  };

  const subTypeOptions = useMemo(() =>
    subTypes.map(s => ({ label: s, value: s })),
  [subTypes]);

  const yearOptions = useMemo(() =>
    years.map(y => ({ label: String(y), value: y })),
  [years]);

  const areaOptions = useMemo(() =>
    areas.map(a => ({ label: a, value: a })),
  [areas]);

  const episodeOptions = useMemo(() => [
    { label: '短剧', value: 'short' },
    { label: '长剧', value: 'long' },
  ], []);

  const hasAnyFilter = subTypes.length > 0 || years.length > 0 || areas.length > 0 || showShortDramaFilter;

  const renderHeader = () => (
    <View>
      {meta && !isLoading && mediaList.length > 0 && (
        <Text style={styles.count}>共 {meta.total} 部</Text>
      )}
    </View>
  );

  const renderFooter = () => {
    if (!isLoading) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator size="small" color={colors.mutedForeground} />
        <Text style={styles.footerText}>加载中...</Text>
      </View>
    );
  };

  const renderEmpty = () => {
    if (isLoading) return null;
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>暂无数据</Text>
      </View>
    );
  };

  const styles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
    },
    dropdownOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 5,
      elevation: 5,
    },
    fixedHeader: {
      zIndex: 10,
    },
    listContent: {
      paddingBottom: 20,
    },
    filterBar: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      paddingHorizontal: 15,
      marginTop: 12,
    },
    count: {
      fontSize: s(13),
      color: colors.disabledForeground,
      paddingHorizontal: 15,
      marginTop: 8,
      marginBottom: 8,
    },
    row: {
      paddingHorizontal: 15,
      gap: 10,
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 20,
      gap: 8,
    },
    footerText: {
      fontSize: s(13),
      color: colors.mutedForeground,
    },
    emptyContainer: {
      paddingVertical: 60,
      alignItems: 'center',
    },
    emptyText: {
      color: colors.mutedForeground,
      fontSize: s(16),
    },
  }), [colors, s]);

  const bgImageUrl = mediaList[0]?.posterUrl ?? null;

  return (
    <BlurredBackground imageUrl={bgImageUrl}>
    <View style={styles.container}>
      {expandedFilter && (
        <TouchableOpacity
          style={styles.dropdownOverlay}
          activeOpacity={1}
          onPress={() => setExpandedFilter(null)}
        />
      )}
      <View style={styles.fixedHeader}>
        <CategoryHeader activeType={typeNames[type] || type} tabsHiddenAnim={tabsHidden} />

        {hasAnyFilter && (
          <View style={styles.filterBar}>
            {subTypes.length > 0 && (
              <FilterDropdown
                label="分类"
                options={subTypeOptions}
                selected={selectedSubType || undefined}
                onSelect={(v) => { setSelectedSubType((v as string) || ''); setExpandedFilter(null); }}
                isExpanded={expandedFilter === 'subType'}
                onToggle={() => toggleFilter('subType')}
              />
            )}
            {years.length > 0 && (
              <FilterDropdown
                label="年份"
                options={yearOptions}
                selected={selectedYear}
                onSelect={(v) => { setSelectedYear(v as number | undefined); setExpandedFilter(null); }}
                isExpanded={expandedFilter === 'year'}
                onToggle={() => toggleFilter('year')}
                grouped
              />
            )}
            {areas.length > 0 && (
              <FilterDropdown
                label="地区"
                options={areaOptions}
                selected={selectedArea || undefined}
                onSelect={(v) => { setSelectedArea((v as string) || ''); setExpandedFilter(null); }}
                isExpanded={expandedFilter === 'area'}
                onToggle={() => toggleFilter('area')}
              />
            )}
            {showShortDramaFilter && (
              <FilterDropdown
                label="剧集"
                options={episodeOptions}
                selected={selectedEpisodeType}
                onSelect={(v) => { setSelectedEpisodeType(v as 'short' | 'long' | undefined); setExpandedFilter(null); }}
                isExpanded={expandedFilter === 'episode'}
                onToggle={() => toggleFilter('episode')}
              />
            )}
          </View>
        )}
      </View>

      <FlatList
        ref={flatListRef}
        data={mediaList}
        renderItem={({ item }) => (
          <MediaCard
            media={item}
            onPress={() => navigation.navigate('Detail', { id: item.id })}
          />
        )}
        keyExtractor={item => item.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        ListHeaderComponent={renderHeader}
        ListFooterComponent={renderFooter}
        ListEmptyComponent={renderEmpty}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        refreshing={isRefreshing}
        onRefresh={handleRefresh}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    </View>
    </BlurredBackground>
  );
}
