import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Switch, Animated, Easing } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
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
import { KidLockBanner } from '../components/KidLockBanner';
import type { Media, Episode, UserUsageType, WatchHistory } from '@movie-app/core';
import { getSplashStore } from '@movie-app/core';
import { radius } from '../themes/radiusTokens';
import { openMediaPlay } from '../utils/openMediaPlay';
import { Sparkles, Film, Tv, Clock, Heart, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

const HINT_SHOW_KEY = 'home_delete_hint_shown_count_v4';
const HINT_MAX_SHOWS = 3;
const HINT_STAY_MS = 5000;
const HINT_FADE_MS = 600;

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

function DeleteHintBubble({ onDone }: { onDone: () => void }) {
  const colors = useThemeColors();
  const s = useScaledFontSize();
  const opacity = useRef(new Animated.Value(0)).current;
  const doneRef = useRef(false);
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const bubbleStyle = useMemo(() => ({
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: hexToRgba(colors.mutedForeground, 0.12),
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginLeft: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: hexToRgba(colors.mutedForeground, 0.35),
  }), [colors.mutedForeground]);

  useEffect(() => {
    const t0 = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 1,
        duration: HINT_FADE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        const t1 = setTimeout(() => {
          Animated.timing(opacity, {
            toValue: 0,
            duration: HINT_FADE_MS,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }).start(() => {
            if (doneRef.current) return;
            doneRef.current = true;
            onDone();
          });
        }, HINT_STAY_MS);
        timersRef.current.push(t1);
      });
    }, 16);
    timersRef.current.push(t0);
    return () => {
      timersRef.current.forEach(clearTimeout);
      opacity.stopAnimation();
    };
  }, [opacity, onDone]);

  return (
    <Animated.View style={[bubbleStyle, { opacity }]} pointerEvents="none">
      <Text style={{ fontSize: s(10), color: colors.mutedForeground, fontWeight: '500' }} numberOfLines={1}>长按卡片可删除</Text>
    </Animated.View>
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
    videoSources, loadVideoSources,
  } = useAppStore();
  const splashPhase = getSplashStore()((s) => s.phase);

  const [editMode, setEditMode] = useState(false);

  const [favMediaList, setFavMediaList] = useState<Media[]>([]);
  const [historyMediaList, setHistoryMediaList] = useState<Media[]>([]);
  const [episodeMap, setEpisodeMap] = useState<Record<string, Episode>>({});
  const [watchedHistoryMap, setWatchedHistoryMap] = useState<Record<string, WatchHistory[]>>({});
  const [episodeTotalMap, setEpisodeTotalMap] = useState<Record<string, number>>({});
  const [sourceTotalMap, setSourceTotalMap] = useState<Record<string, Record<string, number>>>({});
  const [latestMedia, setLatestMedia] = useState<Media[]>([]);
  const [quickKeyword, setQuickKeyword] = useState('');
  const [relaxYear, setRelaxYear] = useState(false);

  const [sourcesChecked, setSourcesChecked] = useState(false);

  const [hintVisible, setHintVisible] = useState(false);
  const hintLockRef = useRef(false);

  const handleHintDone = useCallback(() => {
    setHintVisible(false);
    if (hintLockRef.current) return;
    hintLockRef.current = true;
    AsyncStorage.getItem(HINT_SHOW_KEY)
      .then((raw) => {
        const count = raw ? parseInt(raw, 10) || 0 : 0;
        return AsyncStorage.setItem(HINT_SHOW_KEY, String(count + 1));
      })
      .catch(() => {})
      .finally(() => {
        hintLockRef.current = false;
      });
  }, []);

  // 首页四大板块数据加载完成标记（决定欢迎页全屏广告消失时机）
  const homeReadyLatestRef = useRef(false);
  const homeReadyFavRef = useRef(false);
  const homeReadyHistoryRef = useRef(false);
  const homeReadyTvDetailRef = useRef(false);
  const homeSignaledRef = useRef(false);

  const maybeSignalHomeReady = () => {
    if (homeSignaledRef.current) return;
    if (
      homeReadyLatestRef.current &&
      homeReadyFavRef.current &&
      homeReadyHistoryRef.current &&
      homeReadyTvDetailRef.current
    ) {
      homeSignaledRef.current = true;
      // 图片渲染缓冲：四大板块数据就绪后再等 800ms（首页图片在此期间渲染）
      setTimeout(() => getSplashStore().getState().setHomeReady(true), 800);
    }
  };

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

  // 每次回到首页时刷新列表：保证儿童模式开关后首页立即反映最新过滤结果
  useFocusEffect(
    useCallback(() => {
      loadUserUsageTypes();
      loadFavorites();
      loadWatchHistory(1);
    }, [loadUserUsageTypes, loadFavorites, loadWatchHistory]),
  );

  useEffect(() => {
    if (userUsageTypes.includes('NEW_MOVIES')) {
      provider.listMedia({ type: 'MOVIE', page: 1, pageSize: 5, sort: 'latest' })
        .then((r) => { setLatestMedia(r.items); homeReadyLatestRef.current = true; maybeSignalHomeReady(); })
        .catch(() => { homeReadyLatestRef.current = true; maybeSignalHomeReady(); });
    } else {
      homeReadyLatestRef.current = true;
      maybeSignalHomeReady();
    }
  }, [userUsageTypes, provider]);

  useEffect(() => {
    if (favorites.length === 0) { setFavMediaList([]); homeReadyFavRef.current = true; maybeSignalHomeReady(); return; }
    let cancelled = false;
    Promise.all(
      favorites.slice(0, 10).map(f => provider.getMediaById(f.mediaId).catch(() => null))
    ).then(list => {
      if (!cancelled) setFavMediaList(list.filter(Boolean) as Media[]);
      homeReadyFavRef.current = true;
      maybeSignalHomeReady();
    });
    return () => { cancelled = true; };
  }, [favorites, provider]);

  useEffect(() => {
    if (watchHistory.length === 0) { setHistoryMediaList([]); homeReadyHistoryRef.current = true; maybeSignalHomeReady(); return; }
    let cancelled = false;
    Promise.all(
      watchHistory.slice(0, 10).map(h => provider.getMediaById(h.mediaId).catch(() => null))
    ).then(list => {
      if (!cancelled) setHistoryMediaList(list.filter(Boolean) as Media[]);
      homeReadyHistoryRef.current = true;
      maybeSignalHomeReady();
    });
    return () => { cancelled = true; };
  }, [watchHistory, provider]);

  useEffect(() => {
    const tvList = historyMediaList.filter((m) => m.type === 'TV' || m.type === 'VARIETY');
    if (tvList.length === 0) { setWatchedHistoryMap({}); setEpisodeTotalMap({}); setSourceTotalMap({}); setEpisodeMap({}); homeReadyTvDetailRef.current = true; maybeSignalHomeReady(); return; }
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
      homeReadyTvDetailRef.current = true;
      maybeSignalHomeReady();
    });
    return () => { cancelled = true; };
  }, [historyMediaList, provider]);

  const handleQuickPreview = useCallback(() => {
    const kw = quickKeyword.trim();
    if (!kw) return;
    navigation.push('KeywordCollect', { keyword: kw, relaxYear });
  }, [quickKeyword, relaxYear, navigation]);

  const handleMobileCollectLatest = useCallback(async () => {
    await collectLatest();
    if (userUsageTypes.includes('NEW_MOVIES')) {
      provider.listMedia({ type: 'MOVIE', page: 1, pageSize: 5, sort: 'latest' })
        .then((r) => setLatestMedia(r.items))
        .catch(() => {});
    }
  }, [collectLatest, provider, userUsageTypes]);

  const maybeShowDeleteHint = useCallback(async () => {
    if (hintVisible) return;
    try {
      const raw = await AsyncStorage.getItem(HINT_SHOW_KEY);
      const count = raw ? parseInt(raw, 10) || 0 : 0;
      if (count >= HINT_MAX_SHOWS) return;
      setHintVisible(true);
    } catch {
      // 忽略读取失败
    }
  }, [hintVisible]);

  const splashAdGone = useMemo(() => getSplashStore().getState().phase === 'done', [splashPhase]);

  useEffect(() => {
    if (splashAdGone && watchHistory.length > 0) maybeShowDeleteHint();
    else setHintVisible(false);
  }, [splashAdGone, watchHistory.length, maybeShowDeleteHint]);

  useFocusEffect(
    useCallback(() => {
      if (splashAdGone && watchHistory.length > 0) maybeShowDeleteHint();
    }, [splashAdGone, watchHistory.length, maybeShowDeleteHint]),
  );

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
        <Button variant="primary" size="sm" onPress={handleQuickPreview}>
          搜索采集
        </Button>
      </View>
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
                  onPress={() => openMediaPlay(navigation, m)}
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
            {hintVisible && (
              <DeleteHintBubble onDone={handleHintDone} />
            )}
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
                  onPress={() => openMediaPlay(navigation, media)}
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
          {hintVisible && (
            <DeleteHintBubble onDone={handleHintDone} />
          )}
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
              onPress={() => openMediaPlay(navigation, m)}
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
                onPress={() => openMediaPlay(navigation, m)}
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
    cardHint: {
      fontSize: s(11),
      color: colors.mutedForeground,
      marginBottom: 8,
    },
    hintBubble: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: hexToRgba(colors.mutedForeground, 0.12),
      borderRadius: radius.full,
      paddingHorizontal: 8,
      paddingVertical: 3,
      marginLeft: 4,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: hexToRgba(colors.mutedForeground, 0.35),
    },
    hintBubbleText: {
      fontSize: s(10),
      color: colors.mutedForeground,
      fontWeight: '500',
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
        <KidLockBanner onUnlocked={() => { loadFavorites(); loadWatchHistory(1); }} />
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
