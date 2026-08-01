import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Image, Switch, ActivityIndicator, Animated } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAppStore, getProvider } from '../useAppStore';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import MediaCard from '../components/MediaCard';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import UsageGuideModal from '../components/UsageGuideModal';
import CategoryHeader from '../components/CategoryHeader';
import BlurredBackground from '../components/BlurredBackground';
import type { Media, Episode, UserUsageType, WatchHistory } from '@movie-app/core';
import { radius } from '../themes/radiusTokens';
import { Sparkles, Film, Tv, Clock, Heart, CheckSquare, Square } from 'lucide-react-native';

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const provider = getProvider();
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const surfaceBg = hexToRgba(colors.surface, cardOpacity / 100);
  const s = useScaledFontSize();
  const {
    favorites, watchHistory, loadFavorites, loadWatchHistory,
    userUsageTypes, loadUserUsageTypes,
    collectLatest, isCollecting: storeLoading,
    searchKeywordPreview, previewResults, previewLoading,
    saveSelectedPreviewItems, clearPreviewResults,
    videoSources, loadVideoSources,
  } = useAppStore();

  const [favMediaList, setFavMediaList] = useState<Media[]>([]);
  const [historyMediaList, setHistoryMediaList] = useState<Media[]>([]);
  const [episodeMap, setEpisodeMap] = useState<Record<string, Episode>>({});
  const [watchedHistoryMap, setWatchedHistoryMap] = useState<Record<string, WatchHistory[]>>({});
  const [episodeTotalMap, setEpisodeTotalMap] = useState<Record<string, number>>({});
  const [sourceTotalMap, setSourceTotalMap] = useState<Record<string, Record<string, number>>>({});
  const [latestMedia, setLatestMedia] = useState<Media[]>([]);
  const [quickKeyword, setQuickKeyword] = useState('');
  const [selectedPreviewIds, setSelectedPreviewIds] = useState<Set<string>>(new Set([]));
  const [relaxBlacklist, setRelaxBlacklist] = useState(false);
  const [relaxYear, setRelaxYear] = useState(false);

  const [sourcesChecked, setSourcesChecked] = useState(false);

  useEffect(() => {
    loadVideoSources().then(() => setSourcesChecked(true));
  }, []);

  useEffect(() => {
    if (sourcesChecked && videoSources.length === 0) {
      Alert.alert(
        '添加视频源',
        '还没有视频源，使用 AI 智能导入可以快速添加',
        [
          { text: 'AI 导入', onPress: () => navigation.navigate('AiSourceImport') },
          { text: '手动添加', onPress: () => navigation.navigate('SourceManager') },
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

  useEffect(() => {
    const tvList = historyMediaList.filter((m) => m.type === 'TV' || m.type === 'VARIETY');
    if (tvList.length === 0) { setWatchedHistoryMap({}); setEpisodeTotalMap({}); setSourceTotalMap({}); setEpisodeMap({}); return; }
    let cancelled = false;
    Promise.all(
      tvList.map(async (m) => {
        const history = await provider.getAllWatchHistoryByMediaId(m.id).catch(() => [] as WatchHistory[]);
        let total: number | undefined;
        const sourceCounts: Record<string, number> = {};
        const eps = await provider.getEpisodesByMediaId(m.id).catch(() => [] as Episode[]);
        const seenBySource: Record<string, Set<string>> = {};
        for (const e of eps) {
          if (!e.sourceId) continue;
          (seenBySource[e.sourceId] ??= new Set()).add(`${e.seasonNumber}:${e.episodeNumber}`);
        }
        for (const [sid, set] of Object.entries(seenBySource)) sourceCounts[sid] = set.size;
        if (m.totalEpisodes == null && m.currentEpisodes == null) {
          total = new Set(eps.map((e) => `${e.seasonNumber}:${e.episodeNumber}`)).size;
        }
        return { id: m.id, history, total, sourceCounts } as const;
      })
    ).then(async (list) => {
      if (cancelled) return;
      setWatchedHistoryMap(Object.fromEntries(list.map((i) => [i.id, i.history])));
      setEpisodeTotalMap(Object.fromEntries(list.filter((i) => i.total != null).map((i) => [i.id, i.total as number])));
      setSourceTotalMap(Object.fromEntries(list.map((i) => [i.id, i.sourceCounts])));
      const allEpIds = [...new Set(list.flatMap((i) => i.history.map((wh) => wh.episodeId).filter(Boolean)))] as string[];
      const epEntries = await Promise.all(allEpIds.map((id) => provider.getEpisodeById(id).catch(() => null)));
      if (cancelled) return;
      const map: Record<string, Episode> = {};
      epEntries.forEach((ep) => { if (ep) map[ep.id] = ep; });
      setEpisodeMap(map);
    });
    return () => { cancelled = true; };
  }, [historyMediaList, provider]);

  const handleQuickPreview = useCallback(async () => {
    const kw = quickKeyword.trim();
    if (!kw) return;
    setSelectedPreviewIds(new Set([]));
    await searchKeywordPreview(kw, { ignoreBlacklist: relaxBlacklist, unlimitedYear: relaxYear });
  }, [quickKeyword, searchKeywordPreview, relaxBlacklist, relaxYear]);

  const handleQuickCollect = useCallback(async () => {
    const items = previewResults.filter((p) => selectedPreviewIds.size === 0 || selectedPreviewIds.has(p.previewId));
    if (items.length === 0) {
      Alert.alert('提示', '请至少选择一个视频');
      return;
    }
    const count = await saveSelectedPreviewItems(items, { ignoreBlacklist: relaxBlacklist, unlimitedYear: relaxYear });
    if (count > 0) {
      Alert.alert('采集完成', `成功采集 ${count} 部视频`);
      clearPreviewResults();
      setQuickKeyword('');
      setRelaxBlacklist(false);
      setRelaxYear(false);
    } else {
      Alert.alert('采集失败', '请重试');
    }
  }, [previewResults, selectedPreviewIds, saveSelectedPreviewItems, clearPreviewResults, relaxBlacklist, relaxYear]);

  const handleMobileCollectLatest = useCallback(async () => {
    await collectLatest();
    if (userUsageTypes.includes('NEW_MOVIES')) {
      provider.listMedia({ type: 'MOVIE', page: 1, pageSize: 5, sort: 'latest' })
        .then((r) => setLatestMedia(r.items))
        .catch(() => {});
    }
  }, [collectLatest, provider, userUsageTypes]);

  const toggleMobilePreviewItem = (previewId: string) => {
    setSelectedPreviewIds((prev) => {
      const next = new Set(prev);
      if (next.has(previewId)) next.delete(previewId);
      else next.add(previewId);
      return next;
    });
  };

  const renderSearchFirstCard = () => (
    <View style={styles.usageCard}>
      <View style={styles.titleRow}>
        <Sparkles size={18} color={colors.text} />
        <Text style={styles.usageCardTitle}>快速搜索采集</Text>
      </View>
      <Text style={styles.usageCardDesc}>输入关键词搜索并一键采集你想看的视频</Text>
      <View style={styles.quickSearchRow}>
        <Input
          style={{ flex: 1 }}
          placeholder="输入电影/电视剧名称..."
          value={quickKeyword}
          onChangeText={setQuickKeyword}
          onSubmitEditing={handleQuickPreview}
        />
        <Button variant="primary" size="sm" onPress={handleQuickPreview} loading={previewLoading}>
          搜索采集
        </Button>
      </View>
      {previewLoading && (
        <View style={styles.quickSearchLoading}>
          <ActivityIndicator size="small" color={colors.mutedForeground} />
          <Text style={styles.quickSearchLoadingText}>正在搜索...</Text>
        </View>
      )}
      <View style={styles.optionRow}>
        <View style={styles.switchRow}>
          <Switch
            value={relaxBlacklist}
            onValueChange={setRelaxBlacklist}
            trackColor={{ false: colors.swiftTrack, true: colors.swiftActiveTrack }}
            thumbColor={colors.swiftThumb}
          />
          <Text style={styles.switchLabel}>忽略黑名单</Text>
        </View>
        <View style={styles.switchRow}>
          <Switch
            value={relaxYear}
            onValueChange={setRelaxYear}
            trackColor={{ false: colors.swiftTrack, true: colors.swiftActiveTrack }}
            thumbColor={colors.swiftThumb}
          />
          <Text style={styles.switchLabel}>不限年份</Text>
        </View>
      </View>
      {previewResults.length > 0 && (
        <View style={styles.previewList}>
          {previewResults.map((item) => (
            <TouchableOpacity
              key={item.previewId}
              style={styles.previewItem}
              onPress={() => toggleMobilePreviewItem(item.previewId)}
            >
              <Text style={styles.previewCheck}>
                {selectedPreviewIds.size === 0 || selectedPreviewIds.has(item.previewId) ? <CheckSquare size={16} color={colors.text} /> : <Square size={16} color={colors.mutedForeground} />}
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
          <Button variant="primary" size="md" fullWidth onPress={handleQuickCollect}>
            一键采集（{selectedPreviewIds.size === 0 ? previewResults.length : selectedPreviewIds.size} 部）
          </Button>
        </View>
      )}
    </View>
  );

  const renderNewMoviesCard = () => (
    <View style={styles.usageCard}>
      <View style={styles.cardHeader}>
        <View style={styles.titleRow}>
          <Film size={18} color={colors.text} />
          <Text style={styles.usageCardTitle}>新片增量采集</Text>
        </View>
        <Button variant="secondary" size="sm" onPress={handleMobileCollectLatest} loading={storeLoading} disabled={storeLoading}>
          {storeLoading ? '采集中' : '增量采集'}
        </Button>
      </View>
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
        <View style={styles.cardHeader}>
          <View style={styles.titleRow}>
            <Tv size={18} color={colors.text} />
            <Text style={styles.usageCardTitle}>我的追剧</Text>
          </View>
          <Button variant="secondary" size="sm" onPress={handleMobileCollectLatest} loading={storeLoading} disabled={storeLoading}>
            {storeLoading ? '采集中' : '增量采集'}
          </Button>
        </View>
        {tvWatchHistory.length === 0 ? (
          <Text style={styles.usageCardDesc}>暂无追剧记录，观看电视剧或综艺后会显示在这里</Text>
        ) : (
          tvWatchHistory.slice(0, 5).map((h) => {
            const media = historyMediaList.find((m) => m.id === h.mediaId);
            if (!media) return null;
            const history = watchedHistoryMap[media.id] ?? [];
            const isWatched = (wh: WatchHistory) => wh.episodeId && (wh.progress > 60 || (wh.duration > 0 && wh.progress / wh.duration >= 0.1));
            let recentSourceId: string | null = null;
            for (const wh of history) {
              if (wh.episodeId) {
                const e = episodeMap[wh.episodeId];
                if (e?.sourceId) { recentSourceId = e.sourceId; break; }
              }
            }
            const sourceCount = recentSourceId ? (sourceTotalMap[media.id]?.[recentSourceId] ?? 0) : 0;
            const distinctKey = (wh: WatchHistory) => {
              const e = wh.episodeId ? episodeMap[wh.episodeId] : null;
              return e ? `${e.seasonNumber}:${e.episodeNumber}` : `ep:${wh.episodeId}`;
            };
            const watchedRows = history.filter(isWatched);
            const watchedCount = sourceCount > 0
              ? new Set(watchedRows.filter((wh) => {
                  const e = wh.episodeId ? episodeMap[wh.episodeId] : null;
                  return e?.sourceId === recentSourceId;
                }).map(distinctKey)).size
              : new Set(watchedRows.map(distinctKey)).size;
            const totalCount = sourceCount > 0 ? sourceCount : (media.totalEpisodes ?? media.currentEpisodes ?? episodeTotalMap[media.id] ?? 0);
            const progressPct = totalCount > 0
              ? Math.min(Math.round((watchedCount / totalCount) * 100), 100)
              : (h.duration > 0 ? Math.min(Math.round((h.progress / h.duration) * 100), 100) : 0);
            const ep = h.episodeId ? episodeMap[h.episodeId] : null;
            const epLabel = ep ? (ep.title || `第${ep.episodeNumber}集`) : null;
            return (
              <TouchableOpacity
                key={h.id}
                style={styles.tvItem}
                onPress={() => navigation.navigate('Detail', { id: media.id })}
              >
                <View style={styles.tvItemThumb}>
                  {media.posterUrl ? (
                    <Image source={{ uri: media.posterUrl }} style={styles.tvItemThumbImg} />
                  ) : (
                    <View style={styles.tvItemThumbPlaceholder}>
                      <Text style={{ fontSize: 10, color: colors.mutedForeground }}>无</Text>
                    </View>
                  )}
                </View>
                <View style={styles.tvItemLeft}>
                  <Text style={styles.tvItemTitle} numberOfLines={1}>{media.title}</Text>
                  {epLabel && <Text style={styles.tvItemEpisode} numberOfLines={1}>{epLabel}</Text>}
                  <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
                  </View>
                </View>
                <Text style={styles.tvItemAction}>续看</Text>
              </TouchableOpacity>
            );
          })
        )}
      </View>
    );
  };

  const renderHistoryCard = () => (
    <View style={styles.usageCard}>
      <View style={styles.cardHeader}>
        <View style={styles.titleRow}>
          <Clock size={18} color={colors.text} />
          <Text style={styles.usageCardTitle}>观看历史 ({watchHistory.length})</Text>
        </View>
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
        <View style={styles.titleRow}>
          <Heart size={18} color={colors.text} />
          <Text style={styles.usageCardTitle}>我的收藏 ({favorites.length})</Text>
        </View>
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
    },
    scrollContent: {
      paddingBottom: 20,
    },
    usageCard: {
      marginHorizontal: 15,
      marginTop: 16,
      backgroundColor: cardBg,
      borderRadius: radius.lg,
      padding: 14,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    usageCardTitle: {
      fontSize: s(16),
      fontWeight: '700',
      color: colors.text,
    },
    usageCardDesc: {
      fontSize: s(12),
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
      fontSize: s(13),
      color: colors.mutedForeground,
      textAlign: 'center',
      paddingVertical: 16,
    },
    usageCardSubtitle: {
      fontSize: s(13),
      color: colors.textSecondary,
      marginTop: 10,
      marginBottom: 8,
    },
    quickSearchRow: {
      flexDirection: 'row',
      gap: 8,
    },
    quickSearchLoading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 8,
    },
    quickSearchLoadingText: {
      color: colors.mutedForeground,
      fontSize: s(13),
    },
    optionRow: {
      flexDirection: 'row',
      gap: 16,
      marginTop: 10,
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    switchLabel: {
      fontSize: s(13),
      color: colors.mutedForeground,
    },
    previewList: {
      marginTop: 10,
      paddingTop: 10,
    },
    previewItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      gap: 10,
    },
    previewCheck: {
      fontSize: s(18),
      color: colors.text,
    },
    previewPoster: {
      width: 36,
      height: 54,
      borderRadius: radius.sm,
      backgroundColor: cardBg,
    },
    previewInfo: {
      flex: 1,
    },
    previewTitle: {
      fontSize: s(14),
      color: colors.text,
      fontWeight: '500',
    },
    previewMeta: {
      fontSize: s(11),
      color: colors.mutedForeground,
      marginTop: 2,
    },
    collectActionBtn: {
      backgroundColor: hexToRgba(colors.mutedForeground, cardOpacity / 100),
      borderRadius: radius.md,
      paddingVertical: 12,
      alignItems: 'center',
      marginTop: 8,
    },
    collectActionBtnText: {
      color: colors.text,
      fontSize: s(14),
      fontWeight: '600',
    },
    tvItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      gap: 8,
    },
    tvItemThumb: {
      width: 40,
      height: 40,
      borderRadius: radius.sm,
      overflow: 'hidden',
      backgroundColor: surfaceBg,
    },
    tvItemThumbImg: {
      width: 40,
      height: 40,
    },
    tvItemThumbPlaceholder: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tvItemLeft: {
      flex: 1,
    },
    tvItemTitle: {
      fontSize: s(14),
      color: colors.text,
      marginBottom: 2,
    },
    tvItemEpisode: {
      fontSize: s(12),
      color: colors.textSecondary,
      marginBottom: 4,
    },
    progressBar: {
      height: 4,
      backgroundColor: colors.trackBg,
      borderRadius: radius.progress,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      backgroundColor: colors.mutedForeground,
      borderRadius: radius.progress,
    },
    tvItemAction: {
      fontSize: s(12),
      color: colors.textSecondary,
      fontWeight: '600',
    },
  }), [colors, cardOpacity, cardBg, surfaceBg, s]);

  const bgImageUrl = latestMedia[0]?.posterUrl ?? null;
  const tabsHidden = useRef(new Animated.Value(0)).current;
  const prevScrollY = useRef(0);

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

  return (
    <BlurredBackground imageUrl={bgImageUrl}>
    <View style={styles.container}>
      <CategoryHeader activeType="首页" tabsHiddenAnim={tabsHidden} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >

        {userUsageTypes.includes('SEARCH_FIRST') && renderSearchFirstCard()}
        {userUsageTypes.includes('NEW_MOVIES') && renderNewMoviesCard()}
        {userUsageTypes.includes('TV_SERIES') && renderTvSeriesCard()}
        {renderHistoryCard()}
        {renderFavoritesCard()}
      </ScrollView>
      {videoSources.length > 0 && <UsageGuideModal />}
    </View>
    </BlurredBackground>
  );
}
