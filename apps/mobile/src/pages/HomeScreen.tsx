import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAppStore, getProvider } from '../useAppStore';
import { useThemeColors } from '../themes/useThemeColors';
import MediaCard from '../components/MediaCard';
import UsageGuideModal from '../components/UsageGuideModal';
import CategoryHeader from '../components/CategoryHeader';
import type { Media, UserUsageType } from '@movie-app/core';

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const provider = getProvider();
  const colors = useThemeColors();
  const {
    favorites, watchHistory, loadFavorites, loadWatchHistory,
    userUsageTypes, loadUserUsageTypes,
    collectLatest, isLoading: storeLoading,
    searchKeywordPreview, previewResults, previewLoading,
    saveSelectedPreviewItems, clearPreviewResults,
    videoSources, loadVideoSources,
  } = useAppStore();

  const [favMediaList, setFavMediaList] = useState<Media[]>([]);
  const [historyMediaList, setHistoryMediaList] = useState<Media[]>([]);
  const [latestMedia, setLatestMedia] = useState<Media[]>([]);
  const [quickKeyword, setQuickKeyword] = useState('');
  const [selectedPreviewIds, setSelectedPreviewIds] = useState<Set<string>>(new Set([]));

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
    loadFavorites();
    loadWatchHistory(1);
  }, []);

  useEffect(() => {
    if (userUsageTypes.includes('NEW_MOVIES')) {
      provider.listMedia({ type: 'MOVIE', page: 1, pageSize: 5, sort: 'latest' })
        .then((r) => setLatestMedia(r.items))
        .catch(() => {});
    }
  }, [userUsageTypes, provider]);

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
          placeholderTextColor={colors.disabledForeground}
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

  const renderHistoryCard = () => (
    <View style={styles.usageCard}>
      <View style={styles.cardHeader}>
        <Text style={styles.usageCardTitle}>🕐 观看历史 ({watchHistory.length})</Text>
      </View>
      {watchHistory.length === 0 ? (
        <Text style={styles.emptyCardText}>暂无观看历史</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {historyMediaList.map(m => (
            <MediaCard
              key={m.id}
              media={m}
              compact
              onPress={() => navigation.navigate('Detail', { id: m.id })}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );

  const renderFavoritesCard = () => (
    <View style={styles.usageCard}>
      <View style={styles.cardHeader}>
        <Text style={styles.usageCardTitle}>❤️ 我的收藏 ({favorites.length})</Text>
      </View>
      {favMediaList.length === 0 ? (
        <Text style={styles.emptyCardText}>暂无收藏</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {favMediaList.map(m => (
            <MediaCard
              key={m.id}
              media={m}
              compact
              onPress={() => navigation.navigate('Detail', { id: m.id })}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );

  const styles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      paddingBottom: 20,
    },
    usageCard: {
      marginHorizontal: 15,
      marginTop: 16,
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 14,
    },
    usageCardTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 4,
    },
    usageCardDesc: {
      fontSize: 12,
      color: colors.mutedForeground,
      marginBottom: 10,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    emptyCardText: {
      fontSize: 13,
      color: colors.mutedForeground,
      textAlign: 'center',
      paddingVertical: 16,
    },
    usageCardSubtitle: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 10,
      marginBottom: 8,
    },
    quickSearchRow: {
      flexDirection: 'row',
      gap: 8,
    },
    quickSearchInput: {
      flex: 1,
      backgroundColor: colors.background,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
    },
    quickSearchBtn: {
      backgroundColor: colors.primary,
      borderRadius: 8,
      paddingHorizontal: 16,
      justifyContent: 'center',
    },
    quickSearchBtnText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    previewList: {
      marginTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
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
      color: colors.primary,
    },
    previewPoster: {
      width: 36,
      height: 54,
      borderRadius: 4,
      backgroundColor: colors.card,
    },
    previewInfo: {
      flex: 1,
    },
    previewTitle: {
      fontSize: 14,
      color: colors.text,
      fontWeight: '500',
    },
    previewMeta: {
      fontSize: 11,
      color: colors.mutedForeground,
      marginTop: 2,
    },
    collectAllBtn: {
      backgroundColor: colors.primary,
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: 'center',
      marginTop: 8,
    },
    collectAllBtnText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    collectActionBtn: {
      backgroundColor: colors.primary,
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: 'center',
      marginTop: 8,
    },
    collectActionBtnText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    tvItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.card,
      gap: 8,
    },
    tvItemLeft: {
      flex: 1,
    },
    tvItemTitle: {
      fontSize: 14,
      color: colors.text,
      marginBottom: 6,
    },
    progressBar: {
      height: 4,
      backgroundColor: colors.borderLight,
      borderRadius: 2,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      backgroundColor: colors.primary,
      borderRadius: 2,
    },
    tvItemPct: {
      fontSize: 12,
      color: colors.primary,
      fontWeight: '600',
      width: 36,
      textAlign: 'right',
    },
    tvItemAction: {
      fontSize: 12,
      color: colors.primary,
      fontWeight: '600',
    },
  }), [colors]);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <CategoryHeader activeType="首页" />

        {userUsageTypes.includes('SEARCH_FIRST') && renderSearchFirstCard()}
        {userUsageTypes.includes('NEW_MOVIES') && renderNewMoviesCard()}
        {userUsageTypes.includes('TV_SERIES') && renderTvSeriesCard()}
        {renderHistoryCard()}
        {renderFavoritesCard()}
      </ScrollView>
      {videoSources.length > 0 && <UsageGuideModal />}
    </View>
  );
}
