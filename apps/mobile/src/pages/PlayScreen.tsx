import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Alert, Modal, Platform, Switch, AppState } from 'react-native';
import { VideoView, createVideoPlayer, isPictureInPictureSupported } from 'expo-video';
import { Paths, File } from 'expo-file-system';
// 可选原生依赖：expo-video-cache（iOS 本地代理，将 HLS 分片改为 N 并发下载）。
// 仅在用户构建环境安装；此处用 try/require 守卫，未安装时自动降级为直连。
// @ts-ignore - optional native dependency, resolvable after pnpm install in build env
const VideoCache: any = (() => { try { return require('expo-video-cache'); } catch { return null; } })();
import { getProvider } from '../init';
import { useAppStore, getStore } from '../useAppStore';
import { ArrowLeft, Mic, EyeOff, Heart, ThumbsDown, Star, Settings, PictureInPicture2 } from 'lucide-react-native';
import { SystemConfigService, getVoiceControlSystem, UNCATEGORIZED_GENRE, VideoDurationService } from '@movie-app/core';
import { clearCategoryFilterCache } from '../categoryFilterCache';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import { NextEpisodeOverlay } from '../components/NextEpisodeOverlay';
import { SkipForwardOverlay } from '../components/SkipForwardOverlay';
import { VoiceControlOverlay } from '../components/VoiceControlOverlay';
import { CastButton } from '../components/cast/CastButton';
import { CastRemoteControl } from '../components/cast/CastRemoteControl';
import { useCastManager } from '../hooks/useCastManager';
import { useCastStore } from '../stores/castStore';
import BlurredBackground from '../components/BlurredBackground';
import { Button } from '../components/ui/Button';
import type { PlaySource, VideoSource, Episode, Media } from '@movie-app/core';
import { radius } from '../themes/radiusTokens';
import { SegmentProgress } from '../components/SegmentProgress';
import { createSegmentSnapshotBuilder, type SegmentProgressSnapshot } from '../services/segmentProgress';

interface Props {
  route: any;
  navigation: any;
}

const typeScreenMap: Record<string, string> = {
  MOVIE: 'Movie',
  TV: 'TV',
  VARIETY: 'Variety',
  ANIME: 'Anime',
  DOCUMENTARY: 'Documentary',
};

export default function PlayScreen({ route, navigation }: Props) {
  const { episodeId, mediaId: paramMediaId, sourceId: paramSourceId, playSourceId: paramPlaySourceId, title: paramTitle } = route.params;
  const {
    saveWatchProgress, episodes, episodesLoading, seasons, episodeSources, seriesMedia,
    loadEpisodes, loadSeasons, loadEpisodeSources, loadSeriesMedia,
    currentMedia, isRatingLoading, toggleDislike, isDisliked: checkDisliked, hideMediaByGenres, fetchMediaRating, loadMediaDetail,
  } = useAppStore();

  const [mediaId, setMediaId] = useState<string | null>(paramMediaId || null);
  const [currentEpisodeId, setCurrentEpisodeId] = useState(episodeId);
  const [currentTitle, setCurrentTitle] = useState(paramTitle || '');
  const [currentSeason, setCurrentSeason] = useState(1);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(paramSourceId || null);
  const [playSources, setPlaySources] = useState<PlaySource[]>([]);
  const playSourcesRef = useRef<PlaySource[]>([]);
  playSourcesRef.current = playSources;
  const [plotExpanded, setPlotExpanded] = useState(false);
  const [plotOverflow, setPlotOverflow] = useState(false);
  const [castExpanded, setCastExpanded] = useState(false);
  const [castOverflow, setCastOverflow] = useState(false);
  const [isFav, setIsFav] = useState(false);
  const [isDisliked, setIsDisliked] = useState(false);
  const [hideModalVisible, setHideModalVisible] = useState(false);
  const [selectedHideGenres, setSelectedHideGenres] = useState<string[]>([]);
  const [hiding, setHiding] = useState(false);
  const [activePlayIdx, setActivePlayIdx] = useState(0);
  const [videoUrl, setVideoUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialCurrentTime, setInitialCurrentTime] = useState(0);

  // 功能1: 播放配置
  const [outroThresholdMinutes, setOutroThresholdMinutes] = useState(10);
  const [showNextEpisodeOverlay, setShowNextEpisodeOverlay] = useState(true);
  // 功能12: 移动端 N 并发分片读取
  const [prefetchConcurrency, setPrefetchConcurrency] = useState(6);
  const [videoCacheReady, setVideoCacheReady] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  // 功能13: 预读分片进度
  const [showSegmentProgress, setShowSegmentProgress] = useState(true);
  const [segmentSnapshot, setSegmentSnapshot] = useState<SegmentProgressSnapshot | null>(null);
  const segmentBuilderRef = useRef<ReturnType<typeof createSegmentSnapshotBuilder>>(null);

  // Android: 把 N 同步写入 cacheDir/prefetch_concurrency，供 expo-video 原生读取
  const writePrefetchFile = (n: number) => {
    if (Platform.OS !== 'android' || n <= 0) return;
    try {
      const file = new File(Paths.cache, 'prefetch_concurrency');
      try { file.create({ overwrite: true }); } catch {}
      file.write(String(n));
    } catch {}
  };

  // 功能10: 播放设置菜单（倍速/清晰度/字幕）
  const [settingsVisible, setSettingsVisible] = useState(false);

  // 功能2: 已看剧集
  const [watchedEpisodes, setWatchedEpisodes] = useState<Set<string>>(new Set());

  // 逐集真实时长探测
  const [episodeDurations, setEpisodeDurations] = useState<Record<string, number | null>>({});

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
  const lastTimeRef = useRef(0);

  // 待应用的恢复位置：source 真正就绪后再 seek，避免一次性赋值被丢弃
  const pendingSeekRef = useRef(0);

  // 功能8: 语音控制
  const [voiceControlVisible, setVoiceControlVisible] = useState(false);
  const voiceControl = getVoiceControlSystem();

  // 功能9: 投屏
  const getVideoUrlRef = useRef(() => videoUrl);
  getVideoUrlRef.current = () => videoUrl;
  const getTitleRef = useRef(() => currentTitle);
  getTitleRef.current = () => currentTitle;
  const getDurationRef = useRef(() => player?.duration || 0);
  getDurationRef.current = () => player?.duration || 0;

  const handleResumeLocal = useCallback((position: number) => {
    setVideoUrl(getVideoUrlRef.current());
    setIsLoading(true);
    setError(null);
    if (position > 0) {
      setInitialCurrentTime(position);
    }
  }, []);

  const castManager = useCastManager(
    () => getVideoUrlRef.current(),
    () => getTitleRef.current(),
    () => getDurationRef.current(),
    handleResumeLocal,
  );

  const handleCastDeviceSelect = async (device: { id: string; name: string; protocol: string }) => {
    try {
      await castManager.connectToDevice(
        { ...device, protocol: device.protocol as any, isConnected: false },
        videoUrl,
        currentTitle,
        player?.duration || 0,
      );
    } catch {
      // error handled by castManager
    }
  };

  const { isCasting } = useCastStore();

  // 功能6: 进度保存节流
  const [lastSaveTime, setLastSaveTime] = useState(0);

  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [episodeListSwitching, setEpisodeListSwitching] = useState(false);
  const isLandscapeRef = useRef(false);

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
    toolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: colors.playerBg,
    },
    toolbarButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(255,255,255,0.1)',
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
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
    favGroup: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
    favButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, gap: 4 },
    ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
    ratingValue: { fontSize: sf(18), fontWeight: 'bold', color: colors.warning },
    ratingCount: { fontSize: sf(12), color: colors.mutedForeground },
    ratingLoading: { fontSize: sf(13), color: colors.mutedForeground, marginLeft: 2 },
    genreRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    genre: { fontSize: sf(13), color: colors.text, backgroundColor: colors.card, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.sm },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
    modalCard: { width: '100%', maxWidth: 340, borderRadius: radius.lg, padding: 18 },
    modalTitle: { fontSize: sf(16), fontWeight: '600', color: colors.text, marginBottom: 6 },
    modalDesc: { fontSize: sf(13), color: colors.mutedForeground, marginBottom: 12 },
    modalGenres: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
    genreChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1 },
    genreChipText: { fontSize: sf(13), color: colors.text },
    modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
    modalButton: { minWidth: 90 },
    settingsSheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 18, maxHeight: '75%' },
    settingsTitle: { fontSize: sf(16), fontWeight: '600', marginBottom: 14 },
    settingsLabel: { fontSize: sf(13), marginBottom: 8 },
    settingsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
    settingsChip: { minWidth: 64 },
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
    episodeDuration: { color: colors.disabledForeground, fontSize: sf(11), marginTop: 4 },
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
    setVideoUrl('');
    setPlaySources([]);
    setActivePlayIdx(0);
    (async () => {
      setIsLoading(true);
      setError(null);
      setOverlayVisible(false);
      overlayDismissedRef.current = false;
      try {
        const provider = getProvider();
        const episode = await provider.getEpisodeById(currentEpisodeId);
        if (cancelled || !episode) return;

        const [m, sources, allHistory] = await Promise.all([
          provider.getMediaById(episode.mediaId),
          provider.getPlaySourcesByEpisodeId(episode.id),
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
        setPrefetchConcurrency(playbackConfig.prefetchConcurrency);
        setShowSegmentProgress(playbackConfig.showSegmentProgress);
        // 同步写入 Android 原生可读的并发文件（必须在播放源构建前落盘，避免首播读到默认 5）
        writePrefetchFile(playbackConfig.prefetchConcurrency);

        // 已看剧集
        const watched = new Set<string>();
        for (const h of allHistory) {
          if (h.episodeId && h.episodeId !== m?.id && (h.progress > 60 || (h.duration > 0 && h.progress / h.duration >= 0.1))) {
            watched.add(h.episodeId);
          }
        }
        setWatchedEpisodes(watched);

        // 恢复进度：先解析出将播放的线路（显式线路 → 上次线路 → 该源首条），再按该线路自己的记忆续播
        const history = await provider.getWatchHistoryByEpisodeId(episode.mediaId, episode.id);
        // 播放线路恢复：显式线路 → 该集历史上次线路（progress>0）→ 该源首条 → index 0
        let pickIdx = 0;
        if (sources.length > 0) {
          let lineMatched = false;
          if (paramPlaySourceId) {
            const idx = sources.findIndex((s) => s.id === paramPlaySourceId);
            if (idx >= 0) {
              pickIdx = idx;
              lineMatched = true;
            }
          }
          if (!lineMatched && paramSourceId) {
            const idx = sources.findIndex((s) => s.sourceId === paramSourceId);
            if (idx >= 0) pickIdx = idx;
          }
          if (!lineMatched && history && history.progress > 0 && history.playSourceId) {
            const idx = sources.findIndex((s) => s.id === history.playSourceId);
            if (idx >= 0) pickIdx = idx;
          }
        }
        const currentLineId = sources[pickIdx]?.id ?? null;
        let seekTime = 0;
        // 优先按「定稿线路自己的记忆」续播（切线路后互不覆盖）；缺失时回退 watch_history 旧逻辑（兼容存量数据）
        if (m && currentLineId) {
          try {
            const lineHistory = await provider.getWatchLineProgressByPlaySource(episode.mediaId, episode.id, currentLineId);
            if (lineHistory && lineHistory.progress > 0) {
              const nearEnd = lineHistory.duration > 0 && lineHistory.progress >= lineHistory.duration - 5;
              if (!nearEnd) seekTime = lineHistory.progress;
            }
          } catch {}
        }
        if (seekTime === 0 && history && history.progress > 0) {
          const sameSource = !history.sourceId || history.sourceId === episode.sourceId;
          const sameLine = !history.playSourceId || history.playSourceId === currentLineId;
          const nearEnd = history.duration > 0 && history.progress >= history.duration - 5;
          if (sameSource && sameLine && !nearEnd) seekTime = history.progress;
        }
        setInitialCurrentTime(seekTime);
        pendingSeekRef.current = seekTime;
        skipEligibleRef.current = seekTime < 5 * 60;
        setSkipForwardVisible(false);
        skipForwardVisibleRef.current = false;
        skipDismissedRef.current = false;
        lastTimeRef.current = seekTime;
        setPlaySources(sources);
        if (sources.length > 0) {
          setVideoUrl(sources[pickIdx].url);
          setActivePlayIdx(pickIdx);
          setSelectedSourceId(sources[pickIdx].sourceId ?? null);
        } else {
          setError('无可播放的线路');
        }
      } catch {
        setError('加载失败');
      } finally {
        setIsLoading(false);
        setConfigLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [currentEpisodeId]);

  useEffect(() => {
    if (!mediaId) return;
    loadMediaDetail(mediaId);
    fetchMediaRating(mediaId);
    getProvider().isFavorite(mediaId).then(setIsFav).catch(() => {});
    checkDisliked(mediaId).then(setIsDisliked).catch(() => {});
  }, [mediaId]);

  useEffect(() => {
    if (episodes.length === 0) return;
    const durationService = new VideoDurationService();
    const provider = getProvider();
    const CONCURRENCY_LIMIT = 8;

    const missing = episodes.filter((ep: Episode) => !ep.duration);
    if (missing.length === 0) return;

    const fetchDuration = async (ep: Episode) => {
      try {
        const srcs = await provider.getPlaySourcesByEpisodeId(ep.id);
        const m3u8Source = srcs.find(s => s.url.endsWith('.m3u8') || s.url.toLowerCase().includes('m3u8'));
        if (m3u8Source) {
          const duration = await durationService.getDurationFromM3U8(m3u8Source.url);
          if (typeof duration === 'number' && duration > 0) {
            await provider.updateEpisodeDuration(ep.id, duration);
          }
          setEpisodeDurations(prev => ({ ...prev, [ep.id]: duration }));
        }
      } catch {
        setEpisodeDurations(prev => ({ ...prev, [ep.id]: null }));
      }
    };

    const runInBatches = async () => {
      for (let i = 0; i < missing.length; i += CONCURRENCY_LIMIT) {
        const batch = missing.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.all(batch.map(fetchDuration));
      }
    };

    runInBatches();
  }, [episodes]);

  const handleFav = async () => {
    if (!mediaId) return;
    const result = await getProvider().toggleFavorite(mediaId);
    setIsFav(result);
    getStore().getState().scheduleRecommendationRecompute();
  };

  const handleDislike = async () => {
    if (!mediaId) return;
    const result = await toggleDislike(mediaId);
    setIsDisliked(result);
    getStore().getState().scheduleRecommendationRecompute();
  };

  const openHideModal = () => {
    if (!media) return;
    setSelectedHideGenres([]);
    setHideModalVisible(true);
  };

  const toggleHideGenre = (g: string) => {
    setSelectedHideGenres(prev =>
      prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]
    );
  };

  const handleHide = async () => {
    if (selectedHideGenres.length === 0 || hiding) return;
    setHiding(true);
    try {
      const result = await hideMediaByGenres(selectedHideGenres);
      clearCategoryFilterCache();
      setHideModalVisible(false);
      Alert.alert('已隐藏', `已隐藏 ${result.hidden} 个「${selectedHideGenres.join('/')}」类视频`);
    } catch (err: any) {
      setHideModalVisible(false);
      Alert.alert('错误', err.message || '隐藏失败');
    } finally {
      setHiding(false);
    }
  };

  // 功能6: 进度保存节流 (10s + 接近片尾)
  const handleTimeUpdate = (currentTime: number, duration: number) => {
    if (duration > 0 && mediaId) {
      const now = Date.now();
      const nearEnd = Math.floor(currentTime) >= duration - 2;
      if (now - lastSaveTime >= 10000 || nearEnd) {
        saveWatchProgress(
          mediaId,
          currentEpisodeId,
          Math.floor(currentTime),
          Math.floor(duration),
          selectedSourceId ?? null,
          playSources[activePlayIdx]?.id ?? null,
        );
        setLastSaveTime(now);
        getStore().getState().scheduleRecommendationRecompute();
      }
    }
  };

  const videoRef = useRef<VideoView>(null);
  const playerRef = useRef<any>(null);

  // iOS: 经 expo-video-cache 本地代理改写 URL，使 HLS 分片走 N 并发下载
  // 用 VideoSource 对象显式控制 useCaching：iOS 走代理（代理自带缓存）故 false；Android 用 expo-video 缓存故 true
  const effectiveVideoUrl = useMemo(() => {
    if (!videoUrl) return videoUrl;
    if (Platform.OS === 'ios' && VideoCache && videoCacheReady) {
      try {
        return { uri: VideoCache.convertUrl(videoUrl), useCaching: false } as any;
      } catch {
        return { uri: videoUrl, useCaching: false } as any;
      }
    }
    return { uri: videoUrl, useCaching: Platform.OS === 'android' } as any;
  }, [videoUrl, videoCacheReady]);

  // 播放器生命周期：不用 useVideoPlayer（其卸载时自动 release() 在 iOS 18 + SDK57 expo-video 下
  // 触发 SIGABRT 闪退，见 .trae/documents/ios_category_back_crash_plan.md）。
  // 改用 createVideoPlayer 手动管理：source 变化用 replace 复用同一实例；
  // 卸载时 pause() 停止播放 + 释放（iOS 规避崩溃的 release，Android 正常 release）。
  const player = useMemo(() => {
    const p = createVideoPlayer(effectiveVideoUrl as any);
    p.loop = false;
    playerRef.current = p;
    if (initialCurrentTime > 0) {
      p.currentTime = initialCurrentTime;
    }
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // source 变化（换集/换线路/初始就绪）时复用同一播放器替换内容
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !effectiveVideoUrl) return;
    try { p.replace(effectiveVideoUrl as any, true); } catch {}
  }, [effectiveVideoUrl]);

  // 卸载：先暂停（停止播放/声音），再视平台释放。
  // iOS 上 release() 本身即崩溃（fatal abort 无法 try/catch 拦截），故跳过以规避闪退；
  // Android 上 release 安全，正常释放。未调 release 的原生实例由 Hermes GC 按
  // expo-modules-core 机制最终回收（SDK57 行为，见 issue #47568）。
  useEffect(() => {
    return () => {
      const p = playerRef.current;
      try { p?.pause(); } catch {}
      if (Platform.OS !== 'ios') {
        try { p?.release(); } catch {}
      }
    };
  }, []);

  // 进入即自动播放：iOS 会拦截非静音自动播放，故先静音起播，真正开播后取消静音恢复声音
  // 同时监听 sourceLoad / readyToPlay 重试 play()，避免 play() 调用过早被忽略
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !videoUrl) return;
    let unmuted = false;
    const subs: { remove: () => void }[] = [];
    const unmute = () => {
      if (unmuted) return;
      unmuted = true;
      try { p.muted = false; } catch {}
    };
    const tryPlay = () => { try { p.play(); } catch {} };
    p.muted = true;
    try {
      subs.push(p.addListener('playingChange', (e: { isPlaying: boolean }) => { if (e.isPlaying) unmute(); }));
      subs.push(p.addListener('sourceLoad', tryPlay));
      subs.push(p.addListener('statusChange', (e: { status: string }) => { if (e.status === 'readyToPlay') tryPlay(); }));
    } catch {}
    tryPlay();
    const fallback = setTimeout(() => { unmute(); tryPlay(); }, 1500);
    return () => { clearTimeout(fallback); subs.forEach((s) => s.remove()); };
  }, [player, videoUrl]);

  // 续播 seek 可靠性：source 加载/就绪后再应用恢复位置（首播与切线路共用），避免一次性赋值被丢弃
  // pendingSeekRef 先清零再被新线路记忆覆盖，防止换源的瞬间把旧位置误写到新线路
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !videoUrl) return;
    let applied = false;
    const subs: { remove: () => void }[] = [];
    const applySeek = () => {
      if (applied) return;
      const seek = pendingSeekRef.current;
      if (seek > 0) {
        applied = true;
        try { p.currentTime = seek; } catch {}
      }
    };
    try {
      subs.push(p.addListener('sourceLoad', applySeek));
      subs.push(p.addListener('statusChange', (e: { status: string }) => { if (e.status === 'readyToPlay') applySeek(); }));
    } catch {}
    return () => subs.forEach((s) => s.remove());
  }, [player, videoUrl]);

  // 退出即保存：离开播放页 / 切后台 / 系统 PIP 时末次保存当前播放位置（双写到线路记忆）
  const flushCurrentProgress = useCallback(() => {
    const p = playerRef.current;
    if (!mediaId || !currentEpisodeId || !p) return;
    const dur = p.duration || 0;
    if (dur <= 0) return;
    saveWatchProgress(
      mediaId,
      currentEpisodeId,
      Math.floor(p.currentTime),
      Math.floor(dur),
      selectedSourceId ?? null,
      playSources[activePlayIdx]?.id ?? null,
    );
    getStore().getState().scheduleRecommendationRecompute();
  }, [mediaId, currentEpisodeId, selectedSourceId, playSources, activePlayIdx, saveWatchProgress]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') flushCurrentProgress();
    });
    return () => sub.remove();
  }, [flushCurrentProgress]);

  useEffect(() => {
    return () => flushCurrentProgress();
  }, [flushCurrentProgress]);

  // 功能12: 移动端 N 并发分片读取
  // iOS: expo-video-cache 本地代理拦截 HLS，以 N 并发下载分片（需为 expo-video-cache 打补丁暴露 maxConcurrency）
  // Android: 写文件供 expo-video DataSourceUtils 读取 maxRequestsPerHost=N（node_modules 补丁）
  const serverStartedRef = useRef(false);
  useEffect(() => {
    if (Platform.OS !== 'ios' || !VideoCache) {
      setVideoCacheReady(true);
      return;
    }
    // 配置加载后再启动；仅启动一次（运行时改 N 下次进入播放页生效，避免重复 startServer 抖动）
    if (!configLoaded || serverStartedRef.current) return;
    serverStartedRef.current = true;
    try {
      // 缓存上限固定 500MB，与 N 解耦；第 4 个参数为补丁后新增的并发上限
      VideoCache.startServer(9000, 500 * 1024 * 1024, false, prefetchConcurrency)
        .then(() => setVideoCacheReady(true))
        .catch(() => setVideoCacheReady(true));
    } catch {
      setVideoCacheReady(true);
    }
  }, [configLoaded, prefetchConcurrency]);

  // Android: N 变化（含运行时）时写文件供原生读取；首播已在配置加载时同步写过
  useEffect(() => {
    writePrefetchFile(prefetchConcurrency);
  }, [prefetchConcurrency]);

  // iOS: 离开播放页时停掉本地代理，释放 9000 端口，下次进入以最新 N 重启
  useEffect(() => {
    return () => {
      if (Platform.OS === 'ios' && VideoCache && typeof VideoCache.stopServer === 'function') {
        try { VideoCache.stopServer(); } catch {}
      }
    };
  }, []);

  // 配合并发：调大向前缓冲深度，让播放器向前调度 N 个分片去并发填充
  const forwardBufferSeconds = Math.max(20, prefetchConcurrency * 8);
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    try {
      p.bufferOptions = {
        preferredForwardBufferDuration: forwardBufferSeconds,
        waitsToMinimizeStalling: true,
      };
    } catch {}
  }, [player, forwardBufferSeconds]);

  // 功能13: 预读分片进度 - 轮询原生桥文件（segment_progress.json）渲染真实分片状态
  // 每次换源重建清单解析器；仅当开关开启且为 m3u8 时才轮询
  useEffect(() => {
    if (!showSegmentProgress || !videoUrl || !videoUrl.toLowerCase().includes('m3u8')) {
      setSegmentSnapshot(null);
      return;
    }
    if (!segmentBuilderRef.current) {
      segmentBuilderRef.current = createSegmentSnapshotBuilder(videoUrl);
    } else {
      segmentBuilderRef.current.url = videoUrl;
    }
    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      const p = playerRef.current;
      const currentTime = p?.currentTime ?? 0;
      try {
        const snap = await segmentBuilderRef.current?.snapshot(currentTime);
        if (!cancelled) setSegmentSnapshot(snap ?? null);
      } catch {
        // 忽略轮询异常，下一拍继续
      }
    }, 500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [player, videoUrl, showSegmentProgress]);

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

        // 主动向后拖动（currentTime 明显回落）：离开片尾隐藏下一集浮窗，并恢复快进浮窗可选性
        const backwardSeek = lastTimeRef.current - ct >= 3;
        lastTimeRef.current = ct;
        if (!canShow) {
          setOverlayVisible(false);
        }
        if (backwardSeek) {
          skipDismissedRef.current = false;
          skipEligibleRef.current = ct < 5 * 60;
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

  const handlePlaySourceChange = async (idx: number) => {
    const src = playSourcesRef.current[idx];
    if (!src) return;
    // 切换前把当前线路的真实进度落库（返回该线路时从此处恢复）
    const p = playerRef.current;
    if (mediaId && currentEpisodeId && p && (p.duration || 0) > 0) {
      saveWatchProgress(
        mediaId,
        currentEpisodeId,
        Math.floor(p.currentTime),
        Math.floor(p.duration),
        selectedSourceId ?? null,
        playSourcesRef.current[activePlayIdx]?.id ?? null,
      );
    }
    pendingSeekRef.current = 0;
    setActivePlayIdx(idx);
    setSelectedSourceId(src.sourceId ?? null);
    setVideoUrl(src.url);
    setIsLoading(true);
    setError(null);
    // 切换到目标线路：从该线路自己的记忆续播（无记忆从头）
    let seek = 0;
    try {
      if (mediaId && currentEpisodeId) {
        const provider = getProvider();
        const lineHistory = await provider.getWatchLineProgressByPlaySource(mediaId, currentEpisodeId, src.id);
        if (lineHistory && lineHistory.progress > 0) {
          const nearEnd = lineHistory.duration > 0 && lineHistory.progress >= lineHistory.duration - 5;
          if (!nearEnd) seek = lineHistory.progress;
        }
      }
    } catch {}
    pendingSeekRef.current = seek;
    setInitialCurrentTime(seek);
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

  const handleVoiceControl = () => {
    setVoiceControlVisible(true);
  };

  const handleVoiceControlClose = () => {
    setVoiceControlVisible(false);
  };

  // 功能11: 源失败自动换源（对齐桌面 handleSourceFail：有剩余线路 1.5s 切下一线；
  // 全部失败 2s 循环回第 0 条重试，不再弹「所有播放线路均失败」）
  const autoRetryRef = useRef({ activePlayIdx, change: handlePlaySourceChange });
  autoRetryRef.current = { activePlayIdx, change: handlePlaySourceChange };
  const pendingFailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!player) return;
    const sub = player.addListener('statusChange', (e: { status: string }) => {
      if (e.status !== 'error') return;
      if (pendingFailTimerRef.current) return;
      const { activePlayIdx: idx, change } = autoRetryRef.current;
      const srcCount = playSourcesRef.current.length;
      const nextIdx = idx + 1;
      const targetIdx = nextIdx < srcCount ? nextIdx : 0;
      const delay = nextIdx < srcCount ? 1500 : 2000;
      console.warn(
        `[PlayScreen] 线路失败 autoRetry idx=${idx} srcCount=${srcCount} -> target=${targetIdx} in ${delay}ms`,
      );
      pendingFailTimerRef.current = setTimeout(() => {
        pendingFailTimerRef.current = null;
        change(targetIdx);
      }, delay);
    });
    return () => {
      sub.remove();
      if (pendingFailTimerRef.current) clearTimeout(pendingFailTimerRef.current);
      pendingFailTimerRef.current = null;
    };
  }, [player]);

  // 功能10: 播放设置菜单（倍速/清晰度/字幕）
  const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const [videoTracks, setVideoTracks] = useState<any[]>([]);
  const [currentVideoTrackId, setCurrentVideoTrackId] = useState<string | null>(null);
  const [subtitleTracks, setSubtitleTracks] = useState<any[]>([]);
  const [currentSubtitleId, setCurrentSubtitleId] = useState<string | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState(1);

  const refreshTracks = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    try {
      setVideoTracks(p.availableVideoTracks || []);
      setCurrentVideoTrackId((p as any).videoTrack?.id ?? null);
      setSubtitleTracks(p.availableSubtitleTracks || []);
      setCurrentSubtitleId(p.subtitleTrack?.id ?? null);
      setCurrentSpeed(p.playbackRate ?? 1);
    } catch {}
  }, []);

  useEffect(() => {
    if (!settingsVisible) return;
    refreshTracks();
    const id = setInterval(refreshTracks, 1000);
    return () => clearInterval(id);
  }, [settingsVisible, refreshTracks]);

  const handleSpeedChange = (rate: number) => {
    const p = playerRef.current;
    if (p) { (p as any).playbackRate = rate; }
    setCurrentSpeed(rate);
  };

  const handleQualityChange = (trackId: string) => {
    const p = playerRef.current;
    if (!p) return;
    const track = (p.availableVideoTracks || []).find((t: any) => t.id === trackId);
    if (track) { (p as any).videoTrack = track; setCurrentVideoTrackId(trackId); }
  };

  const handleSubtitleChange = (trackId: string | null) => {
    const p = playerRef.current;
    if (!p) return;
    if (trackId === null) { (p as any).subtitleTrack = null; setCurrentSubtitleId(null); return; }
    const track = (p.availableSubtitleTracks || []).find((t: any) => t.id === trackId);
    if (track) { (p as any).subtitleTrack = track; setCurrentSubtitleId(trackId); }
  };

  const handlePictureInPicture = () => {
    try { videoRef.current?.startPictureInPicture(); } catch {}
  };

  // 功能13: 显示预读分片进度开关（持久化到 playbackConfig.showSegmentProgress）
  const handleToggleSegmentProgress = async (next: boolean) => {
    setShowSegmentProgress(next);
    try {
      const configService = new SystemConfigService(getProvider());
      await configService.setPlaybackConfig({ showSegmentProgress: next });
    } catch {}
  };

  // 注册语音命令处理器
  useEffect(() => {
    if (!voiceControl) return;

    const voiceControlConfig = voiceControl.getConfig();
    if (!voiceControlConfig.enabled) return;

    // 注册播放控制命令
    voiceControl.registerCommands([
      {
        id: 'pause',
        name: '暂停',
        description: '暂停播放',
        aliases: ['暂停', '停一下', '停止播放', '停'],
        category: 'playback',
        execute: async () => {
          if (playerRef.current) {
            playerRef.current.pause();
          }
        },
      },
      {
        id: 'play',
        name: '播放',
        description: '继续播放',
        aliases: ['播放', '继续', '开始播放', '继续播放'],
        category: 'playback',
        execute: async () => {
          if (playerRef.current) {
            playerRef.current.play();
          }
        },
      },
      {
        id: 'fast_forward',
        name: '快进',
        description: '快进指定时间',
        aliases: ['快进', '前进', '往前'],
        category: 'playback',
        parameters: [
          {
            name: 'seconds',
            type: 'number',
            required: false,
            defaultValue: 30,
            description: '快进秒数',
          },
        ],
        execute: async (params) => {
          const seconds = params?.seconds || 30;
          handleSkipForward(seconds);
        },
      },
      {
        id: 'rewind',
        name: '快退',
        description: '快退指定时间',
        aliases: ['快退', '后退', '往回'],
        category: 'playback',
        parameters: [
          {
            name: 'seconds',
            type: 'number',
            required: false,
            defaultValue: 30,
            description: '快退秒数',
          },
        ],
        execute: async (params) => {
          const seconds = params?.seconds || 30;
          if (playerRef.current) {
            const p = playerRef.current;
            p.currentTime = Math.max(p.currentTime - seconds, 0);
          }
        },
      },
      {
        id: 'volume_up',
        name: '音量增加',
        description: '增加音量',
        aliases: ['音量增加', '大声点', '提高音量', '大声'],
        category: 'playback',
        execute: async () => {
          if (playerRef.current) {
            const p = playerRef.current;
            p.volume = Math.min(p.volume + 0.1, 1.0);
          }
        },
      },
      {
        id: 'volume_down',
        name: '音量减少',
        description: '减少音量',
        aliases: ['音量减少', '小声点', '降低音量', '小声'],
        category: 'playback',
        execute: async () => {
          if (playerRef.current) {
            const p = playerRef.current;
            p.volume = Math.max(p.volume - 0.1, 0);
          }
        },
      },
      {
        id: 'mute',
        name: '静音',
        description: '静音',
        aliases: ['静音', '关闭声音', '取消静音'],
        category: 'playback',
        execute: async () => {
          if (playerRef.current) {
            const p = playerRef.current;
            p.muted = !p.muted;
          }
        },
      },
      {
        id: 'fullscreen',
        name: '全屏',
        description: '切换全屏',
        aliases: ['全屏', '全屏幕', '切换全屏'],
        category: 'playback',
        execute: async () => {
          if (isLandscapeRef.current) {
            videoRef.current?.exitFullscreen();
          } else {
            videoRef.current?.enterFullscreen();
          }
        },
      },
      {
        id: 'next_episode',
        name: '下一集',
        description: '播放下一集',
        aliases: ['下一集', '下一个', '下一集播放'],
        category: 'playback',
        execute: async () => {
          if (nextEpisode) {
            handleNextEpisode();
          }
        },
      },
      {
        id: 'previous_episode',
        name: '上一集',
        description: '播放上一集',
        aliases: ['上一集', '上一个', '上一集播放'],
        category: 'playback',
        execute: async () => {
          const idx = filteredEpisodes.findIndex((ep: Episode) => ep.id === currentEpisodeId);
          if (idx > 0) {
            handleEpisodePress(filteredEpisodes[idx - 1]);
          }
        },
      },
    ]);

    return () => {
      // 清理命令
    };
  }, [voiceControl, playerRef, nextEpisode, filteredEpisodes, currentEpisodeId]);

  // 功能9: 退出播放页时断开投屏
  useEffect(() => {
    return () => {
      if (useCastStore.getState().isCasting) {
        castManager.disconnect();
      }
    };
  }, []);

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

  const handleEpisodePress = async (ep: Episode) => {
    if (isCasting && castManager.castDevice) {
      const currentTime = player?.currentTime || 0;
      const duration = player?.duration || 0;
      if (duration > 0) {
        getStore().getState().saveWatchProgress(
          mediaId!,
          currentEpisodeId,
          currentTime,
          duration,
          selectedSourceId || null,
          playSources[activePlayIdx]?.id ?? null,
        );
      }
      try {
        await castManager.disconnect();
      } catch {
        // ignore
      }
    }
    setCurrentEpisodeId(ep.id);
    setCurrentTitle(
      (media?.title || paramTitle?.replace(/·.*$/, '').trim() || '') + (ep.title ? ` · ${ep.title}` : ` · 第${ep.episodeNumber}集`)
    );
  };

  const nextEpisodeTitle = nextEpisode
    ? `下一集${nextEpisode.title ? ` · ${nextEpisode.title}` : ''}`
    : '';

  return (
    <>
    <BlurredBackground imageUrl={bgImageUrl}>
    <View style={styles.container}>
      <View style={styles.header}>
        <Button variant="icon" size="sm" style={styles.backButton} onPress={() => {
          if (isCasting) {
            castManager.disconnect();
          }
          navigation.goBack();
        }}>
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
            allowsPictureInPicture={isPictureInPictureSupported()}
            fullscreenOptions={{ enable: true, orientation: 'landscape' }}
            onFullscreenEnter={async () => {
              isLandscapeRef.current = true;
              try { await ScreenOrientation.unlockAsync(); } catch {}
            }}
            onFullscreenExit={async () => {
              isLandscapeRef.current = false;
              try { await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT); } catch {}
            }}
          />
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
        {showSegmentProgress && videoUrl && !error && (
          <SegmentProgress
            snapshot={segmentSnapshot}
            onClose={() => setShowSegmentProgress(false)}
          />
        )}
      </View>

      {videoUrl && !error && (
        <View style={styles.toolbar}>
          <TouchableOpacity
            style={styles.toolbarButton}
            activeOpacity={0.7}
            onPress={() => setSettingsVisible(true)}
          >
            <Settings size={18} color="#fff" />
          </TouchableOpacity>
          {voiceControl?.getConfig().enabled && (
            <TouchableOpacity
              style={styles.toolbarButton}
              activeOpacity={0.7}
              onPress={handleVoiceControl}
            >
              <Mic size={18} color="#fff" />
            </TouchableOpacity>
          )}
          {isPictureInPictureSupported() && (
            <TouchableOpacity
              style={styles.toolbarButton}
              activeOpacity={0.7}
              onPress={handlePictureInPicture}
            >
              <PictureInPicture2 size={18} color="#fff" />
            </TouchableOpacity>
          )}
          <CastButton
            onDeviceSelect={handleCastDeviceSelect}
            onSearch={castManager.searchDevices}
            style={styles.toolbarButton}
          />
        </View>
      )}

      <Modal visible={settingsVisible} transparent animationType="slide" onRequestClose={() => setSettingsVisible(false)}>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
          activeOpacity={1}
          onPress={() => setSettingsVisible(false)}
        >
          <TouchableOpacity
            style={[styles.settingsSheet, { backgroundColor: cardBg }]}
            activeOpacity={1}
            onPress={() => {}}
          >
            <Text style={[styles.settingsTitle, { color: colors.text }]}>播放设置</Text>

            <Text style={[styles.settingsLabel, { color: colors.mutedForeground }]}>倍速</Text>
            <View style={styles.settingsRow}>
              {SPEED_OPTIONS.map((rate) => (
                <Button
                  key={rate}
                  variant="secondary"
                  size="sm"
                  active={Math.abs(currentSpeed - rate) < 0.01}
                  style={styles.settingsChip}
                  onPress={() => handleSpeedChange(rate)}
                >
                  {rate}x
                </Button>
              ))}
            </View>

            {videoTracks.length > 1 && (
              <>
                <Text style={[styles.settingsLabel, { color: colors.mutedForeground }]}>清晰度</Text>
                <View style={styles.settingsRow}>
                  {videoTracks.map((t: any) => {
                    const label = t.height ? `${t.height}p` : (t.displayName || t.name || '未知');
                    return (
                      <Button
                        key={t.id}
                        variant="secondary"
                        size="sm"
                        active={currentVideoTrackId === t.id}
                        style={styles.settingsChip}
                        onPress={() => handleQualityChange(t.id)}
                      >
                        {label}
                      </Button>
                    );
                  })}
                </View>
              </>
            )}

            {subtitleTracks.length > 0 && (
              <>
                <Text style={[styles.settingsLabel, { color: colors.mutedForeground }]}>字幕</Text>
                <View style={styles.settingsRow}>
                  <Button
                    variant="secondary"
                    size="sm"
                    active={currentSubtitleId === null}
                    style={styles.settingsChip}
                    onPress={() => handleSubtitleChange(null)}
                  >
                    关闭
                  </Button>
                  {subtitleTracks.map((t: any) => {
                    const label = t.label || t.language || t.name || '字幕';
                    return (
                      <Button
                        key={t.id}
                        variant="secondary"
                        size="sm"
                        active={currentSubtitleId === t.id}
                        style={styles.settingsChip}
                        onPress={() => handleSubtitleChange(t.id)}
                      >
                        {label}
                      </Button>
                    );
                  })}
                </View>
              </>
            )}

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={[styles.settingsLabel, { color: colors.text, marginBottom: 0 }]}>显示预读分片进度</Text>
              <Switch
                value={showSegmentProgress}
                onValueChange={handleToggleSegmentProgress}
                trackColor={{ false: colors.swiftTrack, true: colors.swiftActiveTrack }}
                thumbColor={showSegmentProgress ? colors.swiftThumb : colors.disabledForeground}
              />
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {isCasting && (
        <CastRemoteControl
          onPause={castManager.pause}
          onResume={castManager.play}
          onStop={castManager.stop}
          onSeek={castManager.seek}
          onVolume={castManager.setVolume}
        />
      )}

      <ScrollView style={styles.body}>
        {/* 影片信息 */}
        {media && (() => {
          const epName = currentTitle?.includes('·')
            ? currentTitle.split('·').slice(1).join('·').trim()
            : '';
          return (
            <View style={styles.mediaInfo}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={[styles.mediaTitle, { marginBottom: 0 }]} numberOfLines={1}>{media.title}</Text>
                {media.updatedAt && (
                  <Text style={{ fontSize: sf(12), color: colors.mutedForeground }}>更新时间：{new Date(media.updatedAt).toISOString().split('T')[0]}</Text>
                )}
              </View>
              {epName ? (
                <Text style={[styles.mediaSubtitle, { marginBottom: 0 }]} numberOfLines={1}>{epName}</Text>
              ) : null}
              <Text style={styles.mediaSubtitle}>
                {media.year}{media.area ? ` · ${media.area}` : ''}
              </Text>
              {media.alias && (
                <Text style={styles.mediaSubtitle}>又名：{media.alias}</Text>
              )}
            </View>
          );
        })()}

        {media && (() => {
          const ratingMedia = currentMedia && currentMedia.id === mediaId ? currentMedia : media;
          return (
            <View>
              <View style={styles.favGroup}>
                <Button
                  variant="secondary"
                  size="sm"
                  style={styles.favButton}
                  leftIcon={<EyeOff size={16} color={colors.textSecondary} />}
                  onPress={openHideModal}
                >
                  隐藏
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
                <Button
                  variant="secondary"
                  size="sm"
                  active={isDisliked}
                  style={styles.favButton}
                  leftIcon={<ThumbsDown size={16} color={isDisliked ? colors.error : colors.textSecondary} />}
                  onPress={handleDislike}
                >
                  {isDisliked ? '已不感兴趣' : '不感兴趣'}
                </Button>
              </View>
              {ratingMedia.rating != null && ratingMedia.rating > 0 ? (
                <View style={styles.ratingRow}>
                  <Star size={14} color={colors.warning} fill={colors.warning} />
                  <Text style={styles.ratingValue}>{ratingMedia.rating.toFixed(1)}</Text>
                  {ratingMedia.ratingCount != null && ratingMedia.ratingCount > 0 && (
                    <Text style={styles.ratingCount}>
                      {ratingMedia.ratingCount >= 10000 ? `${(ratingMedia.ratingCount / 10000).toFixed(1)}万人` : `${ratingMedia.ratingCount}人`}评分 (豆瓣)
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
                {(media.genres.length > 0 ? media.genres : [UNCATEGORIZED_GENRE]).map((g: string, i: number) => (
                  <TouchableOpacity
                    key={i}
                    activeOpacity={0.7}
                    onPress={() => {
                      const screen = typeScreenMap[media.type];
                      if (screen) navigation.navigate(screen, { subType: g });
                    }}
                  >
                    <Text style={styles.genre}>{g}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          );
        })()}

        {media && (media.directors.length > 0 || media.actors.length > 0) && (() => {
          const castText =
            `${media.directors.length > 0 ? `导演：${media.directors.join('、')}` : ''}` +
            `${media.actors.length > 0 ? `${media.directors.length > 0 ? '\n' : ''}主演：${media.actors.join('、')}` : ''}`;
          return (
            <View style={styles.section}>
              <Text
                style={{ position: 'absolute', opacity: 0, height: 0 }}
                onTextLayout={(e) => setCastOverflow(e.nativeEvent.lines.length > 2)}
              >
                {castText}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                <Text
                  style={{ flex: 1, fontSize: sf(13), color: colors.text, lineHeight: sf(20) }}
                  numberOfLines={castExpanded ? undefined : 2}
                >
                  {castText}
                </Text>
                {castOverflow && (
                  <TouchableOpacity onPress={() => setCastExpanded((v) => !v)} style={{ marginLeft: 8 }}>
                    <Text style={{ fontSize: sf(13), color: colors.mutedForeground }}>{castExpanded ? '收起' : '展开'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })()}

        {media && media.description && (
          <View style={styles.section}>
            <Text
              style={{ position: 'absolute', opacity: 0, height: 0 }}
              onTextLayout={(e) => setPlotOverflow(e.nativeEvent.lines.length > 1)}
            >
              {media.description}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text
                style={{ flex: 1, fontSize: sf(13), color: colors.text, lineHeight: sf(20) }}
                numberOfLines={plotExpanded ? undefined : 1}
              >
                {media.description}
              </Text>
              {plotOverflow && (
                <TouchableOpacity onPress={() => setPlotExpanded((v) => !v)} style={{ marginLeft: 8 }}>
                  <Text style={{ fontSize: sf(13), color: colors.mutedForeground }}>{plotExpanded ? '收起' : '展开'}</Text>
                </TouchableOpacity>
              )}
            </View>
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
                    const dur = episodeDurations[ep.id] ?? ep.duration;
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
                        {typeof dur === 'number' && dur > 0 && (
                          <Text style={styles.episodeDuration}>
                            {Math.floor(dur / 60)}:{String(dur % 60).padStart(2, '0')}
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
      </ScrollView>
    </View>
    </BlurredBackground>
    <Modal
      visible={hideModalVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setHideModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
          <Text style={styles.modalTitle}>隐藏</Text>
          <Text style={styles.modalDesc}>选择要隐藏的子类型，隐藏后此类视频将不再显示。</Text>
          <View style={styles.modalGenres}>
            {(media && media.genres.length === 0 ? [UNCATEGORIZED_GENRE] : media ? media.genres : []).map((g: string) => {
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
            <Button variant="secondary" size="sm" style={styles.modalButton} onPress={() => setHideModalVisible(false)}>
              取消
            </Button>
            <Button variant="primary" size="sm" style={styles.modalButton} disabled={hiding || selectedHideGenres.length === 0} onPress={handleHide}>
              {hiding ? '隐藏中...' : `隐藏 (${selectedHideGenres.length})`}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
    <VoiceControlOverlay
      visible={voiceControlVisible}
      onClose={handleVoiceControlClose}
    />
    </>
  );
}
