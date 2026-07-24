import { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useAppStore } from '../useAppStore';
import { getProvider } from '../init';
import { VideoDurationService } from '@movie-app/core';
import { Heart } from 'lucide-react-native';
import type { Episode, PlaySource, VideoSource } from '@movie-app/core';
import { useThemeColors } from '../themes/useThemeColors';

interface Props {
  route: any;
  navigation: any;
}

export default function DetailScreen({ route, navigation }: Props) {
  const { id } = route.params;
  const { currentMedia, episodes, seasons, isLoading, episodeSources, seriesMedia, loadMediaDetail, loadEpisodes, loadSeasons, loadSeasonEpisodes, loadSeriesMedia } = useAppStore();
  const colors = useThemeColors();
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

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    loadingContainer: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' },
    header: { flexDirection: 'row', padding: 20, paddingTop: 60 },
    poster: { width: 120, height: 170, borderRadius: 8, backgroundColor: colors.card },
    info: { flex: 1, marginLeft: 15, justifyContent: 'center' },
    titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 },
    title: { fontSize: 20, fontWeight: 'bold', color: colors.text, flex: 1, marginRight: 8 },
    favButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, backgroundColor: colors.card, gap: 4 },
    favButtonActive: { backgroundColor: colors.favorite },
    favText: { fontSize: 12, color: colors.textSecondary },
    favTextActive: { color: colors.text },
    alias: { fontSize: 13, color: colors.mutedForeground, marginBottom: 4 },
    subtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: 4 },
    updateTime: { fontSize: 13, color: colors.favorite, marginBottom: 8 },
    genreRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    genre: { fontSize: 12, color: colors.primary, backgroundColor: colors.primaryLight, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, overflow: 'hidden' },
    section: { padding: 20, borderTopWidth: 1, borderTopColor: colors.surface },
    sectionTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 10 },
    description: { fontSize: 14, color: colors.textSecondary, lineHeight: 22 },
    text: { fontSize: 14, color: colors.textSecondary },
    seasonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    seasonButton: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight },
    seasonButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    seasonText: { color: colors.textSecondary, fontSize: 14 },
    seasonTextActive: { color: colors.text },
    sourceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    sourceButton: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight },
    sourceButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    sourceText: { color: colors.textSecondary, fontSize: 14 },
    sourceTextActive: { color: colors.text },
    episodesPlaceholder: { paddingVertical: 30, alignItems: 'center' },
    episodesPlaceholderText: { color: colors.mutedForeground, fontSize: 14 },
    episodesPlaceholderHint: { color: colors.disabledForeground, fontSize: 12, marginTop: 4 },
    episodeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    episodeButton: { width: '22%', paddingVertical: 10, backgroundColor: colors.surface, borderRadius: 6, alignItems: 'center' },
    episodeButtonWatched: { opacity: 0.5 },
    episodeText: { color: colors.textSecondary, fontSize: 13 },
    episodeDuration: { color: colors.disabledForeground, fontSize: 11, marginTop: 4 },
    error: { color: colors.error, textAlign: 'center', marginTop: 50 },
  }), [colors]);

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
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.text} />
      </View>
    );
  }

  if (!currentMedia) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>加载失败</Text>
      </View>
    );
  }

  const isMovie = currentMedia.type === 'MOVIE';

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        {currentMedia.posterUrl && (
          <Image source={{ uri: currentMedia.posterUrl }} style={styles.poster} />
        )}
        <View style={styles.info}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={2}>{currentMedia.title}</Text>
            <TouchableOpacity style={[styles.favButton, isFav && styles.favButtonActive]} onPress={handleFav}>
              <Heart size={16} color={isFav ? colors.text : colors.textSecondary} fill={isFav ? colors.text : 'none'} />
              <Text style={[styles.favText, isFav && styles.favTextActive]}>{isFav ? '已收藏' : '收藏'}</Text>
            </TouchableOpacity>
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
          <Text style={styles.text}>{currentMedia.directors.join(' / ')}</Text>
        </View>
      )}

      {currentMedia.actors.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>演员</Text>
          <Text style={styles.text}>{currentMedia.actors.join(' / ')}</Text>
        </View>
      )}

      {displaySeasons.length > 1 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>季数</Text>
          <View style={styles.seasonRow}>
            {displaySeasons.map((s: number) => {
              const isCurrent = seasonToMediaMap.get(s) === id || (!seasonToMediaMap.has(s) && currentSeason === s);
              return (
                <TouchableOpacity
                  key={s}
                  style={[styles.seasonButton, isCurrent && styles.seasonButtonActive]}
                  onPress={() => handleSeasonChange(s)}
                >
                  <Text style={[styles.seasonText, isCurrent && styles.seasonTextActive]}>
                    第{s}季
                  </Text>
                </TouchableOpacity>
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
              <TouchableOpacity
                key={s.id}
                style={[styles.sourceButton, selectedSourceId === s.id && styles.sourceButtonActive]}
                onPress={() => handleSourceChange(s.id)}
              >
                <Text style={[styles.sourceText, selectedSourceId === s.id && styles.sourceTextActive]}>{s.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{isMovie ? '播放源' : `剧集 (${episodes.length}集)`}</Text>
        {isEpisodesLoading ? (
          <View style={styles.episodesPlaceholder}>
            <ActivityIndicator size="small" color={colors.primary} />
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
                    style={styles.episodeButton}
                    onPress={() => navigation.navigate('Play', { episodeId: ep.id, mediaId: id, sourceId: source.sourceId, title: currentMedia.title + ' · ' + title })}
                  >
                    <Text style={styles.episodeText}>{title}</Text>
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
                  style={[styles.episodeButton, isWatched && styles.episodeButtonWatched]}
                  onPress={() => navigation.navigate('Play', { episodeId: ep.id, mediaId: id, sourceId: selectedSourceId, title: currentMedia.title + (ep.title ? ` · ${ep.title}` : ` · 第${ep.episodeNumber}集`) })}
                >
                  <Text style={styles.episodeText}>
                    {ep.title || `第${ep.episodeNumber}集`}
                  </Text>
                  {duration !== null && (
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
    </ScrollView>
  );
}
