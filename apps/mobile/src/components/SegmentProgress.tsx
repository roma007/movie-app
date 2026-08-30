import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { useThemeColors } from '../themes/useThemeColors';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { X } from 'lucide-react-native';
import type { MobileSegmentProgressState, SegmentProgressSnapshot } from '../services/segmentProgress';

interface Props {
  snapshot: SegmentProgressSnapshot | null;
  onClose: () => void;
}

const MAX_BARS = 32;
const STRIPE_W = 3;
const STRIPE_GAP = 3;
const STRIPE_PERIOD = STRIPE_W + STRIPE_GAP;

function barWidth(duration: number): number {
  return Math.max(6, Math.min(22, duration * 2));
}

export function SegmentProgress({ snapshot, onClose }: Props) {
  const colors = useThemeColors();
  const s = useScaledFontSize();

  const styles = useMemo(() => StyleSheet.create({
    overlay: {
      position: 'absolute',
      bottom: 8,
      left: 12,
      right: 12,
      zIndex: 30,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    panel: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.7)',
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
      gap: 6,
    },
    label: {
      color: 'rgba(255,255,255,0.65)',
      fontSize: s(10),
      marginRight: 2,
      flexShrink: 0,
    },
    barsRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 3,
      overflow: 'hidden',
    },
    close: {
      padding: 4,
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.08)',
    },
  }), [colors, s]);

  if (!snapshot) return null;
  const segments = snapshot.segments.slice(0, MAX_BARS);
  if (segments.length === 0) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View style={styles.panel} pointerEvents="none">
        {snapshot.prefetchedSeconds > 0 && (
          <Text style={styles.label}>预读 {Math.round(snapshot.prefetchedSeconds)}s</Text>
        )}
        <View style={styles.barsRow}>
          {segments.map((seg) => (
            <SegmentBar key={seg.index} seg={seg} />
          ))}
        </View>
      </View>
      <TouchableOpacity style={styles.close} activeOpacity={0.7} onPress={onClose}>
        <X size={12} color="rgba(255,255,255,0.7)" />
      </TouchableOpacity>
    </View>
  );
}

function SegmentBar({ seg }: { seg: MobileSegmentProgressState }) {
  const width = barWidth(seg.duration);
  const indeterminate = !seg.done && seg.progress === null;

  const bgColor = seg.error
    ? 'rgba(239,68,68,0.35)'
    : seg.playing
      ? 'rgba(74,158,255,0.4)'
      : seg.done
        ? 'rgba(255,255,255,0.9)'
        : 'rgba(255,255,255,0.25)';

  const fillColor = seg.error
    ? 'rgba(239,68,68,0.8)'
    : seg.playing
      ? 'rgba(74,158,255,0.95)'
      : 'rgba(255,255,255,0.9)';

  const hasFill = !indeterminate && seg.progress !== null;
  const fillPercent = hasFill && seg.progress !== null ? seg.progress * 100 : 0;

  return (
    <View style={{ width }}>
      <View style={{ height: seg.playing ? 14 : 10, width, borderRadius: 3, backgroundColor: bgColor, overflow: 'hidden' }}>
        {hasFill && (
          <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${fillPercent}%`, borderRadius: 3, backgroundColor: fillColor }} />
        )}
        {indeterminate && <FlowingStripes width={width} />}
      </View>
    </View>
  );
}

/** 与桌面 seg-progress-indeterminate（index.css）一致的白色流水条纹：0.25↔0.45 交替 + 0.8s 流动。 */
function FlowingStripes({ width }: { width: number }) {
  const translateX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(translateX, {
        toValue: -STRIPE_PERIOD,
        duration: 800,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [translateX]);

  // 条纹需平铺覆盖整条柱宽，并多留一个周期供无缝平移
  const count = Math.ceil(width / STRIPE_PERIOD) + 2;
  const stripes = Array.from({ length: count }).map((_, i) => (
    <View key={i} style={{ width: STRIPE_W, marginRight: STRIPE_GAP, backgroundColor: 'rgba(255,255,255,0.45)' }} />
  ));

  return (
    <View
      style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, flexDirection: 'row', overflow: 'hidden' }}
      pointerEvents="none"
    >
      <Animated.View style={{ flexDirection: 'row', transform: [{ translateX }] }}>
        {stripes}
      </Animated.View>
    </View>
  );
}