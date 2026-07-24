import { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { getProvider } from '../init';
import { useAppStore } from '../useAppStore';
import { ArrowLeft } from 'lucide-react-native';
import { SystemConfigService } from '@movie-app/core';
import { useThemeColors } from '../themes/useThemeColors';
import { NextEpisodeOverlay } from '../components/NextEpisodeOverlay';
import type { PlaySource, VideoSource, Episode, Media } from '@movie-app/core';

interface Props {
  route: any;
  navigation: any;
}

export default function PlayScreen({ route, navigation }: Props) {
  const { episodeId, mediaId: paramMediaId, sourceId: paramSourceId, title: paramTitle } = route.params;
  const {
    saveWatchProgress, episodes, seasons, episodeSources, seriesMedia,
    loadEpisodes, loadSeasons, loadEpisodeSources, loadSeriesMedia,
  } = useAppStore();

  const [mediaId, setMediaId] = useState<string | null>(paramMediaId || null);
  const [currentEpisodeId, setCurrentEpisodeId] = useState(episodeId);
  const [currentTitle, setCurrentTitle] = useState(paramTitle || '');
  const [currentSeason, setCurrentSeason] = useState(1);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(paramSourceId || null);
  const [playSources, setPlaySources] = useState<PlaySource[]>([]);
  const [activePlayIdx, setActivePlayIdx] = useState(0);
  const [videoUrl, setVideoUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialCurrentTime, setInitialCurrentTime] = useState(0);

  // 功能1: 播放配置
  const [outroThresholdMinutes, setOutroThresholdMinutes] = useState(10);
  const [showNextEpisodeOverlay, setShowNextEpisodeOverlay] = useState(true);

  // 功能2: 已看剧集
  const [watchedEpisodes, setWatchedEpisodes] = useState<Set<string>>(new Set());

  // 功能3: 影片信息
  const [media, setMedia] = useState<Media | null>(null);

  // 功能4: 下一集浮层
  const [overlayVisible, setOverlayVisible] = useState(false);
  const overlayDismissedRef = useRef(false);

  // 功能6: 进度保存节流
  const [lastSaveTime, setLastSaveTime] = useState(0);

  const colors = useThemeColors();

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.playerBg },
    header: { flexDirection: 'row', alignItems: 'center', padding: 15, paddingTop: 50, backgroundColor: colors.playerHeader },
    backButton: { padding: 8 },
    headerTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.text, marginLeft: 8 },
    placeholder: { width: 40 },
    videoContainer: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.playerBg },
    video: { width: '100%', height: '100%' },
    loadingOverlay: { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1 },
    loadingText: { color: colors.textSecondary, fontSize: 14, marginTop: 8 },
    errorOverlay: { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 1, padding: 20 },
    errorText: { color: colors.error, fontSize: 16, textAlign: 'center' },
    retryButton: { paddingHorizontal: 24, paddingVertical: 12, backgroundColor: colors.primary, borderRadius: 8, marginTop: 16 },
    retryButtonText: { color: colors.text, fontSize: 16, fontWeight: '600' },
    body: { flex: 1 },
    mediaInfo: { padding: 15, borderBottomWidth: 1, borderBottomColor: colors.card },
    mediaTitle: { fontSize: 18, fontWeight: '600', color: colors.text, marginBottom: 4 },
    mediaSubtitle: { fontSize: 14, color: colors.mutedForeground },
    section: { padding: 15, borderBottomWidth: 1, borderBottomColor: colors.card },
    sectionLabel: { fontSize: 14, color: colors.mutedForeground, marginBottom: 10 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.card, borderRadius: 6 },
    chipActive: { backgroundColor: colors.primary },
    chipDisabled: { opacity: 0.5 },
    chipText: { fontSize: 13, color: colors.textSecondary },
    chipTextActive: { color: colors.text },
    chipTextDisabled: { color: colors.disabledForeground },
    episodeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    episodeBtn: { width: '22%', paddingVertical: 10, backgroundColor: colors.surface, borderRadius: 6, alignItems: 'center' },
    episodeBtnActive: { backgroundColor: colors.primary },
    episodeBtnWatched: { opacity: 0.5 },
    episodeText: { color: colors.textSecondary, fontSize: 13 },
    episodeTextActive: { color: colors.text },
  }), [colors]);

  useEffect(() => {
    if (!mediaId) return;
    loadSeasons(mediaId);
    loadSeriesMedia(mediaId);
  }, [mediaId]);

  useEffect(() => {
    if (!mediaId || currentSeason === 0) return;
    loadEpisodeSources(mediaId, currentSeason);
  }, [mediaId, currentSeason]);

  useEffect(() => {
    if (episodeSources.length === 0) return;
    if (!selectedSourceId || !episodeSources.find(s => s.id === selectedSourceId)) {
      setSelectedSourceId(episodeSources[0].id);
    }
  }, [episodeSources]);

  useEffect(() => {
    if (!mediaId || currentSeason === 0 || !selectedSourceId) return;
    loadEpisodes(mediaId, currentSeason, selectedSourceId);
  }, [mediaId, currentSeason, selectedSourceId]);

  useEffect(() => {
    if (seasons.length > 0 && !seasons.includes(currentSeason)) {
      setCurrentSeason(seasons[0]);
    }
  }, [seasons]);

  // 主加载逻辑: episode + media + sources + history + playbackConfig + watchedEpisodes
  useEffect(() => {
    if (!currentEpisodeId) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      setOverlayVisible(false);
      overlayDismissedRef.current = false;
      try {
        const provider = getProvider();
        const episode = await provider.getEpisodeById(currentEpisodeId);
        if (cancelled || !episode) return;

        const [m, sources, history, allHistory] = await Promise.all([
          provider.getMediaById(episode.mediaId),
          provider.getPlaySourcesByEpisodeId(episode.id),
          provider.getWatchHistoryByMediaId(episode.mediaId),
          provider.getAllWatchHistoryByMediaId(episode.mediaId),
        ]);
        if (cancelled) return;

        // 影片信息
        setMedia(m);
        if (m && !mediaId) setMediaId(m.id);

        // 播放配置
        const configService = new SystemConfigService(provider);
        const playbackConfig = await configService.getPlaybackConfig();
        setOutroThresholdMinutes(playbackConfig.outroThresholdMinutes);
        setShowNextEpisodeOverlay(playbackConfig.showNextEpisodeOverlay);

        // 已看剧集
        const watched = new Set<string>();
        for (const h of allHistory) {
          if (h.episodeId && h.episodeId !== m?.id && (h.progress > 60 || (h.duration > 0 && h.progress / h.duration >= 0.1))) {
            watched.add(h.episodeId);
          }
        }
        setWatchedEpisodes(watched);

        // 恢复进度
        let seekTime = 0;
        if (history && history.episodeId === episode.id) {
          const nearEnd = history.duration > 0 && history.progress >= history.duration - 5;
          if (!nearEnd) seekTime = history.progress;
        }
        setInitialCurrentTime(seekTime);
        setPlaySources(sources);
        if (sources.length > 0) {
          setVideoUrl(sources[0].url);
          setActivePlayIdx(0);
        } else {
          setError('无可播放的线路');
        }
      } catch {
        setError('加载失败');
      } finally {
        setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentEpisodeId]);

  // 功能6: 进度保存节流 (10s + 接近片尾)
  const handleTimeUpdate = (currentTime: number, duration: number) => {
    if (duration > 0 && mediaId) {
      const now = Date.now();
      const nearEnd = Math.floor(currentTime) >= duration - 2;
      if (now - lastSaveTime >= 10000 || nearEnd) {
        saveWatchProgress(mediaId, currentEpisodeId, Math.floor(currentTime), Math.floor(duration));
        setLastSaveTime(now);
      }
    }
  };

  const playerRef = useRef<any>(null);
  const player = useVideoPlayer(videoUrl as any, (p) => {
    p.loop = false;
    playerRef.current = p;
    if (initialCurrentTime > 0) {
      p.currentTime = initialCurrentTime;
    }
  });

  useEffect(() => {
    if (player && initialCurrentTime > 0) {
      player.currentTime = initialCurrentTime;
    }
  }, [player, initialCurrentTime]);

  // 定时保存进度 (10s) + 下一集浮层检测
  useEffect(() => {
    if (!player) return;
    const interval = setInterval(() => {
      if (player.playing) {
        const ct = player.currentTime;
        const dur = player.duration || 0;
        handleTimeUpdate(ct, dur);

        // 下一集浮层检测
        const threshold = outroThresholdMinutes * 60;
        const canShow =
          !overlayDismissedRef.current &&
          showNextEpisodeOverlay &&
          nextEpisode != null &&
          dur > threshold &&
          ct > 0 &&
          dur - ct <= threshold;
        setOverlayVisible(canShow);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [player, outroThresholdMinutes, showNextEpisodeOverlay]);

  const handlePlaySourceFail = async (sourceId: string) => {
    const provider = getProvider();
    await provider.reportPlaySourceFail(sourceId);
    const nextIdx = activePlayIdx + 1;
    if (nextIdx < playSources.length) {
      setError(`线路 ${activePlayIdx + 1} 失败，正在尝试线路 ${nextIdx + 1}...`);
      setTimeout(() => {
        setActivePlayIdx(nextIdx);
        setVideoUrl(playSources[nextIdx].url);
        setIsLoading(true);
        setError(null);
      }, 1500);
    } else {
      setError('所有线路均失败，请稍后重试');
    }
  };

  const handlePlaySourceChange = (idx: number) => {
    setActivePlayIdx(idx);
    setVideoUrl(playSources[idx].url);
    setIsLoading(true);
    setError(null);
  };

  const handleRetry = () => {
    if (playSources.length > 0) {
      setActivePlayIdx(0);
      setVideoUrl(playSources[0].url);
      setIsLoading(true);
      setError(null);
    }
  };

  // 功能2: 下一集
  const filteredEpisodes = useMemo(() => {
    if (!selectedSourceId) return episodes;
    return episodes.filter(ep => ep.sourceId === selectedSourceId);
  }, [episodes, selectedSourceId]);

  const nextEpisode = useMemo(() => {
    if (!currentEpisodeId || filteredEpisodes.length === 0 || media?.type === 'MOVIE') return null;
    const idx = filteredEpisodes.findIndex((ep: Episode) => ep.id === currentEpisodeId);
    if (idx < 0 || idx >= filteredEpisodes.length - 1) return null;
    return filteredEpisodes[idx + 1] as Episode;
  }, [currentEpisodeId, filteredEpisodes, media?.type]);

  const handleNextEpisode = () => {
    if (nextEpisode) {
      setCurrentEpisodeId(nextEpisode.id);
      setCurrentTitle(
        (media?.title || '') + (nextEpisode.title ? ` · ${nextEpisode.title}` : ` · 第${nextEpisode.episodeNumber}集`)
      );
    }
  };

  const handleOverlayClose = () => {
    setOverlayVisible(false);
    overlayDismissedRef.current = true;
  };

  const seasonToMediaMap = new Map<number, string>();
  seriesMedia.forEach(m => {
    if (m.seriesSeason) seasonToMediaMap.set(m.seriesSeason, m.id);
  });
  const seasonsFromSeries = seriesMedia.map(m => m.seriesSeason ?? 1).sort((a, b) => a - b);
  const displaySeasons = seasonsFromSeries.length > 0 ? seasonsFromSeries : seasons;

  const handleSeasonChange = (season: number) => {
    const targetId = seasonToMediaMap.get(season);
    if (targetId && targetId !== mediaId) {
      navigation.replace('Play', { episodeId: null, mediaId: targetId, sourceId: null, title: seriesMedia.find(m => m.id === targetId)?.title || '' });
    } else {
      setCurrentSeason(season);
      setSelectedSourceId(null);
    }
  };

  const handleSourceChange = (sourceId: string) => {
    setSelectedSourceId(sourceId);
  };

  const handleEpisodePress = (ep: Episode) => {
    setCurrentEpisodeId(ep.id);
    setCurrentTitle(
      (media?.title || paramTitle?.replace(/·.*$/, '').trim() || '') + (ep.title ? ` · ${ep.title}` : ` · 第${ep.episodeNumber}集`)
    );
  };

  const nextEpisodeTitle = nextEpisode
    ? `第${nextEpisode.episodeNumber}集${nextEpisode.title ? ` · ${nextEpisode.title}` : ''}`
    : '';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <ArrowLeft size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{currentTitle || '正在播放'}</Text>
        <View style={styles.placeholder} />
      </View>

      <View style={styles.videoContainer}>
        {isLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.loadingText}>加载中...</Text>
          </View>
        )}
        {error && (
          <View style={styles.errorOverlay}>
            <Text style={styles.errorText}>{error}</Text>
            {playSources.length > 0 && (
              <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
                <Text style={styles.retryButtonText}>重试</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        {videoUrl && !error && (
          <VideoView
            style={styles.video}
            player={player}
            contentFit="contain"
            fullscreenOptions={{ enable: true }}
          />
        )}
        <NextEpisodeOverlay
          show={overlayVisible}
          nextEpisodeTitle={nextEpisodeTitle}
          onNext={handleNextEpisode}
          onClose={handleOverlayClose}
        />
      </View>

      <ScrollView style={styles.body}>
        {/* 影片信息 */}
        {media && (
          <View style={styles.mediaInfo}>
            <Text style={styles.mediaTitle}>
              {media.title}
              {currentTitle?.includes('·') ? ` ${currentTitle}` : ''}
            </Text>
            <Text style={styles.mediaSubtitle}>
              {media.year}{media.area ? ` · ${media.area}` : ''}
            </Text>
          </View>
        )}

        {/* 播放线路 (功能5: 质量标签) */}
        {playSources.length > 1 && (() => {
          const sourceKeyMap = new Map<string, number>();
          playSources.forEach(s => {
            const key = `${s.sourceName || ''}_${s.quality || ''}`;
            sourceKeyMap.set(key, (sourceKeyMap.get(key) || 0) + 1);
          });
          const keyIndexMap = new Map<string, number>();
          return (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>播放线路（{activePlayIdx + 1}/{playSources.length}）</Text>
              <View style={styles.row}>
                {playSources.map((s, i) => {
                  const key = `${s.sourceName || ''}_${s.quality || ''}`;
                  const count = sourceKeyMap.get(key) || 1;
                  const idx = (keyIndexMap.get(key) || 0) + 1;
                  keyIndexMap.set(key, idx);
                  const baseName = s.sourceName || `线路${i + 1}`;
                  const qualityStr = s.quality ? ` · ${s.quality}` : '';
                  const suffix = count > 1 ? ` (${idx})` : '';
                  return (
                    <TouchableOpacity
                      key={s.id}
                      style={[styles.chip, i === activePlayIdx && styles.chipActive, s.isActive === false && styles.chipDisabled]}
                      onPress={() => s.isActive !== false && handlePlaySourceChange(i)}
                      disabled={s.isActive === false}
                    >
                      <Text style={[styles.chipText, i === activePlayIdx && styles.chipTextActive, s.isActive === false && styles.chipTextDisabled]}>
                        {baseName}{qualityStr}{suffix}
                        {s.isActive === false && ' (不可用)'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        })()}

        {episodeSources.length > 1 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>视频源</Text>
            <View style={styles.row}>
              {episodeSources.map((s: VideoSource) => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.chip, selectedSourceId === s.id && styles.chipActive]}
                  onPress={() => handleSourceChange(s.id)}
                >
                  <Text style={[styles.chipText, selectedSourceId === s.id && styles.chipTextActive]}>{s.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {displaySeasons.length > 1 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>季数</Text>
            <View style={styles.row}>
              {displaySeasons.map((s: number) => {
                const isCurrent = seasonToMediaMap.get(s) === mediaId || (!seasonToMediaMap.has(s) && currentSeason === s);
                return (
                  <TouchableOpacity
                    key={s}
                    style={[styles.chip, isCurrent && styles.chipActive]}
                    onPress={() => handleSeasonChange(s)}
                  >
                    <Text style={[styles.chipText, isCurrent && styles.chipTextActive]}>第{s}季</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* 功能3: 已看剧集标记 */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>剧集（{filteredEpisodes.length}集）</Text>
          <View style={styles.episodeGrid}>
            {filteredEpisodes.map((ep: Episode) => {
              const isWatched = watchedEpisodes.has(ep.id) && ep.id !== currentEpisodeId;
              return (
                <TouchableOpacity
                  key={ep.id}
                  style={[
                    styles.episodeBtn,
                    ep.id === currentEpisodeId && styles.episodeBtnActive,
                    isWatched && styles.episodeBtnWatched,
                  ]}
                  onPress={() => handleEpisodePress(ep)}
                >
                  <Text style={[
                    styles.episodeText,
                    ep.id === currentEpisodeId && styles.episodeTextActive,
                  ]}>
                    {ep.title || `第${ep.episodeNumber}集`}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
