import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { useThemeColors } from '../themes/useThemeColors';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { X } from 'lucide-react-native';
import type { MobileSegmentProgressState, SegmentProgressSnapshot } from '../services/segmentProgress';

interface Props {
  snapshot: SegmentProgressSnapshot | null;
  onClose: () => void;
  /** 换集/换线路唯一标识：变化时清空粘滞快照重播种（仅此允许条隐藏/重播种） */
  resetKey?: string;
  /** 当前 URL 是否 m3u8 分片流；非分片流时显示说明文字而非分片条 */
  isHls: boolean;
}

const MAX_BARS = 32;
const STRIPE_W = 3;
const STRIPE_GAP = 3;
const STRIPE_PERIOD = STRIPE_W + STRIPE_GAP;

function barWidth(duration: number): number {
  return Math.max(6, Math.min(22, duration * 2));
}

export function SegmentProgress({ snapshot, onClose, resetKey, isHls }: Props) {
  const colors = useThemeColors();
  const s = useScaledFontSize();

  // 粘滞快照：数据短暂不可用（403/fetch failed/桥滞后/集尾/error）时保留上一帧有效状态，条不隐藏
  const lastGoodRef = useRef<SegmentProgressSnapshot | null>(null);
  const lastResetKeyRef = useRef<string | null>(null);
  if (resetKey !== lastResetKeyRef.current) {
    lastResetKeyRef.current = resetKey ?? null;
    lastGoodRef.current = null;
  }
  if (snapshot && snapshot.segments.length > 0) {
    lastGoodRef.current = snapshot;
  }
  const display = snapshot && snapshot.segments.length > 0 ? snapshot : lastGoodRef.current;

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
    hintText: {
      color: 'rgba(255,255,255,0.65)',
      fontSize: s(11),
      flexShrink: 1,
    },
  }), [colors, s]);

  if (!isHls) {
    return (
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.panel} pointerEvents="none">
          <Text style={styles.hintText}>该视频当前线路不支持分片预读</Text>
        </View>
        <TouchableOpacity style={styles.close} activeOpacity={0.7} onPress={onClose}>
          <X size={12} color="rgba(255,255,255,0.7)" />
        </TouchableOpacity>
      </View>
    );
  }

  if (!display) return null;
  const segments = display.segments.slice(0, MAX_BARS);
  if (segments.length === 0) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View style={styles.panel} pointerEvents="none">
        {display.prefetchedSeconds > 0 && (
          <Text style={styles.label}>预读 {Math.round(display.prefetchedSeconds)}s</Text>
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