import { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { getProvider } from '../init';
import { useAppStore } from '../useAppStore';
import { ArrowLeft, RotateCcw } from 'lucide-react-native';
import { SystemConfigService } from '@movie-app/core';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import { NextEpisodeOverlay } from '../components/NextEpisodeOverlay';
import { SkipForwardOverlay } from '../components/SkipForwardOverlay';
import BlurredBackground from '../components/BlurredBackground';
import { Button } from '../components/ui/Button';
import type { PlaySource, VideoSource, Episode, Media } from '@movie-app/core';
import { radius } from '../themes/radiusTokens';

interface Props {
  route: any;
  navigation: any;
}

export default function PlayScreen({ route, navigation }: Props) {
  const { episodeId, mediaId: paramMediaId, sourceId: paramSourceId, title: paramTitle } = route.params;
  const {
    saveWatchProgress, episodes, episodesLoading, seasons, episodeSources, seriesMedia,
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

  // 功能7: 从头播放快进浮窗
  const [skipForwardVisible, setSkipForwardVisible] = useState(false);
  const skipForwardVisibleRef = useRef(false);
  const skipDismissedRef = useRef(false);
  const skipEligibleRef = useRef(false);

  // 功能6: 进度保存节流
  const [lastSaveTime, setLastSaveTime] = useState(0);

  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [episodeListSwitching, setEpisodeListSwitching] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);

  useEffect(() => {
    if (!media?.posterUrl) {
      setBgImageUrl(null);
      return;
    }
    setBgImageUrl(media.posterUrl);
  }, [media]);

  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const surfaceBg = hexToRgba(colors.surface, cardOpacity / 100);
  const accentBg = hexToRgba(colors.cardAccent, cardOpacity / 100);
  const dimBg = hexToRgba(colors.cardDim, cardOpacity / 100);
  const sf = useScaledFontSize();

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', padding: 15, paddingTop: 50, backgroundColor: colors.playerHeader },
    backButton: { padding: 8 },
    headerTitle: { flex: 1, fontSize: sf(16), fontWeight: '600', color: colors.text, marginLeft: 8 },
    placeholder: { width: 40 },
    videoContainer: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.playerBg },
    video: { width: '100%', height: '100%' },
    rotateButton: {
      position: 'absolute',
      right: 48,
      bottom: 10,
      zIndex: 40,
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    loadingOverlay: { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1 },
    loadingText: { color: colors.textSecondary, fontSize: sf(14), marginTop: 8 },
    errorOverlay: { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 1, padding: 20 },
    errorText: { color: colors.error, fontSize: sf(16), textAlign: 'center' },
    retryButton: { marginTop: 16 },
    body: { flex: 1 },
    mediaInfo: { padding: 15 },
    mediaTitle: { fontSize: sf(18), fontWeight: '600', color: colors.text, marginBottom: 4 },
    mediaSubtitle: { fontSize: sf(14), color: colors.mutedForeground },
    section: { padding: 15 },
    sectionLabel: { fontSize: sf(14), color: colors.mutedForeground, marginBottom: 10 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.sm },
    sourceEpisodeRow: { flexDirection: 'row', alignItems: 'stretch' },
    sourceTabCol: { flexDirection: 'column', alignItems: 'flex-end', gap: 6, paddingLeft: 12 },
    sourceTab: { flex: 1, justifyContent: 'center', borderTopLeftRadius: radius.md, borderBottomLeftRadius: radius.md, borderTopRightRadius: 0, borderBottomRightRadius: 0 },
    sourceTabActive: { backgroundColor: accentBg, paddingVertical: 10, paddingHorizontal: 12, width: 92 },
    sourceTabInactive: { backgroundColor: dimBg, paddingVertical: 6, paddingHorizontal: 8, width: 76 },
    sourceTabText: { fontSize: sf(11), fontWeight: '500', textAlign: 'left' },
    episodePanel: { flex: 1, minWidth: 0, backgroundColor: accentBg, borderTopRightRadius: radius.md, borderBottomRightRadius: radius.md, padding: 12 },
    episodesPlaceholder: { paddingVertical: 30, alignItems: 'center' },
    episodesPlaceholderText: { color: colors.mutedForeground, fontSize: sf(14) },
    episodeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    episodeBtn: { paddingVertical: 10, paddingHorizontal: 6, borderRadius: radius.sm, alignItems: 'center' },
    episodeBtnIdle: { backgroundColor: dimBg },
    episodeBtnActive: { backgroundColor: colors.buttonPrimaryText },
    episodeBtnWatched: { opacity: 0.5 },
    episodeBtnText: { color: colors.textSecondary, fontSize: sf(13), fontWeight: '500', textAlign: 'center' },
    episodeBtnTextActive: { color: colors.cardDim },
  }), [colors, cardBg, surfaceBg, accentBg, dimBg, sf]);

  useEffect(() => {
    if (!mediaId) return;
    loadSeasons(mediaId);
    loadSeriesMedia(mediaId);
  }, [mediaId]);

  useEffect(() => {
    if (!mediaId || currentSeason === 0) return;
    setSourcesLoaded(false);
    loadEpisodeSources(mediaId, currentSeason).then(() => setSourcesLoaded(true));
  }, [mediaId, currentSeason, loadEpisodeSources]);

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
    if (!episodesLoading) setEpisodeListSwitching(false);
  }, [episodesLoading]);

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
        skipEligibleRef.current = seekTime < 5 * 60;
        setSkipForwardVisible(false);
        skipForwardVisibleRef.current = false;
        skipDismissedRef.current = false;
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

  const videoRef = useRef<VideoView>(null);
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

  // 定时保存进度 (10s) + 下一集浮层检测 + 从头播放快进浮窗
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
        if (canShow) {
          setOverlayVisible(true);
          setSkipForwardVisible(false);
          skipForwardVisibleRef.current = false;
          skipDismissedRef.current = true;
        }

        // 从头播放快进浮窗（按播放位置：0:00–5:00 内可见，过 5:00 消失）
        if (ct >= 5 * 60) {
          setSkipForwardVisible(false);
          skipForwardVisibleRef.current = false;
        } else if (
          skipEligibleRef.current &&
          !skipDismissedRef.current &&
          !skipForwardVisibleRef.current &&
          ct > 0
        ) {
          setSkipForwardVisible(true);
          skipForwardVisibleRef.current = true;
        }
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [player, outroThresholdMinutes, showNextEpisodeOverlay]);

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

  const handleRotate = () => {
    if (isLandscape) {
      setIsLandscape(false);
      videoRef.current?.exitFullscreen();
    } else {
      setIsLandscape(true);
      videoRef.current?.enterFullscreen();
    }
  };

  // 功能2: 下一集
  const filteredEpisodes = episodes;

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

  const handleSkipForward = (delta: number) => {
    const p = playerRef.current;
    if (!p) return;
    const dur = p.duration || 0;
    p.currentTime = Math.min(p.currentTime + delta, dur > 0 ? dur : p.currentTime + delta);
  };

  const handleSkipForwardClose = () => {
    setSkipForwardVisible(false);
    skipForwardVisibleRef.current = false;
    skipDismissedRef.current = true;
  };

  const seasonToMediaMap = new Map<number, string>();
  seriesMedia.forEach(m => {
    if (m.seriesSeason) seasonToMediaMap.set(m.seriesSeason, m.id);
  });
  const seasonsFromSeries = [...new Set(seriesMedia.map(m => m.seriesSeason ?? 1))].sort((a, b) => a - b);
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
    setEpisodeListSwitching(true);
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
    <BlurredBackground imageUrl={bgImageUrl}>
    <View style={styles.container}>
      <View style={styles.header}>
        <Button variant="icon" size="sm" style={styles.backButton} onPress={() => navigation.goBack()}>
          <ArrowLeft size={20} color="#fff" />
        </Button>
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
              <Button variant="primary" size="md" style={styles.retryButton} onPress={handleRetry}>
                重试
              </Button>
            )}
          </View>
        )}
        {videoUrl && !error && (
          <VideoView
            ref={videoRef}
            style={styles.video}
            player={player}
            contentFit="contain"
            fullscreenOptions={{ enable: true, orientation: isLandscape ? 'landscape' : 'default' }}
            onFullscreenEnter={() => setIsLandscape(true)}
            onFullscreenExit={() => setIsLandscape(false)}
          />
        )}
        {videoUrl && !error && (
          <TouchableOpacity
            style={styles.rotateButton}
            activeOpacity={0.7}
            onPress={handleRotate}
          >
            <RotateCcw size={18} color="#fff" />
          </TouchableOpacity>
        )}
        <NextEpisodeOverlay
          show={overlayVisible}
          nextEpisodeTitle={nextEpisodeTitle}
          onNext={handleNextEpisode}
          onClose={handleOverlayClose}
        />
        <SkipForwardOverlay
          show={skipForwardVisible}
          onSkip={handleSkipForward}
          onClose={handleSkipForwardClose}
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
                    <Button
                      key={s.id}
                      variant="secondary"
                      size="sm"
                      active={i === activePlayIdx}
                      style={styles.chip}
                      onPress={() => handlePlaySourceChange(i)}
                    >
                      {baseName}{qualityStr}{suffix}
                    </Button>
                  );
                })}
              </View>
            </View>
          );
        })()}

        {displaySeasons.length > 1 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>季数</Text>
            <View style={styles.row}>
              {displaySeasons.map((s: number) => {
                const isCurrent = seasonToMediaMap.get(s) === mediaId || (!seasonToMediaMap.has(s) && currentSeason === s);
                return (
                  <Button
                    key={s}
                    variant="secondary"
                    size="sm"
                    active={isCurrent}
                    style={styles.chip}
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
          <Text style={styles.sectionLabel}>剧集（{filteredEpisodes.length}集）</Text>
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
                      <Text numberOfLines={1} style={[styles.sourceTabText, { color: active ? colors.buttonPrimaryText : colors.buttonSecondaryText }]}>
                        {s.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <View style={styles.episodePanel}>
              {episodesLoading || episodeListSwitching || !sourcesLoaded || (episodeSources.length > 0 && !selectedSourceId) ? (
                <View style={styles.episodesPlaceholder}>
                  <ActivityIndicator size="small" color={colors.mutedForeground} />
                  <Text style={styles.episodesPlaceholderText}>加载中...</Text>
                </View>
              ) : filteredEpisodes.length === 0 ? (
                <View style={styles.episodesPlaceholder}>
                  <Text style={styles.episodesPlaceholderText}>暂无剧集</Text>
                </View>
              ) : (
                <View style={styles.episodeGrid}>
                  {filteredEpisodes.map((ep: Episode) => {
                    const isActive = ep.id === currentEpisodeId;
                    const isWatched = watchedEpisodes.has(ep.id) && !isActive;
                    return (
                      <TouchableOpacity
                        key={ep.id}
                        activeOpacity={0.7}
                        disabled={isWatched}
                        style={[styles.episodeBtn, isActive ? styles.episodeBtnActive : styles.episodeBtnIdle, isWatched && styles.episodeBtnWatched]}
                        onPress={() => handleEpisodePress(ep)}
                      >
                        <Text style={[styles.episodeBtnText, isActive && styles.episodeBtnTextActive]}>
                          {ep.title || `第${ep.episodeNumber}集`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
    </BlurredBackground>
  );
}
