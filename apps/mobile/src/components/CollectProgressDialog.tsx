import { useEffect, useState, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Dimensions, LayoutAnimation, UIManager, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppStore } from '../useAppStore';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import { Button } from './ui/Button';
import { radius } from '../themes/radiusTokens';
import { Check, CheckCircle, XCircle, Minus, X } from 'lucide-react-native';

if (Platform.OS === 'android' && !(globalThis as any).RN$Bridgeless && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SCREEN_WIDTH = Dimensions.get('window').width;

const AUTO_COLLAPSE_MS = 5000;

export default function CollectProgressDialog() {
  const collectSourceProgress = useAppStore((s) => s.collectSourceProgress);
  const collectTrigger = useAppStore((s) => s.collectTrigger);
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const s = useScaledFontSize();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const surfaceBg = hexToRgba(colors.surface, cardOpacity / 100 * 0.6);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevVisibleRef = useRef(false);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [contentWidth, setContentWidth] = useState(260);

  const startCollapseTimer = () => {
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = setTimeout(() => {
      setExpanded(false);
      collapseTimerRef.current = null;
    }, AUTO_COLLAPSE_MS);
  };

  useEffect(() => {
    const visible = !!collectSourceProgress && collectSourceProgress.length > 0;
    if (visible && !prevVisibleRef.current) {
      setDismissed(false);
      if (collectTrigger === 'auto') {
        // 自动采集默认收缩为小药丸，不自动展开
        setExpanded(false);
      } else {
        setExpanded(true);
        startCollapseTimer();
      }
    }
    prevVisibleRef.current = visible;
  }, [collectSourceProgress, collectTrigger]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    };
  }, []);

  const styles = useMemo(() => StyleSheet.create({
    overlay: {
      position: 'absolute',
      bottom: insets.bottom + 16,
      left: 12,
      zIndex: 999,
      elevation: 10,
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.full,
      alignSelf: 'flex-start',
      gap: 6,
    },
    pillSpinner: {
      width: 14,
      height: 14,
    },
    pillText: {
      fontSize: s(13),
      fontWeight: '500',
    },
    pillCount: {
      fontSize: s(12),
      marginLeft: 2,
    },
    container: {
      borderRadius: radius.lg,
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    title: {
      fontSize: s(14),
      fontWeight: '600',
      flex: 1,
    },
    headerActions: {
      flexDirection: 'row',
      gap: 8,
      marginLeft: 8,
    },
    headerBtn: {
      width: 22,
      height: 22,
      borderRadius: radius.full,
      backgroundColor: hexToRgba(colors.mutedForeground, cardOpacity / 100 * 0.15),
      alignItems: 'center',
      justifyContent: 'center',
    },
    list: {
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: radius.md,
      marginBottom: 2,
    },
    itemIcon: {
      width: 20,
      alignItems: 'center',
      marginRight: 8,
    },
    itemContent: {
      flex: 1,
    },
    sourceName: {
      fontSize: s(13),
      fontWeight: '500',
    },
    itemDetail: {
      fontSize: s(11),
      marginTop: 2,
    },
    footer: {
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    footerText: {
      fontSize: s(11),
    },
  }), [colors, cardBg, surfaceBg, s, insets]);

  if (!collectSourceProgress || collectSourceProgress.length === 0 || dismissed) return null;

  const allDone = collectSourceProgress.every(
    (s) => s.status === 'done' || s.status === 'failed'
  );

  if (allDone && !timerRef.current) {
    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
    timerRef.current = setTimeout(() => {
      setDismissed(true);
      timerRef.current = null;
    }, 2000);
  }

  const totalCollected = collectSourceProgress.reduce((sum, s) => sum + s.collected, 0);
  const doneCount = collectSourceProgress.filter((s) => s.status === 'done').length;
  const failedCount = collectSourceProgress.filter((s) => s.status === 'failed').length;
  const runningCount = collectSourceProgress.filter((s) => s.status === 'running').length;
  const maxWidth = SCREEN_WIDTH * 0.78;

  const handleExpand = () => {
    LayoutAnimation.configureNext(LayoutAnimation.create(
      250,
      LayoutAnimation.Types.easeInEaseOut,
      LayoutAnimation.Properties.opacity,
    ));
    setExpanded(true);
    startCollapseTimer();
  };

  const handleCollapse = () => {
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = null;
    LayoutAnimation.configureNext(LayoutAnimation.create(
      250,
      LayoutAnimation.Types.easeInEaseOut,
      LayoutAnimation.Properties.opacity,
    ));
    setExpanded(false);
  };

  if (!expanded) {
    return (
      <View style={styles.overlay}>
        <Button
          variant="secondary"
          size="sm"
          style={StyleSheet.flatten([styles.pill, { backgroundColor: cardBg }])}
          onPress={() => handleExpand()}
          leftIcon={allDone ? <Check size={14} color={colors.success} /> : <ActivityIndicator size="small" color={colors.mutedForeground} />}
        >
          <Text style={[styles.pillText, { color: colors.text }]} numberOfLines={1}>
            {allDone ? '采集完成' : `采集中 ${doneCount + failedCount}/${collectSourceProgress.length}`}
          </Text>
          {totalCollected > 0 && (
            <Text style={[styles.pillCount, { color: colors.mutedForeground }]}>
              {totalCollected}部
            </Text>
          )}
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.overlay}>
      <View style={[styles.container, { backgroundColor: cardBg, width: contentWidth }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>
            {allDone ? '采集完成' : runningCount > 0 ? `增量采集中 (${runningCount}源)` : '增量采集'}
          </Text>
          <View style={styles.headerActions}>
            <Button
              variant="icon"
              size="sm"
              style={styles.headerBtn}
              onPress={() => handleCollapse()}
            >
              <Minus size={18} color={colors.mutedForeground} />
            </Button>
            <Button
              variant="icon"
              size="sm"
              style={styles.headerBtn}
              onPress={() => {
                if (timerRef.current) clearTimeout(timerRef.current);
                timerRef.current = null;
                if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
                collapseTimerRef.current = null;
                LayoutAnimation.configureNext(LayoutAnimation.create(
                  200, LayoutAnimation.Types.easeOut, LayoutAnimation.Properties.opacity,
                ));
                setDismissed(true);
              }}
            >
              <X size={18} color={colors.mutedForeground} />
            </Button>
          </View>
        </View>

        <View
          style={styles.list}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width + 44;
            const clamped = Math.min(Math.max(w, 260), maxWidth);
            if (clamped > contentWidth) setContentWidth(clamped);
          }}
        >
          {collectSourceProgress.map((item, i) => {
            const bgColor = item.status === 'failed'
              ? hexToRgba(colors.error, 0.05)
              : item.status === 'done'
                ? hexToRgba(colors.success, 0.05)
                : surfaceBg;
            return (
              <View key={i} style={[styles.item, { backgroundColor: bgColor }]}>
                <View style={styles.itemIcon}>
                  {item.status === 'running' ? (
                    <ActivityIndicator size="small" color={colors.mutedForeground} />
                  ) : item.status === 'done' ? (
                    <CheckCircle size={14} color={colors.success} />
                  ) : (
                    <XCircle size={14} color={colors.error} />
                  )}
                </View>
                <View style={styles.itemContent}>
                  <Text style={[styles.sourceName, { color: colors.text }]} numberOfLines={1}>{item.sourceName}</Text>
                  {item.status === 'failed' ? (
                    <Text style={[styles.itemDetail, { color: colors.error }]} numberOfLines={1}>{item.error || '采集失败'}</Text>
                  ) : item.status === 'done' ? (
                    <Text style={[styles.itemDetail, { color: colors.mutedForeground }]}>完成 · 共采集 {item.collected} 部</Text>
                  ) : item.totalPages === 0 ? (
                    <Text style={[styles.itemDetail, { color: colors.mutedForeground }]}>正在读取待采集量...</Text>
                  ) : (
                    <Text style={[styles.itemDetail, { color: colors.mutedForeground }]}>
                      第 {item.currentPage}/{item.totalPages} 页 · 已采集 {item.collected} 部
                    </Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
            共采集 {totalCollected} 部
            {doneCount > 0 ? ` · ${doneCount} 源完成` : ''}
            {failedCount > 0 ? ` · ${failedCount} 源失败` : ''}
          </Text>
        </View>
      </View>
    </View>
  );
}
