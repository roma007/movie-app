import { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Modal } from 'react-native';
import { useAppStore } from '../useAppStore';
import { getProvider } from '../init';
import { clearCategoryFilterCache } from '../categoryFilterCache';
import { VideoDurationService, UNCATEGORIZED_GENRE } from '@movie-app/core';
import { Heart, ArrowLeft, EyeOff, Star } from 'lucide-react-native';
import type { Episode, PlaySource, VideoSource } from '@movie-app/core';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { Button } from '../components/ui/Button';
import { hexToRgba } from '../themes/colorUtils';
import BlurredBackground from '../components/BlurredBackground';
import PosterImage from '../components/PosterImage';
import { radius } from '../themes/radiusTokens';

interface Props {
  route: any;
  navigation: any;
}

export default function DetailScreen({ route, navigation }: Props) {
  const { id } = route.params;
  const { currentMedia, episodes, seasons, isLoading, episodeSources, seriesMedia, loadMediaDetail, loadEpisodes, loadSeasons, loadSeasonEpisodes, loadSeriesMedia, hideMediaByGenres, fetchMediaRating, isRatingLoading } = useAppStore();
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const accentBg = hexToRgba(colors.cardAccent, cardOpacity / 100);
  const dimBg = hexToRgba(colors.cardDim, cardOpacity / 100);
  const s = useScaledFontSize();
  const [currentSeason, setCurrentSeason] = useState(1);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [episodeDurations, setEpisodeDurations] = useState<Record<string, number | null>>({});
  const [isEpisodesLoading, setIsEpisodesLoading] = useState(false);

  // 功能1: 收藏
  const [isFav, setIsFav] = useState(false);

  // 功能6: 隐藏此类视频
  const [hideModalVisible, setHideModalVisible] = useState(false);
  const [selectedHideGenres, setSelectedHideGenres] = useState<string[]>([]);
  const [hiding, setHiding] = useState(false);

  // 功能4: 电影多线路
  const [allPlaySources, setAllPlaySources] = useState<Record<string, PlaySource[]>>({});

  // 功能5: 已看剧集
  const [watchedEpisodes, setWatchedEpisodes] = useState<Set<string>>(new Set());

  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!currentMedia?.posterUrl) {
      setBgImageUrl(null);
      return;
    }
    setBgImageUrl(currentMedia.posterUrl);
  }, [currentMedia]);

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1 },
    loadingContainer: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' },
    navBar: { flexDirection: 'row', alignItems: 'center', paddingTop: 50, paddingHorizontal: 15, paddingBottom: 10 },
    navBack: { padding: 8 },
    navTitle: { flex: 1, fontSize: s(18), fontWeight: 'bold', color: colors.text, textAlign: 'center' },
    navPlaceholder: { width: 40 },
    header: { flexDirection: 'row', padding: 20, paddingTop: 10 },
    poster: { width: 120, height: 170, borderRadius: radius.md, backgroundColor: cardBg },
    info: { flex: 1, marginLeft: 15, justifyContent: 'center' },
    titleRow: { marginBottom: 6 },
    title: { fontSize: s(20), fontWeight: 'bold', color: colors.text },
    favButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, gap: 4 },
    favGroup: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
    alias: { fontSize: s(13), color: colors.mutedForeground, marginBottom: 4 },
    subtitle: { fontSize: s(14), color: colors.textSecondary, marginBottom: 4 },
    updateTime: { fontSize: s(13), color: colors.error, marginBottom: 8 },
    ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
    ratingValue: { fontSize: s(18), fontWeight: 'bold', color: colors.warning },
    ratingCount: { fontSize: s(12), color: colors.mutedForeground },
    ratingLoading: { fontSize: s(13), color: colors.mutedForeground, marginLeft: 2 },
    genreRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    genre: { fontSize: s(12), color: colors.text, backgroundColor: hexToRgba(colors.mutedForeground, cardOpacity / 100 * 0.2), paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, overflow: 'hidden' },
    section: { padding: 20 },
    sectionTitle: { fontSize: s(16), fontWeight: '600', color: colors.text, marginBottom: 10 },
    description: { fontSize: s(14), color: colors.textSecondary, lineHeight: s(22) },
    text: { fontSize: s(14), color: colors.textSecondary },
    nameRow: { flexDirection: 'row', flexWrap: 'wrap' },
    nameLink: { fontSize: s(14), color: colors.textSecondary, marginRight: 4 },
    seasonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    seasonButton: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.md },
    sourceEpisodeRow: { flexDirection: 'row', alignItems: 'stretch' },
    sourceTabCol: { flexDirection: 'column', alignItems: 'flex-end', gap: 6, paddingLeft: 12 },
    sourceTab: { flex: 1, justifyContent: 'center', borderTopLeftRadius: radius.md, borderBottomLeftRadius: radius.md, borderTopRightRadius: 0, borderBottomRightRadius: 0 },
    sourceTabActive: { backgroundColor: accentBg, paddingVertical: 10, paddingHorizontal: 12, width: 92 },
    sourceTabInactive: { backgroundColor: dimBg, paddingVertical: 6, paddingHorizontal: 8, width: 76 },
    sourceTabText: { fontSize: s(11), fontWeight: '500', textAlign: 'left' },
    episodePanel: { flex: 1, minWidth: 0, backgroundColor: accentBg, borderTopRightRadius: radius.md, borderBottomRightRadius: radius.md, padding: 12 },
    episodesPlaceholder: { paddingVertical: 30, alignItems: 'center' },
    episodesPlaceholderText: { color: colors.mutedForeground, fontSize: s(14) },
    episodesPlaceholderHint: { color: colors.disabledForeground, fontSize: s(12), marginTop: 4 },
    episodeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    episodeButton: { paddingVertical: 10, paddingHorizontal: 6, borderRadius: radius.sm, alignItems: 'center' },
    episodeButtonIdle: { backgroundColor: dimBg },
    episodeButtonWatched: { opacity: 0.5 },
    episodeButtonText: { color: colors.textSecondary, fontSize: s(13), fontWeight: '500', textAlign: 'center' },
    episodeDuration: { color: colors.disabledForeground, fontSize: s(11), marginTop: 4 },
    error: { color: colors.error, textAlign: 'center', marginTop: 50 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
    modalCard: { width: '100%', borderRadius: radius.lg, padding: 20 },
    modalTitle: { fontSize: s(18), fontWeight: 'bold', color: colors.text, marginBottom: 6 },
    modalDesc: { fontSize: s(13), color: colors.mutedForeground, marginBottom: 16 },
    modalGenres: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
    genreChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1 },
    genreChipText: { fontSize: s(13), color: colors.text },
    modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
    modalButton: { paddingHorizontal: 16, paddingVertical: 8 },
  }), [colors, cardBg, accentBg, dimBg, s]);

  useEffect(() => {
    loadMediaDetail(id);
    loadSeasons(id);
    loadSeriesMedia(id);
    fetchMediaRating(id);

    // 收藏状态
    getProvider().isFavorite(id).then(setIsFav).catch(() => {});

    // 已看剧集
    getProvider().getAllWatchHistoryByMediaId(id).then(history => {
      const watched = new Set<string>();
      for (const h of history) {
        if (h.episodeId && h.episodeId !== id && (h.progress > 60 || (h.duration > 0 && h.progress / h.duration >= 0.1))) {
          watched.add(h.episodeId);
        }
      }
      setWatchedEpisodes(watched);
    }).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (seasons.length > 0 && !seasons.includes(currentSeason)) {
      setCurrentSeason(seasons[0]);
    }
  }, [seasons]);

  useEffect(() => {
    if (!id || currentSeason === 0) return;

    let cancelled = false;
    setIsEpisodesLoading(true);

    loadSeasonEpisodes(id, currentSeason).then(firstSourceId => {
      if (cancelled) return;
      if (firstSourceId) setSelectedSourceId(firstSourceId);
      setIsEpisodesLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [id, currentSeason]);

  // 获取时长 + 电影多线路的 playSources
  useEffect(() => {
    if (episodes.length === 0) return;
    const durationService = new VideoDurationService();
    const provider = getProvider();
    const CONCURRENCY_LIMIT = 8;

    const fetchDuration = async (ep: Episode) => {
      try {
        const sources = await provider.getPlaySourcesByEpisodeId(ep.id);
        setAllPlaySources(prev => ({ ...prev, [ep.id]: sources }));
        const m3u8Source = sources.find(s => s.url.endsWith('.m3u8') || s.url.toLowerCase().includes('m3u8'));
        if (m3u8Source) {
          const duration = await durationService.getDurationFromM3U8(m3u8Source.url);
          setEpisodeDurations(prev => ({ ...prev, [ep.id]: duration }));
        }
      } catch {
        setEpisodeDurations(prev => ({ ...prev, [ep.id]: null }));
      }
    };

    const runInBatches = async () => {
      for (let i = 0; i < episodes.length; i += CONCURRENCY_LIMIT) {
        const batch = episodes.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.all(batch.map(fetchDuration));
      }
    };

    runInBatches();
  }, [episodes]);

  const seasonToMediaMap = new Map<number, string>();
  seriesMedia.forEach(m => {
    if (m.seriesSeason) seasonToMediaMap.set(m.seriesSeason, m.id);
  });
  const seasonsFromSeries = [...new Set(seriesMedia.map(m => m.seriesSeason ?? 1))].sort((a, b) => a - b);
  const displaySeasons = seasonsFromSeries.length > 0 ? seasonsFromSeries : seasons;

  const handleSeasonChange = (season: number) => {
    const targetId = seasonToMediaMap.get(season);
    if (targetId && targetId !== id) {
      navigation.replace('Detail', { id: targetId });
    } else {
      setCurrentSeason(season);
    }
  };

  const handleSourceChange = (sourceId: string) => {
    setSelectedSourceId(sourceId);
    setIsEpisodesLoading(true);
    loadEpisodes(id, currentSeason, sourceId).then(() => {
      setIsEpisodesLoading(false);
    });
  };

  // 功能1: 收藏切换
  const handleFav = async () => {
    const result = await getProvider().toggleFavorite(id);
    setIsFav(result);
  };

  const openHideModal = () => {
    if (!currentMedia) return;
    setSelectedHideGenres([]);
    setHideModalVisible(true);
  };

  const toggleHideGenre = (g: string) => {
    setSelectedHideGenres(prev =>
      prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]
    );
  };

  const goBackWithRefresh = () => {
    const state = navigation.getState();
    const prev = state?.routes?.[state.index - 1];
    if (prev) {
      navigation.popTo(prev.name, { ...prev.params, refresh: Date.now() });
    } else {
      navigation.goBack();
    }
  };

  const handleHide = async () => {
    if (selectedHideGenres.length === 0 || hiding) return;
    setHiding(true);
    try {
      const result = await hideMediaByGenres(selectedHideGenres);
      clearCategoryFilterCache();
      setHideModalVisible(false);
      Alert.alert(
        '已隐藏',
        `已隐藏 ${result.hidden} 个「${selectedHideGenres.join('/')}」类视频`,
        [{ text: '确定', onPress: goBackWithRefresh }],
      );
    } catch (err: any) {
      setHideModalVisible(false);
      Alert.alert('错误', err.message || '隐藏失败');
    } finally {
      setHiding(false);
    }
  };

  if (isLoading) {
    return (
      <BlurredBackground imageUrl={null}>
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.text} />
      </View>
      </BlurredBackground>
    );
  }

  if (!currentMedia) {
    return (
      <BlurredBackground imageUrl={null}>
      <View style={styles.container}>
        <Text style={styles.error}>加载失败</Text>
      </View>
      </BlurredBackground>
    );
  }

  const isMovie = currentMedia.type === 'MOVIE';

  const typeScreenMap: Record<string, string> = {
    MOVIE: 'Movie',
    TV: 'TV',
    VARIETY: 'Variety',
    ANIME: 'Anime',
    DOCUMENTARY: 'Documentary',
  };

  return (
    <BlurredBackground imageUrl={bgImageUrl}>
    <ScrollView style={styles.container}>
      <View style={styles.navBar}>
        <Button variant="icon" size="sm" style={styles.navBack} onPress={() => navigation.goBack()}>
          <ArrowLeft size={20} color={colors.text} />
        </Button>
        <Text style={styles.navTitle} numberOfLines={1}>{currentMedia.title}</Text>
        <View style={styles.navPlaceholder} />
      </View>

      <View style={styles.header}>
        {currentMedia.posterUrl && (
          <PosterImage uri={currentMedia.posterUrl} style={styles.poster} />
        )}
        <View style={styles.info}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={2}>{currentMedia.title}</Text>
          </View>
          <View style={styles.favGroup}>
            <Button
              variant="secondary"
              size="sm"
              style={styles.favButton}
              leftIcon={<EyeOff size={16} color={colors.textSecondary} />}
              onPress={openHideModal}
            >
              隐藏此类视频
            </Button>
            <Button
              variant="secondary"
              size="sm"
              active={isFav}
              style={styles.favButton}
              leftIcon={<Heart size={16} color={isFav ? colors.text : colors.textSecondary} fill={isFav ? colors.text : 'none'} />}
              onPress={handleFav}
            >
              {isFav ? '已收藏' : '收藏'}
            </Button>
          </View>
          {currentMedia.alias && (
            <Text style={styles.alias}>又名：{currentMedia.alias}</Text>
          )}
          <Text style={styles.subtitle}>
            {currentMedia.year} · {currentMedia.area || '未知'}
          </Text>
          <Text style={styles.updateTime}>
            更新：{new Date(currentMedia.updatedAt).toISOString().split('T')[0]}
          </Text>
          {currentMedia.rating != null && currentMedia.rating > 0 ? (
            <View style={styles.ratingRow}>
              <Star size={14} color={colors.warning} fill={colors.warning} />
              <Text style={styles.ratingValue}>{currentMedia.rating.toFixed(1)}</Text>
              {currentMedia.ratingCount != null && currentMedia.ratingCount > 0 && (
                <Text style={styles.ratingCount}>
                  {currentMedia.ratingCount >= 10000 ? `${(currentMedia.ratingCount / 10000).toFixed(1)}万人` : `${currentMedia.ratingCount}人`}评分
                </Text>
              )}
            </View>
          ) : isRatingLoading ? (
            <View style={styles.ratingRow}>
              <ActivityIndicator size="small" color={colors.mutedForeground} />
              <Text style={styles.ratingLoading}>正在获取评分...</Text>
            </View>
          ) : null}
          <View style={styles.genreRow}>
            {currentMedia.genres.map((g: string, i: number) => (
              <TouchableOpacity
                key={i}
                activeOpacity={0.7}
                onPress={() => {
                  const screen = typeScreenMap[currentMedia.type];
                  if (screen) navigation.navigate(screen, { subType: g });
                }}
              >
                <Text style={styles.genre}>{g}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>简介</Text>
        <Text style={styles.description}>{currentMedia.description || '暂无简介'}</Text>
      </View>

      {currentMedia.directors.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>导演</Text>
          <View style={styles.nameRow}>
            {currentMedia.directors.map((d: string, i: number) => (
              <TouchableOpacity key={d} onPress={() => navigation.push('Search', { keyword: d })}>
                <Text style={styles.nameLink}>
                  {d}{i < currentMedia.directors.length - 1 ? ' / ' : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {currentMedia.actors.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>演员</Text>
          <View style={styles.nameRow}>
            {currentMedia.actors.map((a: string, i: number) => (
              <TouchableOpacity key={a} onPress={() => navigation.push('Search', { keyword: a })}>
                <Text style={styles.nameLink}>
                  {a}{i < currentMedia.actors.length - 1 ? ' / ' : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {displaySeasons.length > 1 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>季数</Text>
          <View style={styles.seasonRow}>
            {displaySeasons.map((s: number) => {
              const isCurrent = seasonToMediaMap.get(s) === id || (!seasonToMediaMap.has(s) && currentSeason === s);
              return (
                <Button
                  key={s}
                  variant="secondary"
                  size="sm"
                  active={isCurrent}
                  style={styles.seasonButton}
                  onPress={() => handleSeasonChange(s)}
                >
                  第{s}季
                </Button>
              );
            })}
          </View>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{isMovie ? '播放源' : `剧集 (${episodes.length}集)`}</Text>
        <View style={styles.sourceEpisodeRow}>
          {episodeSources.length > 1 && (
            <View style={styles.sourceTabCol}>
              {episodeSources.map((s: VideoSource) => {
                const active = selectedSourceId === s.id;
                return (
                  <TouchableOpacity
                    key={s.id}
                    activeOpacity={0.7}
                    onPress={() => handleSourceChange(s.id)}
                    style={[styles.sourceTab, active ? styles.sourceTabActive : styles.sourceTabInactive]}
                  >
                    <Text
                      numberOfLines={1}
                      style={[styles.sourceTabText, { color: active ? colors.buttonPrimaryText : colors.buttonSecondaryText }]}
                    >
                      {s.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <View style={styles.episodePanel}>
            {isEpisodesLoading ? (
              <View style={styles.episodesPlaceholder}>
                <ActivityIndicator size="small" color={colors.mutedForeground} />
                <Text style={styles.episodesPlaceholderText}>加载中...</Text>
              </View>
            ) : episodes.length === 0 ? (
              <View style={styles.episodesPlaceholder}>
                <Text style={styles.episodesPlaceholderText}>暂无集数信息</Text>
                <Text style={styles.episodesPlaceholderHint}>请尝试重新采集数据或切换视频源</Text>
              </View>
            ) : isMovie ? (
              // 功能4: 电影多线路播放
              <View style={styles.episodeGrid}>
                {episodes.map((ep: Episode) => {
                  const sources = allPlaySources[ep.id] || [];
                  const sourceKeyMap = new Map<string, number>();
                  sources.forEach(s => {
                    const key = `${s.sourceName || ''}_${s.quality || ''}`;
                    sourceKeyMap.set(key, (sourceKeyMap.get(key) || 0) + 1);
                  });
                  const keyIndexMap = new Map<string, number>();
                  return sources.map((source: PlaySource, idx: number) => {
                    const key = `${source.sourceName || ''}_${source.quality || ''}`;
                    const count = sourceKeyMap.get(key) || 1;
                    const idxInGroup = (keyIndexMap.get(key) || 0) + 1;
                    keyIndexMap.set(key, idxInGroup);
                    const baseTitle = `${source.sourceName || ''}${source.quality ? ` · ${source.quality}` : ''}`.trim() || '正片';
                    const suffix = count > 1 ? ` (${idxInGroup})` : '';
                    const title = `${baseTitle}${suffix}`;
                    return (
                      <TouchableOpacity
                        key={`${ep.id}-${source.id || idx}`}
                        activeOpacity={0.7}
                        style={[styles.episodeButton, styles.episodeButtonIdle]}
                        onPress={() => navigation.navigate('Play', { episodeId: ep.id, mediaId: id, sourceId: source.sourceId, title: currentMedia.title + ' · ' + title })}
                      >
                        <Text style={styles.episodeButtonText}>{title}</Text>
                      </TouchableOpacity>
                    );
                  });
                })}
              </View>
            ) : (
              // 功能5: 已看剧集标记
              <View style={styles.episodeGrid}>
                {episodes.map((ep: any) => {
                  const duration = episodeDurations[ep.id];
                  const isWatched = watchedEpisodes.has(ep.id);
                  return (
                    <TouchableOpacity
                      key={ep.id}
                      activeOpacity={0.7}
                      disabled={isWatched}
                      style={[styles.episodeButton, styles.episodeButtonIdle, isWatched && styles.episodeButtonWatched]}
                      onPress={() => navigation.navigate('Play', { episodeId: ep.id, mediaId: id, sourceId: selectedSourceId, title: currentMedia.title + (ep.title ? ` · ${ep.title}` : ` · 第${ep.episodeNumber}集`) })}
                    >
                      <Text style={styles.episodeButtonText}>
                        {ep.title || `第${ep.episodeNumber}集`}
                      </Text>
                      {typeof duration === 'number' && duration > 0 && (
                        <Text style={styles.episodeDuration}>
                          {Math.floor(duration / 60)}:{String(duration % 60).padStart(2, '0')}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        </View>
      </View>

      <Modal
        visible={hideModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setHideModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <Text style={styles.modalTitle}>隐藏此类视频</Text>
            <Text style={styles.modalDesc}>选择要隐藏的子类型，隐藏后此类视频将不再显示。</Text>
            <View style={styles.modalGenres}>
              {(currentMedia.genres.length === 0 ? [UNCATEGORIZED_GENRE] : currentMedia.genres).map((g: string) => {
                const selected = selectedHideGenres.includes(g);
                return (
                  <TouchableOpacity
                    key={g}
                    onPress={() => toggleHideGenre(g)}
                    style={[
                      styles.genreChip,
                      { borderColor: selected ? colors.mutedForeground : colors.disabledForeground, backgroundColor: selected ? colors.mutedForeground : colors.card },
                    ]}
                  >
                    <Text style={[styles.genreChipText, { color: selected ? colors.background : colors.text }]}>{g}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.modalButtons}>
              <Button
                variant="secondary"
                size="sm"
                style={styles.modalButton}
                onPress={() => setHideModalVisible(false)}
              >
                取消
              </Button>
              <Button
                variant="primary"
                size="sm"
                style={styles.modalButton}
                disabled={hiding || selectedHideGenres.length === 0}
                onPress={handleHide}
              >
                {hiding ? '隐藏中...' : `隐藏 (${selectedHideGenres.length})`}
              </Button>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
    </BlurredBackground>
  );
}
