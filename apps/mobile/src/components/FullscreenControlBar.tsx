import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet, StyleProp, ViewStyle, useWindowDimensions, ActivityIndicator } from 'react-native';
import { Settings, SkipBack, SkipForward, Pause, Play, PictureInPicture2, Minimize2 } from 'lucide-react-native';
import Slider from '@react-native-community/slider';
import { Image } from 'expo-image';
import type { RefObject } from 'react';
import { useScrubPreview } from '../hooks/useScrubPreview';
import { CastButton } from './cast/CastButton';

interface Props {
  style?: StyleProp<ViewStyle>;
  visible: boolean;
  playing: boolean;
  currentTime: number;
  duration: number;
  onSeek: (t: number) => void;
  onTogglePlayPause: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onOpenSettings: () => void;
  onPiP?: () => void;
  onExitFullscreen?: () => void;
  onCastDeviceSelect?: (device: { id: string; name: string; protocol: string }) => void;
  onCastSearch?: () => void;
  /** 任一交互（点按钮/开始拖动进度）时回调：用于重置自动隐藏计时 */
  onInteract?: () => void;
  /** 正在播放的 player 引用：用于拖动时实时取帧预览 */
  playerRef?: RefObject<any>;
  /** 预览气泡宽高比（视频比例），默认 16:9 */
  previewAspectRatio?: number;
}

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function ControlBtn({
  onPress,
  children,
  testID,
}: {
  onPress?: () => void;
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <TouchableOpacity style={styles.btn} activeOpacity={0.7} onPress={onPress} testID={testID} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
      {children}
    </TouchableOpacity>
  );
}

export function FullscreenControlBar({
  style,
  visible,
  playing,
  currentTime,
  duration,
  onSeek,
  onTogglePlayPause,
  onPrev,
  onNext,
  onOpenSettings,
  onPiP,
  onExitFullscreen,
  onCastDeviceSelect,
  onCastSearch,
  onInteract,
  playerRef,
  previewAspectRatio,
}: Props) {
  const opacityAnim = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [scrub, setScrub] = useState<number | null>(null);
  const { width: screenW, height: screenH } = useWindowDimensions();
  // 拖动帧预览：气泡宽度 ≤30% 屏宽或 260，高度按视频比例（默认 16:9）
  const bubbleW = Math.min(screenW * 0.3, 260);
  const bubbleH = Math.min(bubbleW / (previewAspectRatio && previewAspectRatio > 0 ? previewAspectRatio : 16 / 9), screenH * 0.3);
  const sliderWidthRef = useRef(0);
  const containerHeightRef = useRef(110);
  const { thumbnail, previewTime, loading, requestPreview, reset: resetPreview } = useScrubPreview(playerRef, () => Math.min(screenW * 0.3, 260));
  const [bubbleLeft, setBubbleLeft] = useState<number | null>(null);

  useEffect(() => {
    Animated.timing(opacityAnim, {
      toValue: visible ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [visible, opacityAnim]);

  const displayTime = scrub != null ? scrub : currentTime;
  const max = duration > 0 ? duration : 1;

  const handleScrubValue = (v: number) => {
    setScrub(v);
    const m = duration > 0 ? duration : 1;
    const ratio = m > 0 ? Math.max(0, Math.min(1, v / m)) : 0;
    const left = ratio * sliderWidthRef.current;
    setBubbleLeft((prev) =>
      prev == null || Math.abs(prev - left) > 6
        ? Math.max(0, Math.min(screenW - bubbleW, left - bubbleW / 2))
        : prev
    );
    requestPreview(v);
  };

  return (
    <Animated.View
      style={[styles.container, style, { opacity: opacityAnim }]}
      pointerEvents={visible ? 'auto' : 'none'}
      onTouchStart={onInteract}
      onLayout={(e) => { containerHeightRef.current = e.nativeEvent.layout.height; }}
    >
      {bubbleLeft != null && (
        <View pointerEvents="none" style={[styles.previewBubble, { left: bubbleLeft, bottom: containerHeightRef.current + 10, width: bubbleW, height: bubbleH }]}>
          {thumbnail ? (
            <Image source={thumbnail} style={StyleSheet.absoluteFill} contentFit="contain" transition={0} />
          ) : loading ? (
            <ActivityIndicator size="small" color="#fff" style={styles.previewBubbleLoading} />
          ) : null}
          {previewTime != null && (
            <View style={styles.previewTimeChip}>
              <Text style={styles.previewTimeText}>{formatTime(previewTime)}</Text>
            </View>
          )}
        </View>
      )}
      <View style={styles.progressSection}>
        <Slider
          style={[styles.slider, scrub != null ? styles.sliderActive : null]}
          minimumValue={0}
          maximumValue={max}
          value={Math.min(displayTime, max)}
          minimumTrackTintColor={scrub != null ? '#FA7705' : '#fff'}
          maximumTrackTintColor={scrub != null ? 'rgba(250,119,5,0.35)' : 'rgba(255,255,255,0.25)'}
          thumbTintColor={scrub != null ? '#FFB74D' : '#fff'}
          onLayout={(e) => { sliderWidthRef.current = e.nativeEvent.layout.width; }}
          onSlidingStart={() => {
            setScrub(currentTime);
            setBubbleLeft(
              Math.max(0, Math.min(screenW - bubbleW, (currentTime / max) * sliderWidthRef.current - bubbleW / 2))
            );
            requestPreview(currentTime);
          }}
          onValueChange={handleScrubValue}
          onSlidingComplete={(v) => {
            setScrub(null);
            setBubbleLeft(null);
            resetPreview();
            onSeek(v);
          }}
        />
        <View style={styles.timeRow}>
          <Text style={styles.timeText}>{formatTime(displayTime)}</Text>
          <Text style={styles.timeText}>{formatTime(duration)}</Text>
        </View>
      </View>

      <View style={styles.buttonsRow}>
        <ControlBtn onPress={onOpenSettings}>
          <Settings size={20} color="#fff" />
        </ControlBtn>
        <View style={styles.flexSpacer} />
        {onPrev ? (
          <ControlBtn onPress={onPrev}>
            <SkipBack size={22} color="#fff" fill="#fff" />
          </ControlBtn>
        ) : (
          <View style={styles.hiddenBtn} />
        )}
        <ControlBtn onPress={onTogglePlayPause}>
          {playing ? (
            <Pause size={26} color="#fff" fill="#fff" />
          ) : (
            <Play size={26} color="#fff" fill="#fff" />
          )}
        </ControlBtn>
        {onNext ? (
          <ControlBtn onPress={onNext}>
            <SkipForward size={22} color="#fff" fill="#fff" />
          </ControlBtn>
        ) : (
          <View style={styles.hiddenBtn} />
        )}
        <View style={styles.flexSpacer} />
        {onPiP && (
          <ControlBtn onPress={onPiP}>
            <PictureInPicture2 size={20} color="#fff" />
          </ControlBtn>
        )}
        {onCastDeviceSelect && (
          <CastButton
            onDeviceSelect={onCastDeviceSelect}
            onSearch={onCastSearch}
          />
        )}
        {onExitFullscreen && (
          <ControlBtn onPress={onExitFullscreen} testID="fullscreen-exit">
            <Minimize2 size={20} color="#fff" />
          </ControlBtn>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  progressSection: {
    width: '100%',
    maxWidth: 720,
  },
  slider: {
    width: '100%',
    height: 28,
  },
  sliderActive: {
    height: 34,
  },
  // 拖动帧预览气泡：黑底不透明 + 圆角，浮于进度条正上方（bottom 由容器高度驱动）
  previewBubble: {
    position: 'absolute' as const,
    zIndex: 20,
    borderRadius: 8,
    backgroundColor: '#000',
    overflow: 'hidden' as const,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  previewBubbleLoading: { position: 'absolute' as const, alignSelf: 'center' as const, top: '45%' as const },
  previewTimeChip: {
    position: 'absolute' as const,
    right: 4,
    bottom: 4,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  previewTimeText: { color: '#fff', fontSize: 11, fontVariant: ['tabular-nums'] as const },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -2,
    paddingHorizontal: 12,
  },
  timeText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  buttonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    maxWidth: 720,
    marginTop: 4,
  },
  btn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flexSpacer: {
    flex: 1,
  },
  hiddenBtn: {
    width: 44,
    height: 44,
  },
});