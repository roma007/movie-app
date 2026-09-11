import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Settings, SkipBack, SkipForward, Pause, Play, PictureInPicture2, Minimize2 } from 'lucide-react-native';
import Slider from '@react-native-community/slider';
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
}: Props) {
  const opacityAnim = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [scrub, setScrub] = useState<number | null>(null);

  useEffect(() => {
    Animated.timing(opacityAnim, {
      toValue: visible ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [visible, opacityAnim]);

  const displayTime = scrub != null ? scrub : currentTime;
  const max = duration > 0 ? duration : 1;

  return (
    <Animated.View
      style={[styles.container, style, { opacity: opacityAnim }]}
      pointerEvents={visible ? 'auto' : 'none'}
      onTouchStart={onInteract}
    >
      <View style={styles.progressSection}>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={max}
          value={Math.min(displayTime, max)}
          minimumTrackTintColor="#fff"
          maximumTrackTintColor="rgba(255,255,255,0.25)"
          thumbTintColor="#fff"
          onSlidingStart={() => setScrub(currentTime)}
          onValueChange={(v) => setScrub(v)}
          onSlidingComplete={(v) => {
            setScrub(null);
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