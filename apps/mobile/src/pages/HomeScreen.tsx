import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Switch, ActivityIndicator, Animated } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAppStore, getProvider } from '../useAppStore';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import MediaCard from '../components/MediaCard';
import PosterImage from '../components/PosterImage';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import UsageGuideModal from '../components/UsageGuideModal';
import CategoryHeader from '../components/CategoryHeader';
import BlurredBackground from '../components/BlurredBackground';
import type { Media, Episode, UserUsageType, WatchHistory } from '@movie-app/core';
import { radius } from '../themes/radiusTokens';
import { Sparkles, Film, Tv, Clock, Heart, CheckSquare, Square, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function TvPosterCard({ media, epLabel, progressPct, editing, onPress, onLongPress, onDelete }: {
  media: Media;
  epLabel: string | null;
  progressPct: number;
  editing: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onDelete: () => void;
}) {
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const surfaceBg = hexToRgba(colors.surface, cardOpacity / 100);
  const s = useScaledFontSize();
  const shakeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!editing) {
      shakeAnim.stopAnimation();
      shakeAnim.setValue(0);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(shakeAnim, { toValue: 1, duration: 60, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -1, duration: 60, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 0.6, duration: 60, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -0.6, duration: 60, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [editing, shakeAnim]);

  const shakeRotate = shakeAnim.interpolate({
    inputRange: [-1, 1],
    outputRange: ['-2deg', '2deg'],
  });

  const styles = useMemo(() => StyleSheet.create({
    card: {
      width: 100,
      marginRight: 10,
    },
    posterWrap: {
      position: 'relative',
    },
    poster: {
      width: 100,
      height: 150,
      borderRadius: radius.md,
      overflow: 'hidden',
      backgroundColor: surfaceBg,
    },
    posterImg: {
      width: '100%',
      height: '100%',
    },
    posterPlaceholder: {
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    },
    info: {
      paddingHorizontal: 6,
      paddingTop: 6,
    },
    title: {
      fontSize: s(12),
      color: colors.text,
    },
    episode: {
      fontSize: s(10),
      color: colors.textSecondary,
      marginTop: 2,
    },
    progressBar: {
      height: 4,
      backgroundColor: colors.trackBg,
      borderRadius: radius.progress,
      overflow: 'hidden',
      marginTop: 4,
    },
    progressFill: {
      height: '100%',
      backgroundColor: colors.mutedForeground,
      borderRadius: radius.progress,
    },
    deleteBadge: {
      position: 'absolute',
      top: 5,
      right: 5,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.error,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10,
    },
  }), [colors, surfaceBg, s]);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => { if (!editing) onPress(); }}
      onLongPress={onLongPress}
    >
      <Animated.View style={{ transform: [{ rotate: shakeRotate }] }}>
        <View style={styles.posterWrap}>
          <View style={styles.poster}>
            {media.posterUrl ? (
              <PosterImage uri={media.posterUrl} style={styles.posterImg} placeholder={<Text style={{ fontSize: s(11), color: colors.mutedForeground }}>无封面</Text>} />
            ) : (
              <View style={styles.posterPlaceholder}>
                <Text style={{ fontSize: s(11), color: colors.mutedForeground }}>无封面</Text>
              </View>
            )}
          </View>
          {editing && (
            <TouchableOpacity style={styles.deleteBadge} onPress={onDelete} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <X size={12} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>{media.title}</Text>
          {epLabel && <Text style={styles.episode} numberOfLines={1}>{epLabel}</Text>}
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
          </View>
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const provider = getProvider();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const surfaceBg = hexToRgba(colors.surface, cardOpacity / 100);
  const s = useScaledFontSize();
  const {
    favorites, watchHistory, watchHistoryCount,
    loadFavorites, loadWatchHistory,
    removeHistoryItem,
    userUsageTypes, loadUserUsageTypes,
    collectLatest, isCollecting: storeLoading,
    searchKeywordPreview, previewResults, previewLoading,
    saveSelectedPreviewItems, clearPreviewResults,
    videoSources, loadVideoSources, unhideMediaByGenres,
  } = useAppStore();

  const [editMode, setEditMode] = useState(false);

  const [favMediaList, setFavMediaList] = useState<Media[]>([]);
  const [historyMediaList, setHistoryMediaList] = useState<Media[]>([]);
  const [episodeMap, setEpisodeMap] = useState<Record<string, Episode>>({});
  const [watchedHistoryMap, setWatchedHistoryMap] = useState<Record<string, WatchHistory[]>>({});
  const [episodeTotalMap, setEpisodeTotalMap] = useState<Record<string, number>>({});
  const [sourceTotalMap, setSourceTotalMap] = useState<Record<string, Record<string, number>>>({});
  const [latestMedia, setLatestMedia] = useState<Media[]>([]);
  const [quickKeyword, setQuickKeyword] = useState('');
  const [selectedPreviewIds, setSelectedPreviewIds] = useState<Set<string>>(new Set([]));
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
    await searchKeywordPreview(kw, { unlimitedYear: relaxYear });
  }, [quickKeyword, searchKeywordPreview, relaxYear]);

  const handleQuickCollect = useCallback(async () => {
    const items = previewResults.filter((p) => selectedPreviewIds.size === 0 || selectedPreviewIds.has(p.previewId));
    if (items.length === 0) {
      Alert.alert('提示', '请至少选择一个视频');
      return;
    }
    const result = await saveSelectedPreviewItems(items, { unlimitedYear: relaxYear });
    const count = result.saved;
    if (count > 0) {
      Alert.alert('采集完成', `成功采集 ${count} 部视频`);
      clearPreviewResults();
      setQuickKeyword('');
      setRelaxYear(false);
      if (result.hiddenItems.length > 0) {
        const titles = result.hiddenItems.map((h) => h.title);
        const titleText = titles.length > 8
          ? `${titles.slice(0, 8).join('、')}等${titles.length}部`
          : titles.join('、');
        const genres = [...new Set(result.hiddenItems.flatMap((h) => h.genres))];
        Alert.alert(
          '部分视频已被隐藏',
          `「${titleText}」视频名被隐藏，恢复显示「${genres.join('、')}」类视频后就可以找到。是否取消隐藏这些子类型？`,
          [
            { text: '取消', style: 'cancel' },
            {
              text: '取消隐藏',
              onPress: () => {
                unhideMediaByGenres(genres)
                  .then((res) => {
                    if (res.unhidden > 0) {
                      Alert.alert('已恢复', `已取消隐藏「${genres.join('、')}」，恢复显示 ${res.unhidden} 部视频`);
                    }
                  })
                  .catch((err) => {
                    console.error('[HOME] 取消隐藏子类型失败:', err);
                    Alert.alert('操作失败', '取消隐藏失败，请重试');
                  });
              },
            },
          ]
        );
      }
    } else {
      Alert.alert('采集失败', '请重试');
    }
  }, [previewResults, selectedPreviewIds, saveSelectedPreviewItems, clearPreviewResults, relaxYear]);

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
    <View style={[styles.usageCard, styles.searchFirstCard]}>
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
                <PosterImage uri={item.posterUrl} style={styles.previewPoster} />
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
          <Text style={styles.usageCardTitle}>追新电影</Text>
        </View>
        <Button variant="secondary" size="sm" onPress={handleMobileCollectLatest} loading={storeLoading} disabled={storeLoading}>
          {storeLoading ? '采集中' : '增量采集'}
        </Button>
      </View>
      {latestMedia.length > 0 && (
        <>
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
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {tvWatchHistory.slice(0, 10).map((h) => {
              const media = historyMediaList.find((m) => m.id === h.mediaId);
              if (!media) return null;
              const history = watchedHistoryMap[media.id] ?? [];
              let recentSourceId: string | null = null;
              for (const wh of history) {
                if (wh.episodeId) {
                  const e = episodeMap[wh.episodeId];
                  if (e?.sourceId) { recentSourceId = e.sourceId; break; }
                }
              }
              const sourceCount = recentSourceId ? (sourceTotalMap[media.id]?.[recentSourceId] ?? 0) : 0;
              const recentWh = history[0];
              const recentEp = recentWh?.episodeId ? episodeMap[recentWh.episodeId] : undefined;
              const watchedCount = recentEp ? recentEp.episodeNumber : 0;
              const totalCount = sourceCount > 0 ? sourceCount : (media.totalEpisodes ?? media.currentEpisodes ?? episodeTotalMap[media.id] ?? 0);
              const progressPct = totalCount > 0
                ? Math.min(Math.round((watchedCount / totalCount) * 100), 100)
                : (h.duration > 0 ? Math.min(Math.round((h.progress / h.duration) * 100), 100) : 0);
              const ep = h.episodeId ? episodeMap[h.episodeId] : null;
              const epLabel = ep ? (ep.title || `第${ep.episodeNumber}集`) : null;
              return (
                <TvPosterCard
                  key={h.id}
                  media={media}
                  epLabel={epLabel}
                  progressPct={progressPct}
                  editing={editMode}
                  onPress={() => navigation.navigate('Detail', { id: media.id })}
                  onLongPress={() => setEditMode(true)}
                  onDelete={() => removeHistoryItem(media.id)}
                />
              );
            })}
          </ScrollView>
        )}
      </View>
    );
  };

  const renderHistoryCard = () => (
    <View style={styles.usageCard}>
      <View style={styles.cardHeader}>
        <View style={styles.titleRow}>
          <Clock size={18} color={colors.text} />
          <Text style={styles.usageCardTitle}>观看历史 ({watchHistoryCount})</Text>
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
              editing={editMode}
              onLongPress={() => setEditMode(true)}
              onDelete={() => removeHistoryItem(m.id)}
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
    fixedHeader: {
      zIndex: 10,
    },
    usageCard: {
      marginHorizontal: 15,
      marginTop: 16,
      backgroundColor: cardBg,
      borderRadius: radius.lg,
      padding: 14,
    },
    searchFirstCard: {
      marginTop: 0,
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
      marginBottom: 12,
    },
    emptyCardText: {
      fontSize: s(13),
      color: colors.mutedForeground,
      textAlign: 'center',
      paddingVertical: 16,
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
    doneButton: {
      position: 'absolute',
      right: 15,
      zIndex: 20,
      paddingVertical: 6,
      paddingHorizontal: 14,
      borderRadius: radius.full,
      backgroundColor: colors.buttonPrimaryBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    doneButtonText: {
      fontSize: s(13),
      fontWeight: '600',
      color: colors.buttonPrimaryText,
    },
    progressBar: {
      height: 4,
      backgroundColor: colors.trackBg,
      borderRadius: radius.progress,
      overflow: 'hidden',
      marginTop: 4,
    },
    progressFill: {
      height: '100%',
      backgroundColor: colors.mutedForeground,
      borderRadius: radius.progress,
    },
  }), [colors, cardOpacity, cardBg, surfaceBg, s]);

  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);

  useEffect(() => {
    const first = latestMedia[0];
    if (!first?.posterUrl) {
      setBgImageUrl(null);
      return;
    }
    setBgImageUrl(first.posterUrl);
  }, [latestMedia]);

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
      <View style={styles.fixedHeader}>
        <CategoryHeader activeType="首页" tabsHiddenAnim={tabsHidden} />
        {editMode && (
          <TouchableOpacity
            style={[styles.doneButton, { top: insets.top + 8 }]}
            onPress={() => setEditMode(false)}
          >
            <Text style={styles.doneButtonText}>完成</Text>
          </TouchableOpacity>
        )}
      </View>
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
