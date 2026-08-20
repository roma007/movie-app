import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Pause, Play, Square, Volume2 } from 'lucide-react-native';
import Slider from '@react-native-community/slider';
import { useThemeColors } from '../../themes/useThemeColors';
import { useCastStore } from '../../stores/castStore';
import { radius } from '../../themes/radiusTokens';

interface Props {
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSeek: (positionMs: number) => void;
  onVolume: (volume: number) => void;
}

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function CastRemoteControl({ onPause, onResume, onStop, onSeek, onVolume }: Props) {
  const colors = useThemeColors();
  const { castDevice, castState, castProgress } = useCastStore();
  const [volume, setVolume] = useState(80);
  const isPlaying = castState === 'playing';

  const handlePlayPause = () => {
    if (isPlaying) {
      onPause();
    } else {
      onResume();
    }
  };

  const handleSeek = (value: number) => {
    onSeek(value * 1000);
  };

  const handleVolumeChange = (value: number) => {
    setVolume(value);
    onVolume(value / 100);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.card }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.liveDot, { backgroundColor: '#4ade80' }]} />
          <Text style={[styles.deviceLabel, { color: colors.foreground }]} numberOfLines={1}>
            已投屏到：{castDevice?.name || '未知设备'}
          </Text>
        </View>
        <TouchableOpacity onPress={onStop} style={[styles.stopBtn, { backgroundColor: 'rgba(239,68,68,0.15)' }]}>
          <Square size={12} color="#ef4444" fill="#ef4444" />
          <Text style={styles.stopText}>断开</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.progressSection}>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={castProgress.duration || 1}
          value={castProgress.currentTime}
          minimumTrackTintColor="#4ade80"
          maximumTrackTintColor={colors.border}
          thumbTintColor="#4ade80"
          onSlidingComplete={handleSeek}
        />
        <View style={styles.timeRow}>
          <Text style={[styles.timeText, { color: colors.mutedForeground }]}>
            {formatTime(castProgress.currentTime)}
          </Text>
          <Text style={[styles.timeText, { color: colors.mutedForeground }]}>
            {formatTime(castProgress.duration)}
          </Text>
        </View>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity
          onPress={handlePlayPause}
          style={[styles.playBtn, { backgroundColor: '#4ade80' }]}
        >
          {isPlaying ? (
            <Pause size={20} color="#000" fill="#000" />
          ) : (
            <Play size={20} color="#000" fill="#000" />
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.volumeSection}>
        <Volume2 size={14} color={colors.mutedForeground} />
        <Slider
          style={styles.volumeSlider}
          minimumValue={0}
          maximumValue={100}
          value={volume}
          minimumTrackTintColor={colors.foreground}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.foreground}
          onSlidingComplete={handleVolumeChange}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.lg,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  deviceLabel: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
  },
  stopText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '500',
  },
  progressSection: {
    marginBottom: 12,
  },
  slider: {
    width: '100%',
    height: 20,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -4,
  },
  timeText: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 12,
  },
  playBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  volumeSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  volumeSlider: {
    flex: 1,
    height: 20,
  },
});
