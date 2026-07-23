import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ScrollView, ActivityIndicator, Dimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getProvider } from '../useAppStore';
import MediaCard from '../components/MediaCard';
import type { Media, PaginatedMeta } from '@movie-app/core';

const PAGE_SIZE = 20;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

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

  const isLoadingRef = useRef(false);
  const flatListRef = useRef<FlatList>(null);

  const loadList = useCallback(async (pageNum: number, replace: boolean) => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    setIsLoading(true);
    try {
      const params: Record<string, any> = { page: pageNum, pageSize: PAGE_SIZE, type };
      if (selectedSubType) params.subType = selectedSubType;
      if (selectedYear) params.year = selectedYear;
      if (selectedArea) params.area = selectedArea;

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
  }, [type, selectedSubType, selectedYear, selectedArea, provider]);

  const loadFilterOptions = useCallback(async () => {
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
  }, [type, provider]);

  useEffect(() => {
    loadFilterOptions();
  }, [loadFilterOptions]);

  useEffect(() => {
    loadList(1, true);
  }, [selectedSubType, selectedYear, selectedArea, loadList]);

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

  const renderHeader = () => (
    <View>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{typeNames[type] || type}</Text>
      </View>

      <View style={styles.filtersContainer}>
        {renderFilterChips('分类', subTypes, selectedSubType || undefined, (v) => setSelectedSubType(v || ''))}
        {renderFilterChips('年份', years, selectedYear, (v) => setSelectedYear(v as number | undefined))}
        {renderFilterChips('地区', areas, selectedArea || undefined, (v) => setSelectedArea(v || ''))}
      </View>

      {meta && !isLoading && mediaList.length > 0 && (
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
        <Text style={styles.emptyText}>暂无数据</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
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
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        refreshing={isRefreshing}
        onRefresh={handleRefresh}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingTop: 56,
    paddingBottom: 4,
  },
  backBtn: {
    marginRight: 12,
    padding: 4,
  },
  backBtnText: {
    fontSize: 22,
    color: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
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
