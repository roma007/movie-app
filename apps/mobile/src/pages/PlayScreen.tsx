import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Alert, Modal, Platform, Switch, AppState, BackHandler, Animated, useWindowDimensions, PanResponder } from 'react-native';
import { VideoView, createVideoPlayer, isPictureInPictureSupported } from 'expo-video';
import { StatusBar } from 'expo-status-bar';
import { Paths, File } from 'expo-file-system';
// 可选原生依赖：expo-video-cache（iOS 本地代理，将 HLS 分片改为 N 并发下载）。
// 仅在用户构建环境安装；此处用 try/require 守卫，未安装时自动降级为直连。
// @ts-ignore - optional native dependency, resolvable after pnpm install in build env
const VideoCache: any = (() => { try { return require('expo-video-cache'); } catch { return null; } })();
import { getProvider } from '../init';
import { useAppStore, getStore } from '../useAppStore';
import { ArrowLeft, EyeOff, Heart, ThumbsDown, Star, Settings, PictureInPicture2, Maximize, ChevronUp, ChevronDown, ChevronRight, Play, Pause, X } from 'lucide-react-native';
import { SystemConfigService, UNCATEGORIZED_GENRE, VideoDurationService, resolveDefaultPlayTarget, AdFloatScheduler, BUILTIN_AD_FLOAT_CONFIG, type AdFloatItem } from '@movie-app/core';
import { clearCategoryFilterCache } from '../categoryFilterCache';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import { NextEpisodeOverlay } from '../components/NextEpisodeOverlay';
import { SkipForwardOverlay } from '../components/SkipForwardOverlay';
import { CastButton } from '../components/cast/CastButton';
import { CastRemoteControl } from '../components/cast/CastRemoteControl';
import { useCastManager } from '../hooks/useCastManager';
import { useCastStore } from '../stores/castStore';
import BlurredBackground from '../components/BlurredBackground';
import { Button } from '../components/ui/Button';
import type { PlaySource, VideoSource, Episode, Media } from '@movie-app/core';
import type { PlayContext } from '../utils/openMediaPlay';
import { radius } from '../themes/radiusTokens';
import { SegmentProgress } from '../components/SegmentProgress';
import { createSegmentSnapshotBuilder, type SegmentProgressSnapshot } from '../services/segmentProgress';
import { FullscreenControlBar } from '../components/FullscreenControlBar';
import { AdFloatOverlay } from '../components/AdFloatOverlay';
import PosterImage from '../components/PosterImage';

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

// 沉浸信息卡布局常量：右侧竖排功能键列宽（toolbarButtonRound 60）、卡片与列间距
const TOOLBAR_COL_WIDTH = 60;
const VERTICAL_CARD_RIGHT_GAP = 12;
// 引导标签让位量：初始时每个按钮行向右多留出该宽度给「图标+文字」标签；
// 统一固定值（≥最长文字宽+间距），保证所有按钮图标竖排对齐，不随各按钮文字字数参差
const TOOLBAR_LABEL_EXTRA = 84;

// 红果式长按手势：热区比例与判定参数（移动端 PlayScreen）
const LONG_PRESS_MS = 400; // 长按触发时长（ms）
const ZONE_LEFT_R = 0.18; // 左侧快进条：< 屏宽 18%
const ZONE_RIGHT_R = 0.68; // 右侧快进条：> 屏宽 68%
const LOCK_GESTURE_DY = 24; // 上滑锁定 / 下滑退出位移阈值
const DOUBLE_TAP_MS = 280; // 双击判定窗口：两次轻点间隔 ≤ 280ms 视为双击（收藏切换）

export default function PlayScreen({ route, navigation }: Props) {
  const { episodeId, mediaId: paramMediaId, sourceId: paramSourceId, playSourceId: paramPlaySourceId, title: paramTitle, playContext: paramPlayContext } = route.params;
  const {
    saveWatchProgress, episodes, episodesLoading, seasons, episodeSources, seriesMedia,
    loadEpisodes, loadSeasons, loadEpisodeSources, loadSeriesMedia,
    currentMedia, isRatingLoading, toggleDislike, isDisliked: checkDisliked, hideMediaByGenres, fetchMediaRating, loadMediaDetail,
  } = useAppStore();

  const [mediaId, setMediaId] = useState<string | null>(paramMediaId || null);
  const [currentEpisodeId, setCurrentEpisodeId] = useState(episodeId);
  const [currentTitle, setCurrentTitle] = useState(paramTitle || '');
  // 播放来源上下文：决定上下滑切换行为（list/search/recommend 按序，null 视为 random 随机）
  const [playContext, setPlayContext] = useState<PlayContext | null>(paramPlayContext ?? null);
  const playContextRef = useRef(playContext);
  playContextRef.current = playContext;
  // 跟手滑动位移：主界面卡片组（沉浸）与全屏覆盖层各一套，互不冲突
  const animatedY = useRef(new Animated.Value(0)).current;
  const fsAnimatedY = useRef(new Animated.Value(0)).current;
  const [currentSeason, setCurrentSeason] = useState(1);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(paramSourceId || null);
  const [playSources, setPlaySources] = useState<PlaySource[]>([]);
  const playSourcesRef = useRef<PlaySource[]>([]);
  playSourcesRef.current = playSources;
  // 卸载期专用 ref：release effect 仅挂载一次（[] 依赖），cleanup 需读「最新」集/线路 state 存进度，
  // 避免闭包取到第一帧的陈旧值导致存错集/线路
  const currentEpisodeIdRef = useRef(currentEpisodeId);
  currentEpisodeIdRef.current = currentEpisodeId;
  const currentMediaIdRef = useRef<string | null>(mediaId);
  currentMediaIdRef.current = mediaId;
  const selectedSourceIdRef = useRef<string | null>(selectedSourceId);
  selectedSourceIdRef.current = selectedSourceId;
  const [plotExpanded, setPlotExpanded] = useState(false);
  const [plotOverflow, setPlotOverflow] = useState(false);
  const [castExpanded, setCastExpanded] = useState(false);
  const [castOverflow, setCastOverflow] = useState(false);
  // 沉浸信息卡：简介/导演演员伸缩栏点击后底部滑出面板
  const [introSheetVisible, setIntroSheetVisible] = useState(false);
  const [castSheetVisible, setCastSheetVisible] = useState(false);
  const [isFav, setIsFav] = useState(false);
  const [isDisliked, setIsDisliked] = useState(false);
  const [hideModalVisible, setHideModalVisible] = useState(false);
  const [episodesSheetVisible, setEpisodesSheetVisible] = useState(false);
  const [playStat, setPlayStat] = useState({ playing: true, cur: 0, dur: 0 });
  // 进度条拖动 seek：null 表示未拖动；拖动中存 0~1 比例，松开后 seek 并复位
  const [dragProgress, setDragProgress] = useState<number | null>(null);
  const progressTrackWidthRef = useRef(0);
  const [selectedHideGenres, setSelectedHideGenres] = useState<string[]>([]);
  const [hiding, setHiding] = useState(false);
  const [activePlayIdx, setActivePlayIdx] = useState(0);
  const activePlayIdxRef = useRef(activePlayIdx);
  const [selectedLang, setSelectedLang] = useState<string | null>(null);
  const [tvLangInfo, setTvLangInfo] = useState<{ language: string; episodeId: string; sourceId: string }[]>([]);
  activePlayIdxRef.current = activePlayIdx;
  const [videoUrl, setVideoUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  // 高频真实播放态（playingChange 驱动）：渲染层强不变量「在播即不显示转圈」，兜底 isLoading 残留
  const [isActuallyPlaying, setIsActuallyPlaying] = useState(false);
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
  // 红果式长按手势状态
  const [locked2x, setLocked2x] = useState(false);
  const [pressHint, setPressHint] = useState<'ff' | 'lock' | 'exit' | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  // 播放设置内联底部弹层动画（替换 RN Modal：iOS 全屏方向锁定下 present 会因 supportedInterfaceOrientations
  // 混合方向冲突闪退，改页面内覆盖层；Android/iOS 行为一致）
  const settingsAnim = useRef(new Animated.Value(0)).current;
  const settingsSlide = settingsAnim.interpolate({ inputRange: [0, 1], outputRange: [300, 0] });
  useEffect(() => {
    if (!settingsVisible) return;
    settingsAnim.setValue(0);
    Animated.timing(settingsAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [settingsVisible, settingsAnim]);
  // Android 硬件返回：设置面板打开时优先关闭面板（替代原 Modal onRequestClose）
  useEffect(() => {
    if (!settingsVisible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSettingsVisible(false);
      return true;
    });
    return () => sub.remove();
  }, [settingsVisible]);

  // 功能: 右侧竖排按钮栏「图标+文字」引导动画——进页显示各按钮名（文字在图标右侧），5 秒后文字淡出、
  // 图标缓慢右移到当前版纯图标位置（right:8 右缘）；单一 Animated.Value 0→1 驱动，所有按钮统一让位量保证图标竖排对齐
  const toolbarHintAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const t = setTimeout(() => {
      Animated.timing(toolbarHintAnim, { toValue: 1, duration: 1200, useNativeDriver: true }).start();
    }, 5000);
    return () => clearTimeout(t);
  }, [toolbarHintAnim]);

  // 自绘全屏（应用内全屏，对齐桌面端全屏浮窗/设置）：appFullscreen 驱动全屏覆盖层渲染与方向锁定
  const [appFullscreen, setAppFullscreen] = useState(false);
  const appFullscreenRef = useRef(false);
  appFullscreenRef.current = appFullscreen;
  // 全屏控制层显隐：进入后自动隐藏，tap 切换，进度用高频 timeUpdate（独立于 5s 粒度 playStat）
  const [fullscreenControlsVisible, setFullscreenControlsVisible] = useState(true);
  const [fsTime, setFsTime] = useState(0);
  const [fsDuration, setFsDuration] = useState(0);
  const [fsPlaying, setFsPlaying] = useState(false);
  const fsHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appFullVideoRef = useRef<VideoView>(null);

  // 功能2: 已看剧集
  const [watchedEpisodes, setWatchedEpisodes] = useState<Set<string>>(new Set());

  // 逐集真实时长探测
  const [episodeDurations, setEpisodeDurations] = useState<Record<string, number | null>>({});

  // 功能3: 影片信息
  const [media, setMedia] = useState<Media | null>(null);

  // 功能4: 下一集浮层
  const [overlayVisible, setOverlayVisible] = useState(false);
  const overlayDismissedRef = useRef(false);

  // 播放中横幅广告（配置驱动，随机出现一次，不打断播放）
  const [activeAd, setActiveAd] = useState<AdFloatItem | null>(null);
  const adSchedulerRef = useRef<AdFloatScheduler | null>(null);
  const lastAdShownRef = useRef<AdFloatItem | null>(null);
  const activeAdRef = useRef<AdFloatItem | null>(null);
  activeAdRef.current = activeAd;

  // 功能7: 从头播放快进浮窗
  const [skipForwardVisible, setSkipForwardVisible] = useState(false);
  const skipForwardVisibleRef = useRef(false);
  const skipDismissedRef = useRef(false);
  const skipEligibleRef = useRef(false);
  const lastTimeRef = useRef(0);

  // 待应用的恢复位置：source 真正就绪后再 seek，避免一次性赋值被丢弃
  const pendingSeekRef = useRef(0);

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
      const localPositionMs = playerRef.current ? (playerRef.current.currentTime || 0) * 1000 : 0;
      try { playerRef.current?.pause(); } catch {}
      await castManager.connectToDevice(
        { ...device, protocol: device.protocol as any, isConnected: false },
        videoUrl,
        currentTitle,
        player?.duration || 0,
        localPositionMs,
      );
      lastPushedCastUrlRef.current = videoUrl;
    } catch (e: any) {
      Alert.alert('投屏失败', e?.message || '连接投屏设备失败，请检查设备是否在线');
    }
  };

  const { isCasting } = useCastStore();

  // 功能6: 进度保存节流
  const [lastSaveTime, setLastSaveTime] = useState(0);

  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [episodeListSwitching, setEpisodeListSwitching] = useState(false);
  /** 当前播放视频的真实宽高比（width/height）。null=未探测，沿用默认 16:9；<1 视为竖屏。 */
  const [videoRatio, setVideoRatio] = useState<number | null>(null);
  /** 最近一次成功探测到的宽高比：换源/换集时 videoRatio 被清空（null），用此值保持沉浸布局不闪烁（不设状态避免重渲染） */
  const lastRatioRef = useRef<number | null>(null);

  useEffect(() => {
    if (!media?.posterUrl) {
      setBgImageUrl(null);
      return;
    }
    setBgImageUrl(media.posterUrl);
  }, [media]);

  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const surfaceBg = hexToRgba(colors.surface, cardOpacity / 100);
  const accentBg = hexToRgba(colors.cardAccent, cardOpacity / 100);
  const dimBg = hexToRgba(colors.cardDim, cardOpacity / 100);
  const sf = useScaledFontSize();

  // 播放器区块尺寸：宽度=屏宽。高度按真实视频宽高比自适应：
  // - 已探测到比例 → 高度=屏宽/ratio（竖屏 16:9 反之更矮/更高），封顶屏高；
  // - 未探测 → 沿用 16:9（屏宽×9/16），封顶屏高。
  // 超限时 VideoView contentFit="contain" 等比缩放并居中。
  const { width: screenW, height: screenH } = useWindowDimensions();
  const videoHeight = videoRatio && videoRatio > 0
    ? Math.min(screenW / videoRatio, screenH)
    : Math.min(screenW * 9 / 16, screenH);
  /** 竖屏（宽高比 < 1）判定：竖屏片全屏跟随竖屏，横屏片保持横屏（抖音/红果式）。
   *  探测未就绪/换源期间回退到最近一次已知比例，避免沉浸布局在换集/换源时瞬时闪烁。 */
  const effectiveRatio = videoRatio ?? lastRatioRef.current;
  const isVerticalVideo = effectiveRatio != null && effectiveRatio > 0 && effectiveRatio < 1;
  /** 红果式沉浸：进页即全屏沉浸（横竖屏一致），不再等待视频尺寸探测；探测仅用于 contentFit（竖屏 cover / 横屏 contain） */
  const isImmersive = videoUrl != null && !error;

  // ─── refs 同步最新 state 供 PanResponder（useMemo 依赖为空）读取 ───
  const videoUrlRef = useRef(videoUrl);
  videoUrlRef.current = videoUrl;
  const errorRef = useRef(error);
  errorRef.current = error;
  const isImmersiveRef = useRef(isImmersive);
  isImmersiveRef.current = isImmersive;
  const settingsVisibleRef = useRef(settingsVisible);
  settingsVisibleRef.current = settingsVisible;
  const overlayVisibleRef = useRef(overlayVisible);
  overlayVisibleRef.current = overlayVisible;
  const fullscreenControlsVisibleRef = useRef(fullscreenControlsVisible);
  fullscreenControlsVisibleRef.current = fullscreenControlsVisible;
  const episodesSheetVisibleRef = useRef(episodesSheetVisible);
  episodesSheetVisibleRef.current = episodesSheetVisible;
  const hideModalVisibleRef = useRef(hideModalVisible);
  hideModalVisibleRef.current = hideModalVisible;
  // 长按手势专用 ref
  const locked2xRef = useRef(false);
  const guideShownRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressRef = useRef<{
    zone: 'left' | 'right' | 'middle' | null;
    mode: 'main' | 'fullscreen';
    phase: 'tracking' | 'longpress' | 'swipe' | null;
  } | null>(null);
  // 双击收藏：首击入队单击延迟，280ms 内第二击到 → 取消单击改调 handleFav
  const doubleTapRef = useRef<{ ts: number; timer: ReturnType<typeof setTimeout> | null }>({ ts: 0, timer: null });

  const styles = useMemo(() => {
    return StyleSheet.create({
    container: { flex: 1 },
    // 播放器整体在屏幕垂直居中：上方留白 spacerTop(flex:1) 与 下方正文 body(flex:1) 上下等分，
    // 中间固定高度的播放器即位于屏幕正中
    spacerTop: { flex: 1 },
    // header 悬浮在播放器上层（半透明）
    header: {
      position: 'absolute',
      top: isImmersive ? 44 : (insets.top + 6),
      left: 0,
      right: 0,
      zIndex: 20,
      flexDirection: 'row',
      alignItems: 'center',
      padding: 15,
      backgroundColor: 'transparent',
    },
    backButton: { width: 42, height: 42, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { flex: 1, fontSize: sf(16), fontWeight: '600', color: '#fff', marginLeft: 8 },
    headerRight: { flexDirection: 'row', alignItems: 'center', padding: 4 },
    headerRightText: { fontSize: sf(13), color: '#fff' },
    videoContainer: { width: '100%', height: videoHeight, backgroundColor: colors.playerBg },
    video: { width: '100%', height: '100%' },
    // 应用内全屏时隐藏非全屏 VideoView（避免原 native 全屏 view 透出/重复渲染）
    videoHiddenInFullscreen: { opacity: 0 },
    // 红果式沉浸（竖屏视频）：播放器区域占满整屏（视频自带 contain 上下留窄黑边，观感贴近短剧沉浸页）
    videoContainerImm: { width: '100%', flex: 1, backgroundColor: colors.playerBg },
    // 沉浸态点击视频区 = 播放/暂停（替代已移除的中央圆形按钮，红果式惯例）
    videoTapLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5 },
    // 底部悬浮信息卡：红果式左下卡（非全宽），叠加在视频上（非弹窗，不受弹窗不透明度规则限制）。
    // 宽度自适应：左缘 15，右缘对齐右侧竖排功能键列左缘并留 VERTICAL_CARD_RIGHT_GAP 空隙
    verticalCard: {
      position: 'absolute',
      left: 15,
      right: 8 + TOOLBAR_COL_WIDTH + VERTICAL_CARD_RIGHT_GAP,
      bottom: insets.bottom + 76,
      zIndex: 15,
      backgroundColor: 'transparent',
      borderRadius: radius.lg,
      paddingTop: 2,
      paddingBottom: 4,
      paddingHorizontal: 12,
    },
    // 右侧竖排功能键列（现有 6 键：收藏/不感兴趣/隐藏/语音/画中画/投屏；竖屏视频时另含全屏键）——红果式：悬浮视频右侧、屏高 42% 起、距右缘 8
    toolbarVerticalCol: {
      position: 'absolute',
      right: 8,
      bottom: screenH * 0.12,
      zIndex: 16,
      flexDirection: 'column' as const,
      alignItems: 'flex-end',
      gap: 12,
    },
    // 每个按钮的「图标+文字」行：宽度固定 = 图标 + 统一让位量，右对齐贴 right:8，
    // 动画中整行右移让文字滑出屏外、图标落到右缘；图标仅平移不淡出
    toolbarRow: {
      width: TOOLBAR_COL_WIDTH + TOOLBAR_LABEL_EXTRA,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      position: 'relative' as const,
    },
    // 按钮名引导标签（不占布局、浮动于图标右侧，5 秒后随动画淡出）
    toolbarLabel: {
      position: 'absolute' as const,
      left: TOOLBAR_COL_WIDTH + 8,
      fontSize: sf(13),
      fontWeight: '600',
      color: '#fff',
      backgroundColor: 'rgba(0,0,0,0.5)',
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    // 信息区 wrapper：内容自适应高度（不设上限）；overflow hidden 仅防圆角处文本溢出
    verticalInfoWrap: { minWidth: 0, overflow: 'hidden' as const },
    verticalInfo: { flexGrow: 0 },
    verticalTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
    verticalTitle: { fontSize: sf(15), fontWeight: '700', color: '#fff' },
    verticalEpLabel: {
      fontSize: sf(12),
      fontWeight: '700',
      color: '#ff9d2e',
      backgroundColor: 'rgba(255,157,46,0.18)',
      borderRadius: 4,
      paddingHorizontal: 6,
      paddingVertical: 1,
    },
    verticalSubText: { fontSize: sf(12), color: 'rgba(255,255,255,0.75)', marginBottom: 6 },
    verticalSection: { marginTop: 6 },
    verticalSectionText: { flex: 1, fontSize: sf(12), color: 'rgba(255,255,255,0.85)', lineHeight: sf(19) },
    verticalDetailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    verticalSectionTag: { fontSize: sf(12), fontWeight: '600', color: '#fff', marginTop: 1 },
    verticalExpandLink: { fontSize: sf(12), color: '#fff', marginLeft: 6 },
    // 底部选集横条（红果式）：视频底部独立水平条，默认常显，点击弹选集列表，位于进度条上方
    episodeBar: {
      position: 'absolute',
      left: 12,
      right: 12,
      bottom: 32,
      zIndex: 17,
      flexDirection: 'row' as const,
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.4)',
      borderRadius: 22,
      paddingHorizontal: 16,
      paddingVertical: 11,
    },
    episodeBarTitle: { fontSize: sf(15), fontWeight: '700', color: '#fff' },
    episodeBarSub: { fontSize: sf(13), color: 'rgba(255,255,255,0.7)', marginLeft: 4 },
    // 红果式底部进度条（紧贴预读进度条上方，对齐原生控件位置）；可拖动 seek，白点 thumb 标记当前进度
    progressWrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 68,
      zIndex: 26,
      height: 34,
      flexDirection: 'row' as const,
      alignItems: 'center',
    },
    progressTrack: {
      flex: 1,
      height: 3,
      borderRadius: 1.5,
      backgroundColor: 'rgba(255,255,255,0.3)',
      marginHorizontal: 14,
    },
    progressFill: { height: 3, borderRadius: 1.5, backgroundColor: '#fff' },
    progressThumb: {
      position: 'absolute' as const,
      top: -3.5,
      width: 10,
      height: 10,
      borderRadius: 5,
      marginLeft: -5,
      backgroundColor: '#fff',
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 2,
      shadowOffset: { width: 0, height: 1 },
    },
    // 红果式跟手滑动：最外层 transform 容器（不含 overflow，三卡并排随 translateY 整体平移）
    swipeTransformBox: { flex: 1 },
    // 主卡（当前播放内容，铺满容器）
    swipeCard: { flex: 1, backgroundColor: colors.playerBg },
    // 上下滑预渲染卡片（整屏卡片，absolute 定位于主卡屏上/屏下一屏处）
    slideCard: {
      position: 'absolute' as const,
      left: 0,
      right: 0,
      height: screenH,
      backgroundColor: colors.playerBg,
    },
    // 上下滑预渲染卡片内容：居中海报 + 标题 + 集标签 + 提示
    slideCardInner: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, flex: 1 },
    slideCardPoster: { width: Math.min(screenW * 0.55, 220), aspectRatio: 3 / 4, borderRadius: 14, backgroundColor: colors.surface },
    slideCardTitle: { fontSize: sf(15), fontWeight: '700', color: '#fff', textAlign: 'center', marginTop: 14 },
    slideCardEp: { fontSize: sf(12), fontWeight: '700', color: '#ff9d2e', marginTop: 6 },
    slideCardHint: { fontSize: sf(12), color: 'rgba(255,255,255,0.6)', marginTop: 10 },
    // 五个按钮从视频下方实心行改为悬浮在播放器左上角（压在视频上层）
    toolbarOverlay: {
      position: 'absolute',
      top: 8,
      left: 12,
      zIndex: 20,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    toolbarButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: 'transparent',
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
    },
    // 右侧竖排放大 + 白底圆（悬浮双层圆按钮样式）
    toolbarButtonRound: {
      width: 60,
      height: 60,
      borderRadius: 30,
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
    },
    toolbarIconRound: {
      width: 46,
      height: 46,
      borderRadius: 23,
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
      backgroundColor: 'rgba(255,255,255,0.92)',
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
    // 红果式长按手势反馈层
    lockBadge: { position: 'absolute', top: isImmersive ? 70 : (insets.top + 70), right: 16, zIndex: 25, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
    lockBadgeText: { fontSize: sf(12), fontWeight: '600', color: '#fff' },
    guideBubble: { position: 'absolute', top: isImmersive ? 100 : (insets.top + 100), alignSelf: 'center', zIndex: 25, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
    guideBubbleText: { fontSize: sf(13), color: '#fff' },
    pressHintWrap: { position: 'absolute', bottom: insets.bottom + 150, alignSelf: 'center', zIndex: 25, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
    pressHintTitle: { fontSize: sf(15), fontWeight: '700', color: '#fff' },

    settingsOverlay: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end', zIndex: 10000, elevation: 30 },
    settingsBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
    settingsSheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 18, paddingBottom: insets.bottom + 28, maxHeight: '75%' },
    settingsTitle: { fontSize: sf(16), fontWeight: '600', marginBottom: 14 },
    settingsLabel: { fontSize: sf(13), marginBottom: 8 },
    settingsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
    settingsChip: { minWidth: 64 },
    section: { padding: 15 },
    sectionLabel: { fontSize: sf(14), color: colors.mutedForeground, marginBottom: 10 },
    languageRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 10 },
    languageLabel: { fontSize: sf(14), color: colors.mutedForeground },
    languageChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.sm, minWidth: 48 },
    episodeListEntry: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, marginBottom: 10, marginHorizontal: 12, paddingVertical: 12, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    episodesSheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    episodesSheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 18, maxHeight: '75%' },
    episodesSheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    seasonTabRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
    seasonTabBtn: { minWidth: 64 },
    episodesSheetTitle: { fontSize: sf(16), fontWeight: '600' },
    episodesSheetBody: { paddingBottom: 8 },
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
    });
  }, [colors, cardBg, surfaceBg, accentBg, dimBg, sf, videoHeight, insets, screenH, screenW, isImmersive]);

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
      setPlotOverflow(false);
      setCastOverflow(false);
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

        // 儿童模式拦截：该媒体未标记为适合儿童时不启动播放
        const kidModeOn = await provider.getKidModeActive();
        if (cancelled) return;
        if (kidModeOn && m?.kidSafe !== true) {
          setError('该内容在儿童模式下不可观看');
          return;
        }

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
        skipEligibleRef.current = seekTime < 2 * 60;
        setSkipForwardVisible(false);
        skipForwardVisibleRef.current = false;
        skipDismissedRef.current = false;
        lastTimeRef.current = seekTime;
        setPlaySources(sources);
        // 语言层：MOVIE 多语言版本时默认选中第一个语言（仅 MOVIE 处理；TV 由剧集语言层 effect 维护，此处不重置）
        if (media && media.type === 'MOVIE') {
          const langs = Array.from(new Set(sources.map((s) => s.language).filter(Boolean))) as string[];
          if (langs.length > 1) {
            setSelectedLang((prev) => (prev && langs.includes(prev) ? prev : langs[0]));
          } else {
            setSelectedLang(null);
          }
        }
        if (sources.length > 0) {
          setVideoUrl(sources[pickIdx].url);
          setActivePlayIdx(pickIdx);
          setSelectedSourceId(sources[pickIdx].sourceId ?? null);
        } else {
          setError('无可播放的线路');
        }

        // 播放中横幅广告：内置恒启用，换集/重进时重置调度器
        adSchedulerRef.current = new AdFloatScheduler(BUILTIN_AD_FLOAT_CONFIG);
        lastAdShownRef.current = null;
        setActiveAd(null);
      } catch {
        setError('加载失败');
      } finally {
        setIsLoading(false);
        setConfigLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [currentEpisodeId]);

  // TV 语言层：该媒体全部语言 ↔ 剧集 ↔ 片源 映射（一次 DAO 查询），选语言后过滤片源与剧集
  useEffect(() => {
    if (!mediaId || media?.type === 'MOVIE') {
      setTvLangInfo([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const info = await getProvider().getPlaySourceLanguagesByMedia(mediaId);
        if (cancelled) return;
        setTvLangInfo(info);
        const langs = Array.from(new Set(info.map((i) => i.language).filter(Boolean))) as string[];
        setSelectedLang((prev) => (prev && langs.includes(prev) ? prev : (langs.length > 1 ? langs[0] : null)));
      } catch {
        if (!cancelled) setTvLangInfo([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mediaId, media?.type]);

  const tvLangMap = useMemo(() => new Map(tvLangInfo.map((i) => [i.episodeId, i.language])), [tvLangInfo]);
  const tvLangSources = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const i of tvLangInfo) {
      if (!m.has(i.language)) m.set(i.language, new Set());
      m.get(i.language)!.add(i.sourceId);
    }
    return m;
  }, [tvLangInfo]);
  const tvLanguages = useMemo(() => [...tvLangSources.keys()], [tvLangSources]);
  const applyTvLang = (lang: string) => {
    setSelectedLang(lang);
    const srcs = tvLangSources.get(lang);
    if (srcs && selectedSourceId && !srcs.has(selectedSourceId)) {
      const first = srcs.values().next().value;
      if (first && first !== selectedSourceId) handleSourceChange(first);
    }
  };
  const filteredEpisodes = useMemo(() => {
    if (!selectedLang) return episodes;
    if (tvLanguages.length <= 1) return episodes;
    return episodes.filter((ep: Episode) => tvLangMap.get(ep.id) === selectedLang);
  }, [episodes, selectedLang, tvLanguages, tvLangMap]);
  const shownSources = useMemo(() => {
    if (!selectedLang) return episodeSources;
    if (tvLanguages.length <= 1) return episodeSources;
    const langs = tvLangSources.get(selectedLang);
    if (!langs) return episodeSources;
    const filtered = episodeSources.filter((s) => langs.has(s.id));
    return filtered.length > 0 ? filtered : episodeSources;
  }, [episodeSources, selectedLang, tvLanguages, tvLangSources]);

  // TV：首帧选中语言默认切换到该语言的首个片源（当前源不含该语言时），剧集列表不空
  useEffect(() => {
    if (media?.type === 'MOVIE' || !selectedLang || !selectedSourceId) return;
    const srcs = tvLangSources.get(selectedLang);
    if (!srcs || srcs.has(selectedSourceId)) return;
    const first = srcs.values().next().value;
    if (first && first !== selectedSourceId) handleSourceChange(first);
  }, [selectedLang, selectedSourceId, tvLangSources, media?.type]);

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
    // 播放中横幅广告：随机触发，不打断播放
    const adScheduler = adSchedulerRef.current;
    if (
      adScheduler &&
      !activeAdRef.current &&
      adScheduler.shouldShow(currentTime)
    ) {
      const orientation = screenW >= screenH ? ('landscape' as const) : ('portrait' as const);
      const ad = adScheduler.pickRandomExclude(lastAdShownRef.current, orientation);
      if (ad) {
        lastAdShownRef.current = ad;
        setActiveAd(ad);
      }
    }
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
  const lastPushedCastUrlRef = useRef<string>('');

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
    // 换源后清空宽高比，待新源 videoTrackChange 重新上报真实比例
    setVideoRatio(null);
    try { p.replace(effectiveVideoUrl as any, true); } catch {}
  }, [effectiveVideoUrl]);

  // 卸载：先暂停（停止播放/声音），再视平台释放。
  // iOS 上 release() 本身即崩溃（fatal abort 无法 try/catch 拦截），故跳过以规避闪退；
  // Android 上 release 安全，正常释放。未调 release 的原生实例由 Hermes GC 按
  // expo-modules-core 机制最终回收（SDK57 行为，见 issue #47568）。
  // 顺序铁律：必须「先存进度 → 置空 playerRef → 再 release」。
  // Android 上 release 后再读取 player（如后续声明在 release 之后的 flush effect 读
  // currentTime/duration）会抛 ERR_USING_RELEASED_SHARED_OBJECT（shared object 已释放），
  // 导致返回上一页时报错；置空引用后 flush effect 命中 !p 守卫直接返回。
  useEffect(() => {
    return () => {
      const p = playerRef.current;
      const mediaIdNow = currentMediaIdRef.current;
      const episodeIdNow = currentEpisodeIdRef.current;
      if (mediaIdNow && episodeIdNow && p && (p.duration || 0) > 0) {
        try {
          saveWatchProgress(
            mediaIdNow,
            episodeIdNow,
            Math.floor(p.currentTime || 0),
            Math.floor(p.duration || 0),
            selectedSourceIdRef.current ?? null,
            playSourcesRef.current[activePlayIdxRef.current]?.id ?? null,
          );
          getStore().getState().scheduleRecommendationRecompute();
        } catch {}
      }
      try { p?.pause(); } catch {}
      playerRef.current = null;
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
    // 投屏期间不要自动播放本地（避免与电视端重复发声）；source 替换后保持暂停，由切集 recast 推到电视
    const casting = useCastStore.getState().isCasting && castManager.castDevice;
    if (casting) {
      try { p.pause(); } catch {}
      return;
    }
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
      subs.push(p.addListener('playingChange', (e: { isPlaying: boolean }) => {
        setIsActuallyPlaying(e.isPlaying);
        if (e.isPlaying) {
          // 已在播即熄灭加载遮罩（兜底 iOS readyToPlay 时序差异，对齐桌面端 onPlaying）
          unmute();
          setIsLoading(false);
        }
      }));
      subs.push(p.addListener('sourceLoad', tryPlay));
      subs.push(p.addListener('statusChange', (e: { status: string }) => {
        if (e.status === 'readyToPlay') {
          // 新源真正就绪才开始播放，此时熄灭加载遮罩（覆盖换线路/重试/投屏恢复/失败自动换源四条路径）
          setIsLoading(false);
          tryPlay();
        }
      }));
    } catch {}
    tryPlay();
    const fallback = setTimeout(() => { unmute(); tryPlay(); }, 1500);
    return () => { clearTimeout(fallback); subs.forEach((s) => s.remove()); };
  }, [player, videoUrl, castManager.castDevice]);

  // 切集/换线路期间若正在 DLNA 投屏，把新源同步推到电视端（从 0 起播），本地保持暂停不重复发声
  useEffect(() => {
    const device = castManager.castDevice;
    const active = useCastStore.getState().isCasting;
    if (!active || !device || device.protocol !== 'dlna') return;
    if (!videoUrl || videoUrl === lastPushedCastUrlRef.current) return;
    lastPushedCastUrlRef.current = videoUrl;
    castManager.recast(videoUrl, currentTitle, 0).catch(() => {});
  }, [videoUrl, currentTitle, castManager.castDevice, castManager.recast]);

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
    // 读取首次引导标记（已展示过则不再重复弹引导）
    (async () => {
      try {
        const svc = new SystemConfigService(getProvider());
        guideShownRef.current = (await svc.getString('playback.longPressGuideShown', '')) === '1';
      } catch {}
    })();
  }, []);

  useEffect(() => {
    return () => {
      flushCurrentProgress();
      // 卸载回收：停止长按计时器并复位锁定倍速
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      pressRef.current = null;
      pressActionsRef.current.resetLocked();
    };
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

  const nextEpisode = useMemo(() => {
    if (!currentEpisodeId || episodes.length === 0 || media?.type === 'MOVIE') return null;
    const idx = episodes.findIndex((ep: Episode) => ep.id === currentEpisodeId);
    if (idx < 0 || idx >= episodes.length - 1) return null;
    return episodes[idx + 1] as Episode;
  }, [currentEpisodeId, episodes, media?.type]);

  // 定时保存进度 (10s) + 下一集浮层检测 + 从头播放快进浮窗
  useEffect(() => {
    if (!player) return;
    const interval = setInterval(() => {
      if (player.playing) {
        const ct = player.currentTime;
        const dur = player.duration || 0;
        setPlayStat({ playing: true, cur: ct, dur });
        handleTimeUpdate(ct, dur);

        // 下一集浮层检测
        const threshold = outroThresholdMinutes * 60;
        // 短片（时长 ≤ 预热阈值）在剩余 60s 内触发；长片沿用阈值窗口
        const outroWindow = dur <= threshold ? 60 : threshold;
        const canShow =
          !overlayDismissedRef.current &&
          showNextEpisodeOverlay &&
          nextEpisode != null &&
          dur > 0 &&
          ct > 0 &&
          dur - ct <= outroWindow;
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
          skipEligibleRef.current = ct < 2 * 60;
        }

        // 从头播放快进浮窗（按播放位置：0:00–2:00 内可见，过 2:00 消失）
        if (ct >= 2 * 60) {
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
      } else {
        setPlayStat((prev) => ({ ...prev, playing: false }));
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [player, outroThresholdMinutes, showNextEpisodeOverlay, nextEpisode]);

  const togglePlayPause = () => {
    const p = playerRef.current;
    if (!p) return;
    if (p.playing) {
      p.pause();
      setPlayStat((s) => ({ ...s, playing: false }));
    } else {
      p.play();
      setPlayStat((s) => ({ ...s, playing: true }));
    }
  };

  // 进度条拖动 seek：拖动中实时预览，松开按比例跳转并写回播放器与落库
  const commitDragSeek = useCallback((ratio: number) => {
    const p = playerRef.current;
    const dur = p?.duration || 0;
    if (!p || !isFinite(ratio)) {
      setDragProgress(null);
      return;
    }
    const target = Math.max(0, Math.min(dur, ratio * dur));
    try { p.currentTime = target; } catch {}
    setPlayStat((s) => ({ ...s, cur: target, dur: dur || s.dur }));
    if (mediaId && currentEpisodeId) {
      saveWatchProgress(
        mediaId,
        currentEpisodeId,
        Math.floor(target),
        Math.floor(dur),
        selectedSourceId ?? null,
        playSources[activePlayIdx]?.id ?? null,
      );
    }
    setDragProgress(null);
  }, [mediaId, currentEpisodeId, selectedSourceId, playSources, activePlayIdx]);

  const progressPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const w = progressTrackWidthRef.current;
      const x = e.nativeEvent.locationX;
      if (w > 0) setDragProgress(Math.max(0, Math.min(1, x / w)));
    },
    onPanResponderMove: (e, g) => {
      const w = progressTrackWidthRef.current;
      const x = e.nativeEvent.locationX;
      if (w > 0) {
        const ratio = Math.max(0, Math.min(1, x / w));
        if (g.dx !== 0 || g.dy !== 0) setDragProgress(ratio);
      }
    },
    onPanResponderRelease: (e) => {
      const w = progressTrackWidthRef.current;
      const x = e.nativeEvent.locationX;
      if (w > 0) commitDragSeek(Math.max(0, Math.min(1, x / w)));
      else setDragProgress(null);
    },
    onPanResponderTerminate: () => setDragProgress(null),
  }), [commitDragSeek]);

  const handlePlaySourceChange = async (idx: number) => {
    pressActionsRef.current.resetLocked();
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
  const handleNextEpisode = () => {
    if (nextEpisode) {
      setCurrentEpisodeId(nextEpisode.id);
      setCurrentTitle(
        (media?.title || '') + (nextEpisode.title ? ` · ${nextEpisode.title}` : ` · 第${nextEpisode.episodeNumber}集`)
      );
    }
  };

  // ── 上下滑切换视频（类抖音） ─────────────────────────────────────────
  // 决策树：电视剧/综艺优先切集；有序列表（list/search/recommend）按序切换；
  // 集数到尽头 / 列表到边界 / 无列表上下文（random）→ 随机播放【当前类型】。
  const switchToMediaById = async (targetMediaId: string, newIndex: number) => {
    pressActionsRef.current.resetLocked();
    try {
      const provider = getProvider();
      const targetMedia = await provider.getMediaById(targetMediaId);
      if (!targetMedia) return;
      const target = await resolveDefaultPlayTarget(provider, targetMedia);
      if (!target) return;
      // 1. 保存当前进度（含线路）
      const p = playerRef.current;
      if (mediaId && currentEpisodeId && p && (p.duration || 0) > 0) {
        saveWatchProgress(
          mediaId,
          currentEpisodeId,
          Math.floor(p.currentTime),
          Math.floor(p.duration),
          selectedSourceId ?? null,
          playSources[activePlayIdx]?.id ?? null,
        );
      }
      // 2. 投屏：AirPlay 为系统路由无法重定向，断开放本地播；DLNA 保留由 recast effect 推新集
      if (castManager.castDevice?.protocol === 'airplay') {
        try { await castManager.disconnect(); } catch {}
      }
      // 3. 切换媒体：重置季/源，由依赖 effect 重建剧集、线路与播放状态
      setMediaId(targetMediaId);
      setCurrentSeason(0);
      setSelectedSourceId(null);
      setCurrentEpisodeId(target.episodeId);
      setCurrentTitle(targetMedia.title || '');
      // 4. 更新列表索引（newIndex < 0 表示随机来源，保持原索引不变：
      //    此后上滑继续越界→随机，下滑仍可回到列表上一项）
      if (newIndex >= 0) {
        setPlayContext((prev) => (prev ? { ...prev, currentIndex: newIndex } : prev));
      }
    } catch {}
  };

  // 统一决策树：预览数据加载与松手切换共用同一解析，保证「所见即所得」
  // （列表来源 next/prev 用 mediaIds 相邻项；电视剧/综艺优先切集，集内存在则 ucs 显示集标签）
  type SwipeTarget =
    | { kind: 'episode'; ep: Episode; parentMedia: Media }
    | { kind: 'media'; media: Media; index: number }
    | null;

  const resolveSwipeTarget = async (dir: 'next' | 'prev'): Promise<SwipeTarget> => {
    try {
      const isSeries = media && (media.type === 'TV' || media.type === 'VARIETY');
      if (isSeries && media && episodes.length > 0) {
        const idx = episodes.findIndex((ep: Episode) => ep.id === currentEpisodeId);
        const targetIdx = dir === 'next' ? idx + 1 : idx - 1;
        if (targetIdx >= 0 && targetIdx < episodes.length) {
          return { kind: 'episode', ep: episodes[targetIdx] as Episode, parentMedia: media };
        }
      }
      // 有序列表：按序切换（到边界则回落随机）
      const ctx = playContextRef.current;
      if (ctx && ctx.type !== 'random' && ctx.mediaIds && ctx.mediaIds.length > 0) {
        const from = ctx.currentIndex ?? -1;
        const targetIdx = dir === 'next' ? from + 1 : from - 1;
        if (targetIdx >= 0 && targetIdx < ctx.mediaIds.length) {
          const provider = getProvider();
          const targetMedia = await provider.getMediaById(ctx.mediaIds[targetIdx]);
          if (targetMedia) return { kind: 'media', media: targetMedia, index: targetIdx };
        }
      }
      // 无上下文 / 边界：随机播放【当前类型】
      const result = await getProvider().listMedia({
        page: 1,
        pageSize: 1,
        sort: 'random',
        type: media?.type ?? undefined,
        excludeId: media?.id,
      });
      const targetMedia = result.items[0];
      if (targetMedia) return { kind: 'media', media: targetMedia, index: -1 };
      return null;
    } catch {
      return null;
    }
  };

  // 预加载 next/prev 预览（海报+标题+集标签），驱动底部/顶部预渲染卡片
  interface SwipePreview {
    media: Media;
    epLabel?: string;
  }
  const [nextPreview, setNextPreview] = useState<SwipePreview | null>(null);
  const [prevPreview, setPrevPreview] = useState<SwipePreview | null>(null);

  const loadSwipePreviews = useCallback(async () => {
    try {
      const [n, p] = await Promise.all([resolveSwipeTarget('next'), resolveSwipeTarget('prev')]);
      const nextInfo: SwipePreview | null = n
        ? { media: n.kind === 'media' ? n.media : n.parentMedia, epLabel: n.kind === 'episode' ? (n.ep.title || `第${n.ep.episodeNumber}集`) : undefined }
        : null;
      const prevInfo: SwipePreview | null = p
        ? { media: p.kind === 'media' ? p.media : p.parentMedia, epLabel: p.kind === 'episode' ? (p.ep.title || `第${p.ep.episodeNumber}集`) : undefined }
        : null;
      setNextPreview(nextInfo);
      setPrevPreview(prevInfo);
    } catch {}
    // 依赖 playContext（含 currentIndex）：切换后由 setPlayContext 触发重建
  }, [media?.type, media?.id, episodes, currentEpisodeId, playContext]);

  // 播放目标变化时刷新预览（含列表切换后 currentIndex 变化）
  useEffect(() => {
    void loadSwipePreviews();
  }, [loadSwipePreviews]);

  // 完成一次跟手切换：卡片已滑出一屏后调用（松手且越过阈值）
  const completeSwipe = async (dir: 'next' | 'prev', mode: 'main' | 'fullscreen') => {
    const yVal = mode === 'fullscreen' ? fsAnimatedY : animatedY;
    try {
      const target = await resolveSwipeTarget(dir);
      if (!target) {
        Animated.spring(yVal, { toValue: 0, useNativeDriver: true, friction: 8, tension: 60 }).start();
        return;
      }
      if (target.kind === 'episode') {
        await handleEpisodePress(target.ep);
      } else {
        await switchToMediaById(target.media.id, target.index);
      }
      // 切换完成：瞬时归位（注意 completeSwipe 前 transform 已到 ±screenH，
      // 必须在新内容状态已提交后归位，避免归位时仍是旧内容）——setTimeout 宏任务确保 setMediaId/setXxx 已 flush
      setTimeout(() => {
        yVal.setValue(0);
      }, 0);
    } catch {
      Animated.spring(yVal, { toValue: 0, useNativeDriver: true, friction: 8, tension: 60 }).start();
    }
  };

  // 供 PanResponder 读取最新处理函数（手势 useMemo 依赖为空）
  const swipeActionsRef = useRef<{
    next: (mode?: 'main' | 'fullscreen') => void;
    prev: (mode?: 'main' | 'fullscreen') => void;
  }>({ next: () => {}, prev: () => {} });
  swipeActionsRef.current = {
    next: (mode: 'main' | 'fullscreen' = 'main') => void completeSwipe('next', mode),
    prev: (mode: 'main' | 'fullscreen' = 'main') => void completeSwipe('prev', mode),
  };

  // ─── 红果式长按手势：倍速控制辅助函数 ───
  const pressApplyRate = (rate: number) => {
    try { const p = playerRef.current; if (p) (p as any).playbackRate = rate; } catch {}
    setCurrentSpeed(rate);
  };
  const pressLock2x = () => {
    locked2xRef.current = true;
    setLocked2x(true);
    pressApplyRate(2);
  };
  const pressUnlock2x = () => {
    locked2xRef.current = false;
    setLocked2x(false);
    pressApplyRate(1);
  };
  // 长按手势结束时复位（若未锁定则恢复 1x，已锁定则保持 2x）
  const pressUnlockTemp = () => {
    if (!locked2xRef.current) pressApplyRate(1);
  };
  // 统一复位：锁定标记 + 速率，切集/切源/卸载时调用
  const pressResetLocked = () => {
    locked2xRef.current = false;
    setLocked2x(false);
    pressApplyRate(1);
  };

  // ─── 红果式长按手势：热区判定 ───
  const zoneInPoint = useCallback((
    pageX: number,
    pageY: number,
    mode: 'main' | 'fullscreen',
  ): 'left' | 'right' | 'middle' | null => {
    if (settingsVisibleRef.current) return null;
    if (mode === 'main') {
      if (!isImmersiveRef.current || appFullscreenRef.current) return null;
      if (overlayVisibleRef.current || skipForwardVisibleRef.current) return null;
      if (!videoUrlRef.current || errorRef.current) return null;
      // 顶部 header 区域（沉浸态 top44 + 留白）
      if (pageY < 120) return null;
      // 底部信息卡 / 进度条 / 选集栏（y > 72% 屏高）
      if (pageY > screenH * 0.72) return null;
      // 右侧竖排功能键列（宽 ~80px）
      if (pageX > screenW - 80) return null;
    } else {
      // 全屏
      if (overlayVisibleRef.current || skipForwardVisibleRef.current) return null;
      if (pageY < (insets.top + 70)) return null;
      if (pageY > screenH - 170) return null;
    }
    const W = screenW;
    if (pageX < W * ZONE_LEFT_R) return 'left';
    if (pageX > W * ZONE_RIGHT_R) return 'right';
    return 'middle';
  }, [screenW, screenH, insets.top]);

  // 供 PanResponder 读取最新处理函数（手势 useMemo 依赖为空）
  const pressActionsRef = useRef<{
    zoneInPoint: (pageX:number, pageY:number, mode:'main'|'fullscreen') => 'left'|'right'|'middle'|null;
    onLongPress: (zone:'left'|'right'|'middle', mode:'main'|'fullscreen') => void;
    onTapFallback: (mode:'main'|'fullscreen') => void;
    lock2x: () => void;
    unlock2x: () => void;
    unlockTemp: () => void;
    resetLocked: () => void;
    openSettings: () => void;
    onDoubleTap: () => void;
  }>({
    zoneInPoint: () => null,
    onLongPress: () => {},
    onTapFallback: () => {},
    lock2x: () => {},
    unlock2x: () => {},
    unlockTemp: () => {},
    resetLocked: () => {},
    openSettings: () => {},
    onDoubleTap: () => {},
  });
  pressActionsRef.current = {
    zoneInPoint,
    onLongPress: (zone: 'left' | 'right' | 'middle', mode: 'main' | 'fullscreen') => {
      if (zone === 'left' || zone === 'right') {
        if (!locked2xRef.current) pressApplyRate(2);
        setPressHint('ff');
        if (!guideShownRef.current) {
          guideShownRef.current = true;
          setShowGuide(true);
          setTimeout(() => setShowGuide(false), 2600);
          try {
            new SystemConfigService(getProvider()).setString('playback.longPressGuideShown', '1').catch(() => {});
          } catch {}
        }
      } else {
        setSettingsVisible(true);
      }
    },
    onTapFallback: (mode: 'main' | 'fullscreen') => {
      if (mode === 'main') togglePlayPause();
      else toggleFsControls();
    },
    lock2x: pressLock2x,
    unlock2x: pressUnlock2x,
    unlockTemp: pressUnlockTemp,
    resetLocked: pressResetLocked,
    openSettings: () => setSettingsVisible(true),
    onDoubleTap: () => {
      void handleFav();
    },
  };

  // ─── 红果式跟手滑动 + 长按双意图 PanResponder ───
  const createSwipeResponder = (yVal: Animated.Value, mode: 'main' | 'fullscreen') => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onStartShouldSetPanResponderCapture: (e) => {
      const st = pressRef.current;
      if (st) return false;
      const zone = pressActionsRef.current.zoneInPoint(
        e.nativeEvent.pageX,
        e.nativeEvent.pageY,
        mode,
      );
      if (zone) {
        pressRef.current = { zone, mode, phase: 'tracking' };
        longPressTimerRef.current = setTimeout(() => {
          const cur = pressRef.current;
          if (cur && cur.phase === 'tracking') {
            cur.phase = 'longpress';
            pressActionsRef.current.onLongPress(cur.zone!, cur.mode);
          }
        }, LONG_PRESS_MS);
        return true;
      }
      return false;
    },
    onMoveShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponderCapture: (_, g) => {
      const st = pressRef.current;
      if (!st) return false;
      if (Math.abs(g.dy) > 30 && Math.abs(g.dy) > Math.abs(g.dx) * 2) {
        clearTimeout(longPressTimerRef.current!);
        st.phase = 'swipe';
        return true;
      }
      return false;
    },
    onPanResponderGrant: () => {},
    onPanResponderMove: (_, g) => {
      const st = pressRef.current;
      if (!st) return;
      if (st.phase === 'swipe' || (st.phase === 'tracking' && Math.abs(g.dy) > 30 && Math.abs(g.dy) > Math.abs(g.dx) * 2)) {
        st.phase = 'swipe';
        clearTimeout(longPressTimerRef.current!);
        const max = screenH;
        yVal.setValue(Math.max(-max, Math.min(max, g.dy)));
        return;
      }
      if (st.phase === 'longpress' && (st.zone === 'left' || st.zone === 'right')) {
        if (g.dy <= -LOCK_GESTURE_DY) setPressHint('lock');
        else if (g.dy >= LOCK_GESTURE_DY) setPressHint('exit');
        else setPressHint('ff');
      }
    },
    onPanResponderRelease: (_, g) => {
      const st = pressRef.current;
      clearTimeout(longPressTimerRef.current!);
      if (!st) return;

      if (st.phase === 'swipe') {
        const threshold = screenH * 0.25;
        const dir = g.dy < 0 ? 'next' : 'prev';
        if (Math.abs(g.dy) > threshold) {
          Animated.timing(yVal, {
            toValue: g.dy < 0 ? -screenH : screenH,
            duration: 220,
            useNativeDriver: true,
          }).start(() => {
            swipeActionsRef.current[dir](mode);
          });
        } else {
          Animated.spring(yVal, { toValue: 0, useNativeDriver: true, friction: 8, tension: 60 }).start();
        }
        pressRef.current = null;
        return;
      }

      if (st.phase === 'longpress') {
        if (st.zone === 'middle') {
          // settings 在 onLongPress 时已打开，release 不再重复
        } else {
          // 红果语义：上滑=锁定 2x；下滑=退出倍速（已锁定解除、未锁定的临时 2x 也恢复 1x）；
          // 位移不足 |dy|<24 → 结束临时（未锁定恢复 1x，已锁定保持 2x）
          if (g.dy <= -LOCK_GESTURE_DY) pressActionsRef.current.lock2x();
          else if (g.dy >= LOCK_GESTURE_DY) pressActionsRef.current.unlock2x();
          else pressActionsRef.current.unlockTemp();
        }
        setPressHint(null);
        pressRef.current = null;
        return;
      }

      const now = Date.now();
      const dt = doubleTapRef.current;
      if (now - dt.ts <= DOUBLE_TAP_MS) {
        clearTimeout(dt.timer);
        dt.ts = 0;
        dt.timer = null;
        pressActionsRef.current.onDoubleTap();
      } else {
        dt.ts = now;
        dt.timer = setTimeout(() => {
          pressActionsRef.current.onTapFallback(mode);
        }, DOUBLE_TAP_MS);
      }
      pressRef.current = null;
    },
    onPanResponderTerminate: () => {
      clearTimeout(longPressTimerRef.current!);
      const dt = doubleTapRef.current;
      if (dt.timer) {
        clearTimeout(dt.timer);
        dt.timer = null;
        dt.ts = 0;
      }
      pressRef.current = null;
      setPressHint(null);
      Animated.spring(yVal, { toValue: 0, useNativeDriver: true, friction: 8, tension: 60 }).start();
    },
  });

  // 沉浸态主卡片组跟手手势
  const swipePanResponder = useMemo(() => createSwipeResponder(animatedY, 'main'), [screenH]);
  // 全屏覆盖层跟手手势（独立 Animated.Value，互不干扰）
  const fsSwipePanResponder = useMemo(() => createSwipeResponder(fsAnimatedY, 'fullscreen'), [screenH]);

  // 预渲染下一张卡（海报+标题）
  const renderSlideCard = (info: SwipePreview | null, hint: string) => (
    <View style={styles.slideCardInner} pointerEvents="none">
      <PosterImage
        uri={info?.media.posterUrl ?? null}
        style={styles.slideCardPoster}
        placeholder={<ActivityIndicator size="small" color="rgba(255,255,255,0.7)" />}
      />
      <Text style={styles.slideCardTitle} numberOfLines={2}>{info?.media.title || '继续播放'}</Text>
      {info?.epLabel ? <Text style={styles.slideCardEp}>{info.epLabel}</Text> : null}
      <Text style={styles.slideCardHint}>{hint}</Text>
    </View>
  );

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

  // 竖屏/横屏自适应：监听视频轨变化，用当前轨真实尺寸更新宽高比（多码率下随清晰度切换更新）
  useEffect(() => {
    if (!player) return;
    const applyTrackSize = (track: any | null) => {
      const size = track?.size as { width?: number; height?: number } | undefined;
      if (size && typeof size.width === 'number' && typeof size.height === 'number' &&
          size.width > 0 && size.height > 0) {
        console.warn(`[PlayScreen] 视频尺寸探测 w=${size.width} h=${size.height} ratio=${(size.width / size.height).toFixed(3)}`);
        lastRatioRef.current = size.width / size.height;
        setVideoRatio(size.width / size.height);
      } else {
        console.warn(`[PlayScreen] 视频尺寸未就绪 track=${track ? 'present' : 'null'}`);
      }
    };
    const sub = player.addListener('videoTrackChange', (e: { videoTrack: any | null }) => {
      applyTrackSize(e?.videoTrack ?? null);
    });
    const p = playerRef.current;
    if (p) applyTrackSize((p as any).videoTrack ?? null);
    return () => { sub.remove(); };
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
    // 用户从设置面板手动调速：清除锁定标记，避免切集逻辑冲突
    locked2xRef.current = false;
    setLocked2x(false);
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

  // ===== 自绘全屏（应用内全屏覆盖层，对齐桌面端全屏浮窗/设置）=====
  const enterAppFullscreen = useCallback(() => {
    if (!videoUrl || error) return;
    setAppFullscreen(true);
  }, [videoUrl, error]);

  const exitAppFullscreen = useCallback(() => {
    setAppFullscreen(false);
    fsAnimatedY.setValue(0);
    if (fsHideTimerRef.current) { clearTimeout(fsHideTimerRef.current); fsHideTimerRef.current = null; }
  }, []);

  const showFsControlsTemporarily = useCallback(() => {
    setFullscreenControlsVisible(true);
    if (fsHideTimerRef.current) { clearTimeout(fsHideTimerRef.current); }
    fsHideTimerRef.current = setTimeout(() => {
      if (appFullscreenRef.current) setFullscreenControlsVisible(false);
    }, 3000);
  }, []);

  const toggleFsControls = useCallback(() => {
    setFullscreenControlsVisible((v) => {
      const next = !v;
      if (fsHideTimerRef.current) { clearTimeout(fsHideTimerRef.current); fsHideTimerRef.current = null; }
      if (next) {
        fsHideTimerRef.current = setTimeout(() => {
          if (appFullscreenRef.current) setFullscreenControlsVisible(false);
        }, 3000);
      }
      return next;
    });
  }, []);

  // 进入全屏时按竖/横片锁定方向（横片强制横屏，对齐现状原生全屏 orientation 行为）；
  // 退出时仅当曾进过全屏才锁回竖屏（避免页面挂载即锁竖屏，保持现状挂载自由旋转）
  // 用 PORTRAIT_UP 而非 PORTRAIT：iOS 端 PORTRAIT 映射为含 portraitUpsideDown 的 mask，
  // 带底部安全区（notch/Home 条）的 iPhone 判定 isSupportedByDevice()=false，
  // lockAsync(PORTRAIT) 抛 UnsupportedOrientationLockException 被吞掉 → 退出全屏滞留横屏。
  const wasFullscreenRef = useRef(false);
  useEffect(() => {
    if (appFullscreen) {
      wasFullscreenRef.current = true;
      try {
        if (isVerticalVideo) {
          ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        } else {
          ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        }
      } catch {}
} else if (wasFullscreenRef.current) {
    try {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    } catch {}
    }
  }, [appFullscreen, isVerticalVideo]);

  // 防御兜底：曾进过全屏的页面卸载时还原正立竖屏，避免全屏横屏态直接返回上级页面时全 App 滞留横屏锁
  useEffect(() => {
    return () => {
      if (wasFullscreenRef.current) {
        try { ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP); } catch {}
      }
    };
  }, []);

  // 偏差 2 修复：全屏中出错（error 置位）统一退出全屏回非全屏错误层，方向随 appFullscreen 解锁，避免层卸载但状态/方向锁滞留
  useEffect(() => {
    if (appFullscreen && error) exitAppFullscreen();
  }, [appFullscreen, error, exitAppFullscreen]);

  // 全屏进度/时长/播放态：timeUpdate 0.5s 粒度 + playingChange 实时，不依赖 5s playStat
  useEffect(() => {
    if (!appFullscreen) return;
    const p = playerRef.current;
    if (!p) return;
    try { p.timeUpdateEventInterval = 0.5; } catch {}
    try { setFsTime(p.currentTime || 0); setFsDuration(p.duration || 0); setFsPlaying(!!p.playing); } catch {}
    const subs: { remove: () => void }[] = [];
    try {
      subs.push(p.addListener('timeUpdate', (e: any) => {
        setFsTime(typeof e?.currentTime === 'number' ? e.currentTime : 0);
        try { setFsDuration(p.duration || 0); } catch {}
      }));
      subs.push(p.addListener('playingChange', (e: any) => {
        setFsPlaying(!!e?.isPlaying);
      }));
    } catch {}
    return () => { subs.forEach((s) => { try { s.remove(); } catch {} }); };
  }, [appFullscreen, player]);

  // 进入全屏显示控制层并 3s 自动隐藏
  useEffect(() => {
    if (appFullscreen) showFsControlsTemporarily();
  }, [appFullscreen, showFsControlsTemporarily]);

  // Android 系统返回键：全屏优先退出全屏（浮层/弹窗打开时先交给弹窗自己处理）
  useEffect(() => {
    if (!appFullscreen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (settingsVisible || episodesSheetVisible || hideModalVisible) return false;
      exitAppFullscreen();
      return true;
    });
    return () => sub.remove();
  }, [appFullscreen, settingsVisible, episodesSheetVisible, hideModalVisible, exitAppFullscreen]);

  const handleFullscreenSeek = (t: number) => {
    const p = playerRef.current;
    if (!p || !isFinite(t)) return;
    try { p.currentTime = t; } catch {}
  };

  const handleFullscreenPiP = () => {
    try { appFullVideoRef.current?.startPictureInPicture(); } catch {}
  };

  // 自绘全屏层的独立样式：不并入主 styles useMemo，避免与屏宽布局耦合重算
  const fsStyles = useMemo(() => StyleSheet.create({
    wrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, elevation: 20, backgroundColor: '#000' },
    video: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    tapLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    // 红果式长按手势反馈层（全屏）
    lockBadge: { position: 'absolute', right: 16, zIndex: 40, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
    guideBubble: { position: 'absolute', alignSelf: 'center', zIndex: 40, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
    pressHintWrap: { position: 'absolute', alignSelf: 'center', zIndex: 40, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
    topBar: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, zIndex: 30 },
    topTitle: { flex: 1, fontSize: sf(16), fontWeight: '600', color: '#fff', marginLeft: 8, marginRight: 40 },
    backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
    controlBar: { position: 'absolute', left: 0, right: 0, zIndex: 30 },
    fullscreenCastWrap: { position: 'absolute', left: 0, right: 0, bottom: 150, alignItems: 'center', zIndex: 40 },
    msg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 25 },
    msgText: { color: '#fff', fontSize: sf(14), marginTop: 8 },
  }), [sf]);

  // 功能13: 显示预读分片进度开关（持久化到 playbackConfig.showSegmentProgress）
  const handleToggleSegmentProgress = async (next: boolean) => {
    setShowSegmentProgress(next);
    try {
      const configService = new SystemConfigService(getProvider());
      await configService.setPlaybackConfig({ showSegmentProgress: next });
    } catch {}
  };

  // 功能9: 退出播放页时断开投屏
  useEffect(() => {
    return () => {
      if (useCastStore.getState().isCasting) {
        castManager.disconnect();
      }
    };
  }, []);

  // 双击收藏：卸载时清理待执行/待判定的单击队列
  useEffect(() => {
    return () => {
      const dt = doubleTapRef.current;
      if (dt.timer) {
        clearTimeout(dt.timer);
        dt.timer = null;
        dt.ts = 0;
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
    pressActionsRef.current.resetLocked();
    const targetId = seasonToMediaMap.get(season);
    if (targetId && targetId !== mediaId) {
      // 切季到不同媒体时保留 playContext（继续支持上下滑切换），定位新媒体在列表中的索引
      const ctx = playContextRef.current;
      const ctxMediaIds = ctx?.mediaIds;
      const targetIdx = ctxMediaIds ? ctxMediaIds.indexOf(targetId) : -1;
      navigation.replace('Play', {
        episodeId: null,
        mediaId: targetId,
        sourceId: null,
        title: seriesMedia.find(m => m.id === targetId)?.title || '',
        playContext: ctx
          ? { ...ctx, currentIndex: targetIdx >= 0 ? targetIdx : ctx.currentIndex }
          : null,
      });
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
    pressActionsRef.current.resetLocked();
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
      // DLNA 投屏：保留投屏，由 recast effect 把新集推到电视（本地保持暂停）
      // AirPlay 为系统路由无法编程重定向，退化为断开再本地播放新集
      if (castManager.castDevice.protocol === 'airplay') {
        try {
          await castManager.disconnect();
        } catch {
          // ignore
        }
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
  // 红果式沉浸信息卡使用的集名（去掉「片名 · 」前缀的当前集名）
  const vmEpName = currentTitle?.includes('·') ? currentTitle.split('·').slice(1).join('·').trim() : '';

  // 顶层 header（返回/标题/设置）：沉浸态随卡片组跟手滑出，非沉浸态固定在 container 层
  const headerEl = (
    <View style={styles.header}>
      <TouchableOpacity style={styles.backButton} onPress={() => {
        if (isCasting) {
          castManager.disconnect();
        }
        navigation.goBack();
      }}>
        <ArrowLeft size={20} color="#fff" />
      </TouchableOpacity>
      <Text style={styles.headerTitle} numberOfLines={1}>{currentTitle || '正在播放'}</Text>
      <TouchableOpacity style={styles.headerRight} activeOpacity={0.7} onPress={() => setSettingsVisible(true)}>
        <Settings size={18} color="#fff" />
      </TouchableOpacity>
    </View>
  );

  return (
    <>
    {/* 红果式沉浸：竖屏视频时隐藏系统状态栏，让视频真正延伸到屏幕最顶端；退出/横屏自动恢复全局样式 */}
    {isImmersive && <StatusBar style="light" />}
    <BlurredBackground imageUrl={bgImageUrl}>
    <View style={styles.container} {...(isImmersive && !appFullscreen ? swipePanResponder.panHandlers : {})}>
      {/* 非沉浸态：header 与 spacerTop 固定在 container 层（不启用跟手），保持原有布局 */}
      {!isImmersive && headerEl}
      {!isImmersive && <View style={styles.spacerTop} />}
      {/* 跟手滑动卡片组（红果三卡并排）：transform 容器无 overflow，内部 = 主卡 + 屏下 next + 屏上 prev，
          整体随 translateY 平移，滑出屏外时下一张卡显形；右侧按钮栏(toolbarVerticalCol)留在容器层不跟手 */}
      <Animated.View
        style={[
          isImmersive ? styles.swipeTransformBox : undefined,
          isImmersive && !appFullscreen ? { transform: [{ translateY: animatedY }] } : undefined,
        ]}
      >
      <View style={isImmersive ? styles.swipeCard : undefined}>
      {isImmersive && headerEl}

      <View style={isImmersive ? styles.videoContainerImm : styles.videoContainer}>
        {isLoading && !isActuallyPlaying && (
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
            style={[styles.video, appFullscreen ? styles.videoHiddenInFullscreen : null]}
            player={player}
            contentFit={(isImmersive && isVerticalVideo) ? 'cover' : 'contain'}
            allowsPictureInPicture={isPictureInPictureSupported()}
            startsPictureInPictureAutomatically={isActuallyPlaying && !appFullscreen}
            nativeControls={!isImmersive}
            fullscreenOptions={{ enable: false }}
          />
        )}
        {isImmersive && !appFullscreen && (
          <View style={styles.videoTapLayer}>
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={togglePlayPause}
              accessibilityLabel="播放/暂停"
            />
          </View>
        )}

        {activeAd && (
          <AdFloatOverlay
            ad={activeAd}
            topOffset={isImmersive ? 0 : insets.top}
            onDismissed={() => setActiveAd(null)}
          />
        )}
        <NextEpisodeOverlay
          show={overlayVisible}
          nextEpisodeTitle={nextEpisodeTitle}
          onNext={handleNextEpisode}
          onClose={handleOverlayClose}
          topOffset={96}
        />
        <SkipForwardOverlay
          show={skipForwardVisible}
          onSkip={handleSkipForward}
          onClose={handleSkipForwardClose}
          topOffset={96}
        />
        {showSegmentProgress && videoUrl && (
          <SegmentProgress
            snapshot={segmentSnapshot}
            onClose={() => setShowSegmentProgress(false)}
            resetKey={`${currentEpisodeId}|${activePlayIdx}`}
            isHls={videoUrl.toLowerCase().includes('m3u8')}
          />
        )}
        {videoUrl && !error && !isImmersive && (
          <View style={styles.toolbarOverlay}>
            <TouchableOpacity
              style={styles.toolbarButton}
              activeOpacity={0.7}
              onPress={() => setSettingsVisible(true)}
            >
              <Settings size={18} color="#fff" />
            </TouchableOpacity>
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
            <TouchableOpacity
              style={styles.toolbarButton}
              activeOpacity={0.7}
              onPress={enterAppFullscreen}
              testID="fullscreen-enter"
            >
              <Maximize size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
        {videoUrl && !error && isImmersive && (() => {
          const vCastText =
            `${media?.directors.length ? `导演：${media?.directors.join('、')}` : ''}` +
            `${media?.actors.length ? `${media?.directors.length ? '\n' : ''}主演：${media?.actors.join('、')}` : ''}`;
          const epIdx = currentEpisodeId ? filteredEpisodes.findIndex((e: Episode) => e.id === currentEpisodeId) : -1;
          const epLabelText = vmEpName || (epIdx >= 0 ? `第${epIdx + 1}集` : '');
          return (
            <>
            <View style={styles.verticalCard}>
              {/* 信息区：红果式信息卡常驻全量显示（不伸缩） */}
                <View style={styles.verticalInfoWrap}>
                <View style={styles.verticalInfo} >
                  <View style={styles.verticalTitleRow}>
                    {epLabelText ? <Text style={styles.verticalEpLabel}>{epLabelText}</Text> : null}
                    <Text style={[styles.verticalTitle, { flex: 1 }]} numberOfLines={1}>{media?.title || '正在播放'}</Text>
                  </View>
                  {media && (
                    <Text style={styles.verticalSubText}>
                      {media.year}{media.area ? ` · ${media.area}` : ''}{media.alias ? ` · 又名：${media.alias}` : ''}
                    </Text>
                  )}
                  {media?.updatedAt && (
                    <Text style={styles.verticalSubText}>更新时间：{new Date(media.updatedAt).toISOString().split('T')[0]}</Text>
                  )}
                  {media && (() => {
                    const ratingMedia = currentMedia && currentMedia.id === mediaId ? currentMedia : media;
                    return (
                      <>
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
                      </>
                    );
                  })()}
                  {media && media.description && (
                    <View style={styles.verticalSection}>
                      {/* 隐藏测量文本：与卡片同宽测实际行数，超 1 行才显示「展开」 */}
                      <Text
                        style={{ position: 'absolute', left: 0, right: 0, opacity: 0, height: 0 }}
                        onTextLayout={(e) => setPlotOverflow(e.nativeEvent.lines.length > 1)}
                      >
                        {media.description}
                      </Text>
                      <View style={styles.verticalDetailRow}>
                        <Text style={styles.verticalSectionTag}>简介</Text>
                        <Text style={styles.verticalSectionText} numberOfLines={1}>{media.description}</Text>
                        {plotOverflow && (
                          <TouchableOpacity onPress={() => setIntroSheetVisible(true)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }} style={{ flexShrink: 0 }}>
                            <Text style={styles.verticalExpandLink}>展开</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  )}
                  {(media && (media.directors.length > 0 || media.actors.length > 0)) && (
                    <View style={styles.verticalSection}>
                      {/* 隐藏测量文本：与卡片同宽测实际行数，超 2 行才显示「展开」 */}
                      <Text
                        style={{ position: 'absolute', left: 0, right: 0, opacity: 0, height: 0 }}
                        onTextLayout={(e) => setCastOverflow(e.nativeEvent.lines.length > 2)}
                      >
                        {vCastText}
                      </Text>
                      <View style={styles.verticalDetailRow}>
                        <Text style={styles.verticalSectionTag}>导演/演员</Text>
                        <Text style={styles.verticalSectionText} numberOfLines={2}>{vCastText}</Text>
                        {castOverflow && (
                          <TouchableOpacity onPress={() => setCastSheetVisible(true)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }} style={{ flexShrink: 0 }}>
                            <Text style={styles.verticalExpandLink}>展开</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  )}
                </View>
                </View>
            </View>
            {/* 红果式底部进度条（紧贴预读条上方，可拖动 seek，白点 thumb 标记当前进度） */}
            {media && videoUrl && !error && (
              <View style={styles.progressWrap} {...progressPanResponder.panHandlers}>
                <View
                  style={styles.progressTrack}
                  onLayout={(e) => { progressTrackWidthRef.current = e.nativeEvent.layout.width; }}
                >
                  <View style={[styles.progressFill, { width: `${(dragProgress != null ? dragProgress : (playStat.dur > 0 ? Math.min(1, Math.max(0, playStat.cur / playStat.dur)) : 0)) * 100}%` }]} />
                  <View
                    style={[styles.progressThumb, { left: `${(dragProgress != null ? dragProgress : (playStat.dur > 0 ? Math.min(1, Math.max(0, playStat.cur / playStat.dur)) : 0)) * 100}%` }]}
                  />
                </View>
              </View>
            )}
            {/* 底部选集横条（红果式：视频底部独立水平条，默认常显） */}
            <TouchableOpacity style={styles.episodeBar} activeOpacity={0.7} onPress={() => setEpisodesSheetVisible(true)}>
              <Text style={styles.episodeBarTitle}>选集</Text>
              {filteredEpisodes.length > 0 && (
                <Text style={styles.episodeBarSub}> · 全{filteredEpisodes.length}集</Text>
              )}
              <View style={{ flex: 1 }} />
              <ChevronRight size={18} color="rgba(255,255,255,0.8)" />
            </TouchableOpacity>
            </>
          );
        })()}
      </View>
      </View>

      {/* 上下滑预渲染卡片：红果三卡并排——next 在主卡下方一屏、prev 在主卡上方一屏，
          均为 transform 容器直接子节点，随 translateY 跟手平移（容器无 overflow，划出屏外时自然显形） */}
      {isImmersive && !appFullscreen && (
        <View style={[styles.slideCard, { top: screenH }]} pointerEvents="none">
          {renderSlideCard(nextPreview, '继续向上滑动')}
        </View>
      )}
      {isImmersive && !appFullscreen && (
        <View style={[styles.slideCard, { top: -screenH }]} pointerEvents="none">
          {renderSlideCard(prevPreview, '继续向下滑动')}
        </View>
      )}
      </Animated.View>

      {/* 右侧竖排功能键（红果式：悬浮视频右侧、屏高 55% 起、距右缘 8）——置于卡片组之外固定不跟手；
          进页先显示「图标+按钮名」，5 秒后仅文字淡出、整行缓慢右移让图标落到右缘 */}
      {videoUrl && !error && isImmersive && (
        <View style={styles.toolbarVerticalCol}>
          {!isVerticalVideo && (
            <Animated.View style={[styles.toolbarRow, {
              transform: [{ translateX: toolbarHintAnim.interpolate({ inputRange: [0, 1], outputRange: [0, TOOLBAR_LABEL_EXTRA] }) }],
            }]}>
              <TouchableOpacity style={styles.toolbarButtonRound} activeOpacity={0.7} onPress={enterAppFullscreen}>
                <View style={styles.toolbarIconRound}>
                  <Maximize size={22} color="#222" />
                </View>
              </TouchableOpacity>
              <Animated.Text style={[styles.toolbarLabel, { opacity: toolbarHintAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>全屏</Animated.Text>
            </Animated.View>
          )}
          <Animated.View style={[styles.toolbarRow, {
            transform: [{ translateX: toolbarHintAnim.interpolate({ inputRange: [0, 1], outputRange: [0, TOOLBAR_LABEL_EXTRA] }) }],
          }]}>
            <TouchableOpacity style={styles.toolbarButtonRound} activeOpacity={0.7} onPress={handleFav}>
              <View style={styles.toolbarIconRound}>
                <Heart size={22} color={isFav ? '#ff9d2e' : '#222'} fill={isFav ? '#ff9d2e' : 'none'} />
              </View>
            </TouchableOpacity>
            <Animated.Text style={[styles.toolbarLabel, { opacity: toolbarHintAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>收藏</Animated.Text>
          </Animated.View>
          <Animated.View style={[styles.toolbarRow, {
            transform: [{ translateX: toolbarHintAnim.interpolate({ inputRange: [0, 1], outputRange: [0, TOOLBAR_LABEL_EXTRA] }) }],
          }]}>
            <TouchableOpacity style={styles.toolbarButtonRound} activeOpacity={0.7} onPress={handleDislike}>
              <View style={styles.toolbarIconRound}>
                <ThumbsDown size={22} color={isDisliked ? colors.error : '#222'} />
              </View>
            </TouchableOpacity>
            <Animated.Text style={[styles.toolbarLabel, { opacity: toolbarHintAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>不感兴趣</Animated.Text>
          </Animated.View>
          <Animated.View style={[styles.toolbarRow, {
            transform: [{ translateX: toolbarHintAnim.interpolate({ inputRange: [0, 1], outputRange: [0, TOOLBAR_LABEL_EXTRA] }) }],
          }]}>
            <TouchableOpacity style={styles.toolbarButtonRound} activeOpacity={0.7} onPress={openHideModal}>
              <View style={styles.toolbarIconRound}>
                <EyeOff size={22} color="#222" />
              </View>
            </TouchableOpacity>
            <Animated.Text style={[styles.toolbarLabel, { opacity: toolbarHintAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>隐藏</Animated.Text>
          </Animated.View>
          {isPictureInPictureSupported() && (
            <Animated.View style={[styles.toolbarRow, {
              transform: [{ translateX: toolbarHintAnim.interpolate({ inputRange: [0, 1], outputRange: [0, TOOLBAR_LABEL_EXTRA] }) }],
            }]}>
              <TouchableOpacity style={styles.toolbarButtonRound} activeOpacity={0.7} onPress={handlePictureInPicture}>
                <View style={styles.toolbarIconRound}>
                  <PictureInPicture2 size={22} color="#222" />
                </View>
              </TouchableOpacity>
              <Animated.Text style={[styles.toolbarLabel, { opacity: toolbarHintAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>画中画</Animated.Text>
            </Animated.View>
          )}
          <Animated.View style={[styles.toolbarRow, {
            transform: [{ translateX: toolbarHintAnim.interpolate({ inputRange: [0, 1], outputRange: [0, TOOLBAR_LABEL_EXTRA] }) }],
          }]}>
            <CastButton
              onDeviceSelect={handleCastDeviceSelect}
              onSearch={castManager.searchDevices}
              style={styles.toolbarButtonRound}
              roundedWhite
            />
            <Animated.Text style={[styles.toolbarLabel, { opacity: toolbarHintAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>投屏</Animated.Text>
          </Animated.View>
        </View>
      )}

      {isCasting && (
        <CastRemoteControl
          onPause={castManager.pause}
          onResume={castManager.play}
          onStop={castManager.stop}
          onSeek={castManager.seek}
          onVolume={castManager.setVolume}
        />
      )}

      {!isImmersive && (
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
          const langs = Array.from(new Set(playSources.map((s) => s.language).filter(Boolean))) as string[];
          const displaySources = langs.length > 1 && selectedLang && langs.includes(selectedLang)
            ? playSources.filter((s) => (s.language ?? null) === selectedLang)
            : playSources;
          const sourceKeyMap = new Map<string, number>();
          playSources.forEach(s => {
            const key = `${s.sourceName || ''}_${s.quality || ''}`;
            sourceKeyMap.set(key, (sourceKeyMap.get(key) || 0) + 1);
          });
          const keyIndexMap = new Map<string, number>();
          const applyLang = (lang: string) => {
            const currentIdx = playSources.findIndex((s) => (s.language ?? null) === lang);
            if (currentIdx >= 0 && currentIdx !== activePlayIdx) {
              handlePlaySourceChange(currentIdx);
            }
            setSelectedLang(lang);
          };
          return (
            <View style={styles.section}>
              {langs.length > 1 && (
                <View style={styles.languageRow}>
                  <Text style={styles.languageLabel}>语言</Text>
                  {langs.map((lang) => (
                    <Button
                      key={lang}
                      variant="secondary"
                      size="sm"
                      active={selectedLang === lang}
                      style={styles.languageChip}
                      onPress={() => applyLang(lang)}
                    >
                      {lang}
                    </Button>
                  ))}
                </View>
              )}
              <Text style={styles.sectionLabel}>播放线路（{activePlayIdx + 1}/{playSources.length}）</Text>
              <View style={styles.row}>
                {displaySources.map((s, i) => {
                  const key = `${s.sourceName || ''}_${s.quality || ''}`;
                  const count = sourceKeyMap.get(key) || 1;
                  const idx = (keyIndexMap.get(key) || 0) + 1;
                  keyIndexMap.set(key, idx);
                  const baseName = s.sourceName || `线路${i + 1}`;
                  const qualityStr = s.quality ? ` · ${s.quality}` : '';
                  const suffix = count > 1 ? ` (${idx})` : '';
                  const origIdx = playSources.findIndex((x) => x.id === s.id);
                  return (
                    <Button
                      key={s.id}
                      variant="secondary"
                      size="sm"
                      active={origIdx === activePlayIdx}
                      style={styles.chip}
                      onPress={() => handlePlaySourceChange(origIdx)}
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

        <TouchableOpacity
          style={[styles.episodeListEntry, { backgroundColor: cardBg }]}
          activeOpacity={0.7}
          onPress={() => setEpisodesSheetVisible(true)}
        >
          <Text style={[styles.sectionLabel, { marginBottom: 0 }]}>剧集（{filteredEpisodes.length}集）</Text>
          <ChevronUp size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
      </ScrollView>
      )}
    </View>
    {/* ===== 自绘全屏覆盖层（应用内全屏，对齐桌面端全屏浮窗/设置）===== */}
    {appFullscreen && videoUrl && !error && (() => {
      const fsEpIdx = currentEpisodeId ? filteredEpisodes.findIndex((e: Episode) => e.id === currentEpisodeId) : -1;
      const fsPrevEpisode = fsEpIdx > 0 ? (filteredEpisodes[fsEpIdx - 1] as Episode) : null;
      const fsTogglePlayPause = () => {
        const p = playerRef.current;
        if (!p) return;
        try { if (p.playing) p.pause(); else p.play(); } catch {}
      };
      const fsCastOnDeviceSelect = (device: { id: string; name: string; protocol: string }) => {
        handleCastDeviceSelect(device);
      };
      return (
        <Animated.View
          style={[fsStyles.wrap, { transform: [{ translateY: fsAnimatedY }] }]}
          pointerEvents="box-none"
          {...fsSwipePanResponder.panHandlers}
        >
          <StatusBar style="light" />
          <VideoView
            ref={appFullVideoRef}
            style={fsStyles.video}
            player={player}
            contentFit={isVerticalVideo ? 'cover' : 'contain'}
            allowsPictureInPicture={isPictureInPictureSupported()}
            startsPictureInPictureAutomatically={isActuallyPlaying && appFullscreen}
            nativeControls={false}
            onPictureInPictureStart={() => {
              if (appFullscreenRef.current) exitAppFullscreen();
            }}
          />
          <TouchableOpacity style={fsStyles.tapLayer} activeOpacity={1} onPress={toggleFsControls} />
          {/* 红果式长按：全屏态 2x 锁定角标 */}
          {locked2x && (
            <TouchableOpacity
              style={[fsStyles.lockBadge, { top: isImmersive ? 70 : (insets.top + 70) }]}
              activeOpacity={0.7}
              onPress={pressUnlock2x}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.lockBadgeText}>2x 长按锁定</Text>
            </TouchableOpacity>
          )}
          {/* 红果式长按：首次使用引导气泡 */}
          {showGuide && (
            <View pointerEvents="none" style={[fsStyles.guideBubble, { top: isImmersive ? 100 : (insets.top + 100) }]}>
              <Text style={styles.guideBubbleText}>长按左右快进 · 长按中间打开功能</Text>
            </View>
          )}
          {/* 红果式长按：倍速/锁定提示胶囊（底部控制条上方） */}
          {pressHint && (
            <View pointerEvents="none" style={[fsStyles.pressHintWrap, { bottom: insets.bottom + 170 }]}>
              <Text style={styles.pressHintTitle}>
                {pressHint === 'ff' ? '2.0倍速快进中' : pressHint === 'lock' ? '松手锁定倍速' : '下滑退出倍速'}
              </Text>
            </View>
          )}
          {fullscreenControlsVisible && (
            <>
              <View style={[fsStyles.topBar, { top: insets.top + 6, paddingLeft: insets.left + 10, paddingRight: insets.right + 10 }]}>
                <TouchableOpacity style={fsStyles.backBtn} activeOpacity={0.7} onPress={exitAppFullscreen} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <ArrowLeft size={22} color="#fff" />
                </TouchableOpacity>
                <Text style={fsStyles.topTitle} numberOfLines={1}>{currentTitle || '正在播放'}</Text>
              </View>
              <FullscreenControlBar
                style={[fsStyles.controlBar, { bottom: 8, paddingBottom: insets.bottom + 8, paddingLeft: insets.left > 0 ? insets.left + 8 : 10, paddingRight: insets.right > 0 ? insets.right + 8 : 10 }]}
                visible={fullscreenControlsVisible}
                playing={fsPlaying}
                currentTime={fsTime}
                duration={fsDuration}
                onSeek={handleFullscreenSeek}
                onTogglePlayPause={fsTogglePlayPause}
                onPrev={fsPrevEpisode ? () => handleEpisodePress(fsPrevEpisode) : undefined}
                onNext={nextEpisode ? handleNextEpisode : undefined}
                onOpenSettings={() => setSettingsVisible(true)}
                onPiP={isPictureInPictureSupported() ? handleFullscreenPiP : undefined}
                onExitFullscreen={exitAppFullscreen}
                onCastDeviceSelect={fsCastOnDeviceSelect}
                onCastSearch={castManager.searchDevices}
                onInteract={showFsControlsTemporarily}
              />
            </>
          )}
          {isLoading && !isActuallyPlaying && (
            <View style={[fsStyles.msg, { top: 0 }]}>
              <ActivityIndicator size="large" color="#fff" />
              <Text style={fsStyles.msgText}>加载中...</Text>
            </View>
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
          {showSegmentProgress && (
            <SegmentProgress
              snapshot={segmentSnapshot}
              onClose={() => setShowSegmentProgress(false)}
              resetKey={`${currentEpisodeId}|${activePlayIdx}`}
              isHls={videoUrl?.toLowerCase().includes('m3u8') ?? false}
            />
          )}
          {isCasting && (
            <View style={fsStyles.fullscreenCastWrap}>
              <CastRemoteControl
                onPause={castManager.pause}
                onResume={castManager.play}
                onStop={castManager.stop}
                onSeek={castManager.seek}
                onVolume={castManager.setVolume}
              />
            </View>
          )}
          {isImmersive && (
            <View style={[styles.slideCard, { top: screenH }]} pointerEvents="none">
              {renderSlideCard(nextPreview, '继续向上滑动')}
            </View>
          )}
          {isImmersive && (
            <View style={[styles.slideCard, { top: -screenH }]} pointerEvents="none">
              {renderSlideCard(prevPreview, '继续向下滑动')}
            </View>
          )}
        </Animated.View>
      );
})()}
    {/* 红果式长按手势：2x 锁定角标（右上角，点击解锁） */}
    {locked2x && (
      <TouchableOpacity
        style={styles.lockBadge}
        activeOpacity={0.7}
        onPress={pressUnlock2x}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.lockBadgeText}>2x 长按锁定</Text>
      </TouchableOpacity>
    )}
    {/* 红果式长按手势：首次使用引导气泡（顶部） */}
    {showGuide && (
      <View pointerEvents="none" style={styles.guideBubble}>
        <Text style={styles.guideBubbleText}>长按左右快进 · 长按中间打开功能</Text>
      </View>
    )}
    {/* 红果式长按手势：倍速/锁定提示胶囊（中下） */}
    {pressHint && (
      <View pointerEvents="none" style={styles.pressHintWrap}>
        <Text style={styles.pressHintTitle}>
          {pressHint === 'ff' ? '2.0倍速快进中' : pressHint === 'lock' ? '松手锁定倍速' : '下滑退出倍速'}
        </Text>
      </View>
    )}
    {/* 播放设置内联底部弹层（替换 RN Modal：iOS 全屏方向锁 Landscape 下 Modal present 因 supportedInterfaceOrientations
         混合方向冲突 SIGABRT 闪退，改页面内覆盖层，Android/iOS 行为一致） */}
    {settingsVisible && (
      <View style={styles.settingsOverlay}>
        <Animated.View style={[styles.settingsBackdrop, { opacity: settingsAnim }]}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setSettingsVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} />
        </Animated.View>
        <Animated.View
          style={[styles.settingsSheet, { backgroundColor: colors.background, transform: [{ translateY: settingsSlide }] }]}
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

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={[styles.settingsLabel, { color: colors.text, marginBottom: 0 }]}>显示预读分片进度</Text>
            <Switch
              value={showSegmentProgress}
              onValueChange={handleToggleSegmentProgress}
              trackColor={{ false: colors.swiftTrack, true: colors.swiftActiveTrack }}
              thumbColor={showSegmentProgress ? colors.swiftThumb : colors.disabledForeground}
            />
          </View>
        </Animated.View>
      </View>
    )}
    </BlurredBackground>
    <Modal
      visible={introSheetVisible}
      transparent
      animationType="slide"
      onRequestClose={() => setIntroSheetVisible(false)}
    >
      <TouchableOpacity
        style={styles.episodesSheetOverlay}
        activeOpacity={1}
        onPress={() => setIntroSheetVisible(false)}
      >
        <TouchableOpacity
          style={[styles.episodesSheet, { backgroundColor: colors.background }]}
          activeOpacity={1}
          onPress={() => {}}
        >
          <View style={styles.episodesSheetHeader}>
            <Text style={[styles.episodesSheetTitle, { color: colors.text }]}>剧情简介</Text>
            <TouchableOpacity onPress={() => setIntroSheetVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <X size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={styles.episodesSheetBody}>
            <Text style={[styles.verticalSectionText, { color: colors.text }]}>{media?.description || ''}</Text>
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
    <Modal
      visible={castSheetVisible}
      transparent
      animationType="slide"
      onRequestClose={() => setCastSheetVisible(false)}
    >
      <TouchableOpacity
        style={styles.episodesSheetOverlay}
        activeOpacity={1}
        onPress={() => setCastSheetVisible(false)}
      >
        <TouchableOpacity
          style={[styles.episodesSheet, { backgroundColor: colors.background }]}
          activeOpacity={1}
          onPress={() => {}}
        >
          <View style={styles.episodesSheetHeader}>
            <Text style={[styles.episodesSheetTitle, { color: colors.text }]}>导演与演员</Text>
            <TouchableOpacity onPress={() => setCastSheetVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <X size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={styles.episodesSheetBody}>
            <Text style={[styles.verticalSectionText, { color: colors.text }]}>
              {media?.directors.length ? `导演：${media.directors.join('、')}` : ''}
              {media?.actors.length ? `${media?.directors.length ? '\n\n' : ''}主演：${media.actors.join('、')}` : ''}
            </Text>
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
    <Modal
      visible={episodesSheetVisible}
      transparent
      animationType="slide"
      onRequestClose={() => setEpisodesSheetVisible(false)}
    >
      <TouchableOpacity
        style={styles.episodesSheetOverlay}
        activeOpacity={1}
        onPress={() => setEpisodesSheetVisible(false)}
      >
        <TouchableOpacity
          style={[styles.episodesSheet, { backgroundColor: colors.background }]}
          activeOpacity={1}
          onPress={() => {}}
        >
          <View style={styles.episodesSheetHeader}>
            <Text style={[styles.episodesSheetTitle, { color: colors.text }]}>剧集列表（{filteredEpisodes.length}集）</Text>
            <TouchableOpacity onPress={() => setEpisodesSheetVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <X size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={styles.episodesSheetBody}>
            {displaySeasons.length > 1 && (
              <View style={styles.seasonTabRow}>
                {displaySeasons.map((s: number) => {
                  const isCurrent = seasonToMediaMap.get(s) === mediaId || (!seasonToMediaMap.has(s) && currentSeason === s);
                  return (
                    <Button
                      key={s}
                      variant="secondary"
                      size="sm"
                      active={isCurrent}
                      style={styles.seasonTabBtn}
                      onPress={() => { setEpisodesSheetVisible(false); handleSeasonChange(s); }}
                    >
                      第{s}季
                    </Button>
                  );
                })}
              </View>
            )}
            {tvLanguages.length > 1 && (
              <View style={styles.languageRow}>
                <Text style={styles.languageLabel}>语言</Text>
                {tvLanguages.map((lang) => (
                  <Button
                    key={lang}
                    variant="secondary"
                    size="sm"
                    active={selectedLang === lang}
                    style={styles.languageChip}
                    onPress={() => applyTvLang(lang)}
                  >
                    {lang}
                  </Button>
                ))}
              </View>
            )}
            <View style={styles.sourceEpisodeRow}>
              {shownSources.length > 1 && (
                <View style={styles.sourceTabCol}>
                  {shownSources.map((s: VideoSource) => {
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

              <View style={[styles.episodePanel, { backgroundColor: colors.background }]}>
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
                          onPress={() => { setEpisodesSheetVisible(false); handleEpisodePress(ep); }}
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
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
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
    </>
  );
}
