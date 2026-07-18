import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ScrollView, ActivityIndicator, Dimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAppStore, getProvider } from '../useAppStore';
import MediaCard from '../components/MediaCard';
import type { Media, PaginatedMeta } from '@movie-app/core';

const PAGE_SIZE = 20;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

const TYPES = [
  { key: '', label: '全部' },
  { key: 'MOVIE', label: '电影' },
  { key: 'TV', label: '电视剧' },
  { key: 'VARIETY', label: '综艺' },
  { key: 'ANIME', label: '动漫' },
  { key: 'DOCUMENTARY', label: '纪录片' },
];

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const provider = getProvider();
  const { favorites, watchHistory, loadFavorites, loadWatchHistory } = useAppStore();

  const [allMedia, setAllMedia] = useState<Media[]>([]);
  const [meta, setMeta] = useState<PaginatedMeta | null>(null);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [activeType, setActiveType] = useState('');
  const [subTypes, setSubTypes] = useState<string[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [selectedSubType, setSelectedSubType] = useState('');
  const [selectedYear, setSelectedYear] = useState<number | undefined>();
  const [selectedArea, setSelectedArea] = useState('');

  const [favMediaList, setFavMediaList] = useState<Media[]>([]);
  const [historyMediaList, setHistoryMediaList] = useState<Media[]>([]);

  const isLoadingRef = useRef(false);

  const loadList = useCallback(async (pageNum: number, replace: boolean) => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    setIsLoading(true);
    try {
      const params: Record<string, any> = { page: pageNum, pageSize: PAGE_SIZE };
      if (activeType) params.type = activeType;
      if (selectedSubType) params.subType = selectedSubType;
      if (selectedYear) params.year = selectedYear;
      if (selectedArea) params.area = selectedArea;

      const result = await provider.listMedia(params);

      if (replace) {
        setAllMedia(result.items);
      } else {
        setAllMedia(prev => {
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
  }, [activeType, selectedSubType, selectedYear, selectedArea, provider]);

  const loadFilterOptions = useCallback(async (type: string) => {
    if (!type) {
      setSubTypes([]);
      setYears([]);
      setAreas([]);
      return;
    }
    try {
      const [subs, yrs, areasList] = await Promise.all([
        provider.getSubTypesByType(type),
        provider.getYearsByType(type),
        provider.getAreasByType(type),
      ]);
      setSubTypes(subs);
      setYears(yrs);
      setAreas(areasList);
    } catch (err) {
      console.error('loadFilterOptions failed:', err);
    }
  }, [provider]);

  const handleTypeChange = (type: string) => {
    if (type === activeType) return;
    setActiveType(type);
    setSelectedSubType('');
    setSelectedYear(undefined);
    setSelectedArea('');
    setAllMedia([]);
    setMeta(null);
    loadFilterOptions(type);
  };

  useEffect(() => {
    loadList(1, true);
  }, [activeType, selectedSubType, selectedYear, selectedArea]);

  useEffect(() => {
    if (activeType !== '') return;
    loadFavorites();
    loadWatchHistory(1);
  }, [activeType, loadFavorites, loadWatchHistory]);

  useEffect(() => {
    if (favorites.length === 0) { setFavMediaList([]); return; }
    let cancelled = false;
    Promise.all(
      favorites.slice(0, 10).map(f => provider.getMediaById(f.mediaId).catch(() => null))
    ).then(list => {
      if (!cancelled) setFavMediaList(list.filter(Boolean) as Media[]);
    });
    return () => { cancelled = true; };
  }, [favorites, provider]);

  useEffect(() => {
    if (watchHistory.length === 0) { setHistoryMediaList([]); return; }
    let cancelled = false;
    Promise.all(
      watchHistory.slice(0, 10).map(h => provider.getMediaById(h.mediaId).catch(() => null))
    ).then(list => {
      if (!cancelled) setHistoryMediaList(list.filter(Boolean) as Media[]);
    });
    return () => { cancelled = true; };
  }, [watchHistory, provider]);

  const handleEndReached = () => {
    if (isLoadingRef.current || !meta || page >= meta.totalPages) return;
    loadList(page + 1, false);
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadList(1, true).finally(() => setIsRefreshing(false));
  };

  const renderFilterChips = (label: string, options: (string | number)[], selected: string | number | undefined, onSelect: (val: any) => void) => {
    if (options.length === 0) return null;
    return (
      <View style={styles.filterRow}>
        <Text style={styles.filterLabel}>{label}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <TouchableOpacity
            style={[styles.filterChip, !selected && styles.filterChipActive]}
            onPress={() => onSelect(undefined)}
          >
            <Text style={[styles.filterChipText, !selected && styles.filterChipTextActive]}>全部</Text>
          </TouchableOpacity>
          {options.map(opt => {
            const isActive = selected === opt;
            return (
              <TouchableOpacity
                key={String(opt)}
                style={[styles.filterChip, isActive && styles.filterChipActive]}
                onPress={() => onSelect(isActive ? undefined : opt)}
              >
                <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>{String(opt)}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    );
  };

  const renderQuickRow = (title: string, list: Media[]) => {
    if (list.length === 0) return null;
    return (
      <View style={styles.quickSection}>
        <Text style={styles.quickTitle}>{title}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {list.map(m => (
            <MediaCard
              key={m.id}
              media={m}
              compact
              onPress={() => navigation.navigate('Detail', { id: m.id })}
            />
          ))}
        </ScrollView>
      </View>
    );
  };

  const renderHeader = () => (
    <View>
      <View style={styles.header}>
        <Text style={styles.appTitle}>Movie App</Text>
      </View>

      <TouchableOpacity style={styles.searchBar} onPress={() => navigation.navigate('搜索')}>
        <Text style={styles.searchIcon}>🔍</Text>
        <Text style={styles.searchPlaceholder}>搜索电影、电视剧、综艺...</Text>
      </TouchableOpacity>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeTabs}>
        {TYPES.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.typeTab, activeType === t.key && styles.typeTabActive]}
            onPress={() => handleTypeChange(t.key)}
          >
            <Text style={[styles.typeTabText, activeType === t.key && styles.typeTabTextActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {activeType === '' ? (
        <>
          {renderQuickRow('最近观看', historyMediaList)}
          {renderQuickRow('我的收藏', favMediaList)}
        </>
      ) : (
        <View style={styles.filtersContainer}>
          {renderFilterChips('分类', subTypes, selectedSubType || undefined, (v) => setSelectedSubType(v || ''))}
          {renderFilterChips('年份', years, selectedYear, (v) => setSelectedYear(v as number | undefined))}
          {renderFilterChips('地区', areas, selectedArea || undefined, (v) => setSelectedArea(v || ''))}
        </View>
      )}

      {meta && !isLoading && allMedia.length > 0 && (
        <Text style={styles.count}>共 {meta.total} 部</Text>
      )}
    </View>
  );

  const renderFooter = () => {
    if (!isLoading) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator size="small" color="#4a9eff" />
        <Text style={styles.footerText}>加载中...</Text>
      </View>
    );
  };

  const renderEmpty = () => {
    if (isLoading) return null;
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>暂无数据，请先采集视频</Text>
      </View>
    );
  };

  return (
    <FlatList
      style={styles.container}
      data={allMedia}
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
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.3}
      refreshing={isRefreshing}
      onRefresh={handleRefresh}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f0f',
  },
  listContent: {
    paddingBottom: 20,
  },
  header: {
    paddingHorizontal: 15,
    paddingTop: 56,
    paddingBottom: 4,
  },
  appTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1f1f1f',
    marginHorizontal: 15,
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
    color: '#666',
  },
  typeTabs: {
    marginTop: 16,
    paddingHorizontal: 15,
  },
  typeTab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
  },
  typeTabActive: {
    backgroundColor: '#4a9eff',
  },
  typeTabText: {
    fontSize: 14,
    color: '#999',
    fontWeight: '500',
  },
  typeTabTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  quickSection: {
    marginTop: 20,
    paddingLeft: 15,
  },
  quickTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 10,
  },
  filtersContainer: {
    paddingHorizontal: 15,
    marginTop: 12,
  },
  filterRow: {
    marginBottom: 10,
  },
  filterLabel: {
    fontSize: 13,
    color: '#888',
    marginBottom: 6,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginRight: 8,
    borderRadius: 6,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  filterChipActive: {
    backgroundColor: 'rgba(74, 158, 255, 0.15)',
    borderColor: '#4a9eff',
  },
  filterChipText: {
    fontSize: 13,
    color: '#999',
  },
  filterChipTextActive: {
    color: '#4a9eff',
    fontWeight: '500',
  },
  count: {
    fontSize: 13,
    color: '#666',
    paddingHorizontal: 15,
    marginTop: 4,
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
    fontSize: 13,
    color: '#888',
  },
  emptyContainer: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  emptyText: {
    color: '#888',
    fontSize: 16,
  },
});
