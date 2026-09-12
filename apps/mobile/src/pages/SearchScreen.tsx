import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { getCollector, getProvider, getStore } from '../useAppStore';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import { radius } from '../themes/radiusTokens';
import BlurredBackground from '../components/BlurredBackground';
import PosterImage from '../components/PosterImage';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { ArrowLeft } from 'lucide-react-native';
import { openMediaPlay } from '../utils/openMediaPlay';
import type { Media, PaginatedMeta } from '@movie-app/core';

const PAGE_SIZE = 20;

interface Props {
  navigation: any;
  route?: { params?: { keyword?: string } };
}

export default function SearchScreen({ navigation, route }: Props) {
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const surfaceBg = hexToRgba(colors.surface, cardOpacity / 100);
  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const s = useScaledFontSize();
  const [keyword, setKeyword] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchHistory, setSearchHistory] = useState<{ keyword: string; count: number }[]>([]);
  const [hotSearches, setHotSearches] = useState<{ keyword: string; count: number }[]>([]);
  const [results, setResults] = useState<Media[]>([]);
  const [meta, setMeta] = useState<PaginatedMeta | null>(null);
  const [page, setPage] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isLoadingRef = useRef(false);
  const searchIdRef = useRef(0);

  const refreshHistory = useCallback(() => {
    const provider = getProvider();
    provider.getSearchHistory(10).then(setSearchHistory).catch(() => {});
    provider.getHotSearches(10).then(setHotSearches).catch(() => {});
  }, []);

  const loadSearch = useCallback(async (kw: string, pageNum: number, replace: boolean, searchId: number) => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    if (replace) setSearching(true);
    else setIsLoadingMore(true);
    try {
      const result = await getProvider().searchMedia(kw, { page: pageNum, pageSize: PAGE_SIZE });
      if (searchIdRef.current !== searchId) return;
      if (replace) {
        setResults(result.items);
      } else {
        setResults(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const newItems = result.items.filter((m: Media) => !existingIds.has(m.id));
          return [...prev, ...newItems];
        });
      }
      setMeta(result.meta);
      setPage(pageNum);
      getStore().getState().scheduleRecommendationRecompute();
      refreshHistory();
    } catch (err) {
      console.error('搜索失败:', err);
    } finally {
      if (searchIdRef.current === searchId) {
        if (replace) setSearching(false);
        else setIsLoadingMore(false);
      }
      isLoadingRef.current = false;
    }
  }, [refreshHistory]);

  const runSearch = useCallback(async (kw: string) => {
    const id = ++searchIdRef.current;
    setSearching(true);
    try {
      const provider = getProvider();
      await provider.addSearchHistory(kw);
      await getCollector().collectByKeyword(kw);
      if (searchIdRef.current !== id) return;
      await loadSearch(kw, 1, true, id);
      if (searchIdRef.current === id) refreshHistory();
    } catch (err) {
      if (searchIdRef.current === id) console.error('搜索失败:', err);
    } finally {
      if (searchIdRef.current === id) setSearching(false);
    }
  }, [loadSearch, refreshHistory]);

  useEffect(() => {
    const kw = route?.params?.keyword;
    if (kw) {
      setKeyword(kw);
      getProvider().addSearchHistory(kw).catch(() => {});
      runSearch(kw);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.keyword]);

  const handleSearch = () => {
    const kw = keyword.trim();
    if (!kw) return;
    runSearch(kw);
  };

  const handleHistoryClick = (kw: string) => {
    setKeyword(kw);
    runSearch(kw);
  };

  const handleClearHistory = async () => {
    const provider = getProvider();
    await provider.clearSearchHistory();
    setSearchHistory([]);
  };

  const handleDeleteHistory = async (kw: string) => {
    const provider = getProvider();
    await provider.deleteSearchHistory(kw);
    setSearchHistory(prev => prev.filter(h => h.keyword !== kw));
  };

  const handleEndReached = () => {
    if (isLoadingRef.current || searching || !meta || page >= meta.totalPages) return;
    loadSearch(keyword, page + 1, false, searchIdRef.current);
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadSearch(keyword, 1, true, searchIdRef.current).finally(() => setIsRefreshing(false));
  };

  const renderItem = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={styles.item}
      onPress={() => openMediaPlay(navigation, item)}
    >
      {item.posterUrl && (
        <PosterImage uri={item.posterUrl} style={styles.poster} />
      )}
      <View style={styles.itemInfo}>
        <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.itemSubtitle}>
          {item.year} · {item.area || '未知'}
        </Text>
      </View>
    </TouchableOpacity>
  );

  const renderFooter = () => {
    if (!isLoadingMore) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator size="small" color={colors.mutedForeground} />
        <Text style={styles.footerText}>加载中...</Text>
      </View>
    );
  };

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1 },
    searchBar: { flexDirection: 'row', padding: 15, paddingTop: 60, gap: 10 },
    item: { flexDirection: 'row', padding: 15 },
    poster: { width: 80, height: 110, borderRadius: radius.sm, backgroundColor: cardBg },
    itemInfo: { flex: 1, marginLeft: 12, justifyContent: 'center' },
    itemTitle: { fontSize: s(16), color: colors.text, fontWeight: '500', marginBottom: 6 },
    itemSubtitle: { fontSize: s(13), color: colors.mutedForeground },
    empty: { color: colors.disabledForeground, textAlign: 'center', marginTop: 50, fontSize: s(15) },
    historyContainer: { padding: 15 },
    section: { marginBottom: 20 },
    sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
    sectionTitle: { fontSize: s(14), color: colors.mutedForeground, fontWeight: '500' },
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    tagContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: surfaceBg, borderRadius: radius.sm, overflow: 'hidden' },
    tag: { paddingHorizontal: 12, paddingVertical: 8 },
    tagText: { fontSize: s(14), color: colors.textSecondary },
    deleteIcon: { fontSize: s(14), color: colors.disabledForeground, paddingRight: 8 },
    hotTag: { flexDirection: 'row', alignItems: 'center', backgroundColor: surfaceBg, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8 },
    hotIndex: { fontSize: s(12), color: colors.error, marginRight: 6 },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 50 },
    loadingText: { fontSize: s(14), color: colors.mutedForeground, marginTop: 10 },
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
  }), [colors, surfaceBg, cardBg, s]);

  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);

  useEffect(() => {
    const first = results[0];
    if (!first?.posterUrl) {
      setBgImageUrl(null);
      return;
    }
    setBgImageUrl(first.posterUrl);
  }, [results]);

  return (
    <BlurredBackground imageUrl={bgImageUrl}>
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <Button variant="icon" size="sm" onPress={() => {
          if (navigation.canGoBack()) {
            navigation.goBack();
          } else {
            navigation.navigate('Home');
          }
        }}>
          <ArrowLeft size={20} color={colors.text} />
        </Button>
        <Input
          size="lg"
          style={{ flex: 1 }}
          placeholder="搜索电影、电视剧、综艺..."
          value={keyword}
          onChangeText={setKeyword}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        <Button variant="primary" size="md" onPress={handleSearch}>
          搜索
        </Button>
      </View>

      {searching ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.mutedForeground} />
          <Text style={styles.loadingText}>搜索中...</Text>
        </View>
      ) : results.length > 0 ? (
        <FlatList
          data={results}
          keyExtractor={(item: any) => item.id}
          renderItem={renderItem}
          ListFooterComponent={renderFooter}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.3}
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
        />
      ) : (
        <View style={styles.historyContainer}>
          {searchHistory.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>搜索历史</Text>
                <Button variant="link" size="sm" onPress={handleClearHistory}>
                  清空
                </Button>
              </View>
              <View style={styles.tagRow}>
                {searchHistory.map((item) => (
                  <View key={item.keyword} style={styles.tagContainer}>
                    <TouchableOpacity
                      style={styles.tag}
                      onPress={() => handleHistoryClick(item.keyword)}
                    >
                      <Text style={styles.tagText}>{item.keyword}</Text>
                    </TouchableOpacity>
                    <Button variant="ghost" size="sm" onPress={() => handleDeleteHistory(item.keyword)}>
                      <Text style={styles.deleteIcon}>×</Text>
                    </Button>
                  </View>
                ))}
              </View>
            </View>
          )}

          {results.length === 0 && keyword && !searching && (
            <Text style={styles.empty}>未找到相关内容</Text>
          )}
        </View>
      )}
    </View>
    </BlurredBackground>
  );
}