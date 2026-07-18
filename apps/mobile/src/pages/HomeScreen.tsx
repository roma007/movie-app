import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ScrollView, ActivityIndicator, Dimensions, TextInput, Alert, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAppStore, getProvider } from '../useAppStore';
import MediaCard from '../components/MediaCard';
import UsageGuideModal from '../components/UsageGuideModal';
import type { Media, PaginatedMeta, UserUsageType } from '@movie-app/core';

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
  const {
    favorites, watchHistory, loadFavorites, loadWatchHistory,
    userUsageTypes, loadUserUsageTypes,
    collectLatest, isLoading: storeLoading,
    searchKeywordPreview, previewResults, previewLoading,
    saveSelectedPreviewItems, clearPreviewResults,
    videoSources, loadVideoSources,
  } = useAppStore();

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
  const [latestMedia, setLatestMedia] = useState<Media[]>([]);
  const [quickKeyword, setQuickKeyword] = useState('');
  const [selectedPreviewIds, setSelectedPreviewIds] = useState<Set<string>>(new Set([]));

  const isLoadingRef = useRef(false);
  const flatListRef = useRef<FlatList>(null);
  const scrollPositions = useRef<Record<string, number>>({});
  const scrollOffsetRef = useRef(0);

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
    scrollPositions.current[activeType] = scrollOffsetRef.current;
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
    if (!isLoading && allMedia.length > 0) {
      const savedOffset = scrollPositions.current[activeType];
      if (savedOffset !== undefined && savedOffset > 0) {
        setTimeout(() => {
          flatListRef.current?.scrollToOffset({ offset: savedOffset, animated: false });
        }, 50);
      }
    }
  }, [isLoading, allMedia, activeType]);

  const [sourcesChecked, setSourcesChecked] = useState(false);

  useEffect(() => {
    loadVideoSources().then(() => setSourcesChecked(true));
  }, []);

  useEffect(() => {
    if (sourcesChecked && videoSources.length === 0) {
      Alert.alert(
        '添加视频源',
        '还没有视频源，请先通过 AI 导入或手动添加视频源后再使用',
        [
          { text: '去添加', onPress: () => navigation.navigate('SourceManager') },
        ],
        { cancelable: false }
      );
    }
  }, [sourcesChecked, videoSources]);

  useEffect(() => {
    loadUserUsageTypes();
  }, []);

  useEffect(() => {
    if (userUsageTypes.includes('NEW_MOVIES')) {
      provider.listMedia({ type: 'MOVIE', page: 1, pageSize: 5, sort: 'latest' })
        .then((r) => setLatestMedia(r.items))
        .catch(() => {});
    }
  }, [userUsageTypes, provider]);

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

  const handleQuickPreview = useCallback(async () => {
    const kw = quickKeyword.trim();
    if (!kw) return;
    setSelectedPreviewIds(new Set([]));
    await searchKeywordPreview(kw);
  }, [quickKeyword, searchKeywordPreview]);

  const handleQuickCollect = useCallback(async () => {
    const items = previewResults.filter((p) => selectedPreviewIds.size === 0 || selectedPreviewIds.has(p.fingerprint));
    if (items.length === 0) {
      Alert.alert('提示', '请至少选择一个视频');
      return;
    }
    const count = await saveSelectedPreviewItems(items);
    if (count > 0) {
      Alert.alert('采集完成', `成功采集 ${count} 部视频`);
      clearPreviewResults();
      setQuickKeyword('');
    } else {
      Alert.alert('采集失败', '请重试');
    }
  }, [previewResults, selectedPreviewIds, saveSelectedPreviewItems, clearPreviewResults]);

  const handleMobileCollectLatest = useCallback(async () => {
    Alert.alert('增量采集', '开始从所有视频源采集最新内容...');
    await collectLatest();
    Alert.alert('完成', '增量采集完成');
    if (userUsageTypes.includes('NEW_MOVIES')) {
      provider.listMedia({ type: 'MOVIE', page: 1, pageSize: 5, sort: 'latest' })
        .then((r) => setLatestMedia(r.items))
        .catch(() => {});
    }
  }, [collectLatest, provider, userUsageTypes]);

  const toggleMobilePreviewItem = (fingerprint: string) => {
    setSelectedPreviewIds((prev) => {
      const next = new Set(prev);
      if (next.has(fingerprint)) next.delete(fingerprint);
      else next.add(fingerprint);
      return next;
    });
  };

  const renderSearchFirstCard = () => (
    <View style={styles.usageCard}>
      <Text style={styles.usageCardTitle}>🔍 快速搜索采集</Text>
      <Text style={styles.usageCardDesc}>输入关键词搜索并一键采集你想看的视频</Text>
      <View style={styles.quickSearchRow}>
        <TextInput
          style={styles.quickSearchInput}
          placeholder="输入电影/电视剧名称..."
          placeholderTextColor="#666"
          value={quickKeyword}
          onChangeText={setQuickKeyword}
          onSubmitEditing={handleQuickPreview}
        />
        <TouchableOpacity style={styles.quickSearchBtn} onPress={handleQuickPreview} disabled={previewLoading}>
          <Text style={styles.quickSearchBtnText}>{previewLoading ? '搜索中' : '预览'}</Text>
        </TouchableOpacity>
      </View>
      {previewResults.length > 0 && (
        <View style={styles.previewList}>
          {previewResults.map((item) => (
            <TouchableOpacity
              key={item.fingerprint}
              style={styles.previewItem}
              onPress={() => toggleMobilePreviewItem(item.fingerprint)}
            >
              <Text style={styles.previewCheck}>
                {selectedPreviewIds.size === 0 || selectedPreviewIds.has(item.fingerprint) ? '☑' : '☐'}
              </Text>
              {item.posterUrl && (
                <Image source={{ uri: item.posterUrl }} style={styles.previewPoster} />
              )}
              <View style={styles.previewInfo}>
                <Text style={styles.previewTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.previewMeta}>{item.year} · {item.type} · {item.sourceName}</Text>
              </View>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.collectAllBtn} onPress={handleQuickCollect}>
            <Text style={styles.collectAllBtnText}>
              一键采集（{selectedPreviewIds.size === 0 ? previewResults.length : selectedPreviewIds.size} 部）
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const renderNewMoviesCard = () => (
    <View style={styles.usageCard}>
      <Text style={styles.usageCardTitle}>🎬 新片增量采集</Text>
      <TouchableOpacity style={styles.collectActionBtn} onPress={handleMobileCollectLatest} disabled={storeLoading}>
        <Text style={styles.collectActionBtnText}>{storeLoading ? '采集中...' : '开始增量采集'}</Text>
      </TouchableOpacity>
      {latestMedia.length > 0 && (
        <>
          <Text style={styles.usageCardSubtitle}>最新入库</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {latestMedia.map((m) => (
              <MediaCard
                key={m.id}
                media={m}
                compact
                onPress={() => navigation.navigate('Detail', { id: m.id })}
              />
            ))}
          </ScrollView>
        </>
      )}
    </View>
  );

  const renderTvSeriesCard = () => {
    const tvWatchHistory = watchHistory.filter((h) => {
      const media = historyMediaList.find((m) => m.id === h.mediaId);
      return media && (media.type === 'TV' || media.type === 'VARIETY');
    });
    return (
      <View style={styles.usageCard}>
        <Text style={styles.usageCardTitle}>📺 我的追剧</Text>
        {tvWatchHistory.length === 0 ? (
          <Text style={styles.usageCardDesc}>暂无追剧记录，观看电视剧或综艺后会显示在这里</Text>
        ) : (
          tvWatchHistory.slice(0, 5).map((h) => {
            const media = historyMediaList.find((m) => m.id === h.mediaId);
            if (!media) return null;
            const progressPct = h.duration > 0 ? Math.min(Math.round((h.progress / h.duration) * 100), 100) : 0;
            return (
              <TouchableOpacity
                key={h.id}
                style={styles.tvItem}
                onPress={() => navigation.navigate('Detail', { id: media.id })}
              >
                <View style={styles.tvItemLeft}>
                  <Text style={styles.tvItemTitle} numberOfLines={1}>{media.title}</Text>
                  <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
                  </View>
                </View>
                <Text style={styles.tvItemPct}>{progressPct}%</Text>
                <Text style={styles.tvItemAction}>续看</Text>
              </TouchableOpacity>
            );
          })
        )}
        <TouchableOpacity style={styles.collectActionBtn} onPress={handleMobileCollectLatest} disabled={storeLoading}>
          <Text style={styles.collectActionBtnText}>{storeLoading ? '采集中...' : '增量采集新剧集'}</Text>
        </TouchableOpacity>
      </View>
    );
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
          {userUsageTypes.includes('SEARCH_FIRST') && renderSearchFirstCard()}
          {userUsageTypes.includes('NEW_MOVIES') && renderNewMoviesCard()}
          {userUsageTypes.includes('TV_SERIES') && renderTvSeriesCard()}
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
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
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
        onScroll={(event) => { scrollOffsetRef.current = event.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={16}
      />
      {videoSources.length > 0 && <UsageGuideModal />}
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
  usageCard: {
    marginHorizontal: 15,
    marginTop: 16,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 14,
  },
  usageCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  usageCardDesc: {
    fontSize: 12,
    color: '#888',
    marginBottom: 10,
  },
  usageCardSubtitle: {
    fontSize: 13,
    color: '#aaa',
    marginTop: 10,
    marginBottom: 8,
  },
  quickSearchRow: {
    flexDirection: 'row',
    gap: 8,
  },
  quickSearchInput: {
    flex: 1,
    backgroundColor: '#0f0f0f',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  quickSearchBtn: {
    backgroundColor: '#4a9eff',
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  quickSearchBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  previewList: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
    paddingTop: 10,
  },
  previewItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  previewCheck: {
    fontSize: 18,
    color: '#4a9eff',
  },
  previewPoster: {
    width: 36,
    height: 54,
    borderRadius: 4,
    backgroundColor: '#222',
  },
  previewInfo: {
    flex: 1,
  },
  previewTitle: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '500',
  },
  previewMeta: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
  },
  collectAllBtn: {
    backgroundColor: '#4a9eff',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  collectAllBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  collectActionBtn: {
    backgroundColor: '#4a9eff',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  collectActionBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  tvItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
    gap: 8,
  },
  tvItemLeft: {
    flex: 1,
  },
  tvItemTitle: {
    fontSize: 14,
    color: '#fff',
    marginBottom: 6,
  },
  progressBar: {
    height: 4,
    backgroundColor: '#333',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4a9eff',
    borderRadius: 2,
  },
  tvItemPct: {
    fontSize: 12,
    color: '#4a9eff',
    fontWeight: '600',
    width: 36,
    textAlign: 'right',
  },
  tvItemAction: {
    fontSize: 12,
    color: '#4a9eff',
    fontWeight: '600',
  },
});
