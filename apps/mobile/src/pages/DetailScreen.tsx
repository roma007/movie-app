import { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useAppStore } from '../useAppStore';
import { getProvider } from '../init';
import { VideoDurationService } from '@movie-app/core';
import { Heart, ArrowLeft } from 'lucide-react-native';
import type { Episode, PlaySource, VideoSource } from '@movie-app/core';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { Button } from '../components/ui/Button';
import { hexToRgba } from '../themes/colorUtils';
import BlurredBackground from '../components/BlurredBackground';
import { radius } from '../themes/radiusTokens';

interface Props {
  route: any;
  navigation: any;
}

export default function DetailScreen({ route, navigation }: Props) {
  const { id } = route.params;
  const { currentMedia, episodes, seasons, isLoading, episodeSources, seriesMedia, loadMediaDetail, loadEpisodes, loadSeasons, loadSeasonEpisodes, loadSeriesMedia } = useAppStore();
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const surfaceBg = hexToRgba(colors.surface, cardOpacity / 100);
  const s = useScaledFontSize();
  const [currentSeason, setCurrentSeason] = useState(1);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [episodeDurations, setEpisodeDurations] = useState<Record<string, number | null>>({});
  const [isEpisodesLoading, setIsEpisodesLoading] = useState(false);

  // 功能1: 收藏
  const [isFav, setIsFav] = useState(false);

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
    titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 },
    title: { fontSize: s(20), fontWeight: 'bold', color: colors.text, flex: 1, marginRight: 8 },
    favButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, gap: 4 },
    alias: { fontSize: s(13), color: colors.mutedForeground, marginBottom: 4 },
    subtitle: { fontSize: s(14), color: colors.textSecondary, marginBottom: 4 },
    updateTime: { fontSize: s(13), color: colors.error, marginBottom: 8 },
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
    sourceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    sourceButton: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.md },
    episodesPlaceholder: { paddingVertical: 30, alignItems: 'center' },
    episodesPlaceholderText: { color: colors.mutedForeground, fontSize: s(14) },
    episodesPlaceholderHint: { color: colors.disabledForeground, fontSize: s(12), marginTop: 4 },
    episodeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    episodeButton: { width: '22%', paddingVertical: 10, borderRadius: radius.sm },
    episodeDuration: { color: colors.disabledForeground, fontSize: s(11), marginTop: 4 },
    error: { color: colors.error, textAlign: 'center', marginTop: 50 },
  }), [colors, cardBg, surfaceBg, s]);

  useEffect(() => {
    loadMediaDetail(id);
    loadSeasons(id);
    loadSeriesMedia(id);

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
    const CONCURRENCY_LIMIT = 3;

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
  const seasonsFromSeries = seriesMedia.map(m => m.seriesSeason ?? 1).sort((a, b) => a - b);
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
          <Image source={{ uri: currentMedia.posterUrl }} style={styles.poster} />
        )}
        <View style={styles.info}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={2}>{currentMedia.title}</Text>
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
          <View style={styles.genreRow}>
            {currentMedia.genres.slice(0, 3).map((g: string, i: number) => (
              <Text key={i} style={styles.genre}>{g}</Text>
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
              <TouchableOpacity key={d} onPress={() => navigation.navigate('搜索', { keyword: d, fromDetail: id })}>
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
              <TouchableOpacity key={a} onPress={() => navigation.navigate('搜索', { keyword: a, fromDetail: id })}>
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

      {episodeSources.length > 1 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>视频源</Text>
          <View style={styles.sourceRow}>
            {episodeSources.map((s: VideoSource) => (
              <Button
                key={s.id}
                variant="secondary"
                size="sm"
                active={selectedSourceId === s.id}
                style={styles.sourceButton}
                onPress={() => handleSourceChange(s.id)}
              >
                {s.name}
              </Button>
            ))}
          </View>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{isMovie ? '播放源' : `剧集 (${episodes.length}集)`}</Text>
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
                  <Button
                    key={`${ep.id}-${source.id || idx}`}
                    variant="primary"
                    size="sm"
                    style={styles.episodeButton}
                    onPress={() => navigation.navigate('Play', { episodeId: ep.id, mediaId: id, sourceId: source.sourceId, title: currentMedia.title + ' · ' + title })}
                  >
                    {title}
                  </Button>
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
                <Button
                  key={ep.id}
                  variant="primary"
                  size="sm"
                  disabled={isWatched}
                  style={styles.episodeButton}
                  onPress={() => navigation.navigate('Play', { episodeId: ep.id, mediaId: id, sourceId: selectedSourceId, title: currentMedia.title + (ep.title ? ` · ${ep.title}` : ` · 第${ep.episodeNumber}集`) })}
                >
                  {ep.title || `第${ep.episodeNumber}集`}
                  {duration !== null && (
                    <Text style={styles.episodeDuration}>
                      {Math.floor(duration / 60)}:{String(duration % 60).padStart(2, '0')}
                    </Text>
                  )}
                </Button>
              );
            })}
          </View>
        )}
      </View>
    </ScrollView>
    </BlurredBackground>
  );
}
