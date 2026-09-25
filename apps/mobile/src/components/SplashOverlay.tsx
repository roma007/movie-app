import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, Linking, Animated, Easing, Dimensions, Platform, BackHandler, Alert } from 'react-native';
import { getSplashStore, BUILTIN_AD_FLOAT_CONFIG, filterAdsByOrientation, type AdFloatItem } from '@movie-app/core';
import type { MigrationProgress, MigrationDiskError } from '../db/expoSqliteProvider';

interface SplashOverlayProps {
  /** initApp 是否已完成（主应用可渲染、数据库就绪）。 */
  ready: boolean;
  /** 主键 INTEGER 升级进度：未就绪期间全屏展示进度条。 */
  migrationProgress?: MigrationProgress | null;
  /** 磁盘空间不足：全屏升级引导页（不执行迁移、不进入应用）。 */
  diskBlocked?: MigrationDiskError | null;
}

const LOGO_MS = 1500;
const AD_TIMEOUT_MS = 10000;
const AD_MIN_DISPLAY_MS = 5000;
const FADE_OUT_MS = 400;
const BANNER_HEIGHT = 0;

/**
 * 启动欢迎页 + 全屏广告覆盖层（移动端）。
 * - 欢迎页：logo 居中展示，至少 LOGO_MS；待 init 就绪后切广告；
 * - 全屏广告：取内置广告配置第一条，从下方滑入展示；
 * - 自动消失：首页四大板块数据就绪（homeReady）后淡出；AD_TIMEOUT_MS 超时兜底；
 * - 主应用渲染在其下层，首页数据在广告展示期间后台加载。
 */
export function SplashOverlay({ ready, migrationProgress, diskBlocked }: SplashOverlayProps) {
  const phase = getSplashStore()((s) => s.phase);
  const homeReady = getSplashStore()((s) => s.homeReady);
  const setPhase = getSplashStore()((s) => s.setPhase);

  const [ad, setAd] = useState<AdFloatItem | null>(null);
  const [adLoaded, setAdLoaded] = useState(false);
  const [gone, setGone] = useState(false);
  const logoOpacity = useRef(new Animated.Value(1)).current;
  const adAnim = useRef(new Animated.Value(0)).current;
  const mountAtRef = useRef(Date.now());
  const adShownAtRef = useRef(0);

  // logo → ad：至少 LOGO_MS，且 init 就绪后切换
  useEffect(() => {
    if (phase !== 'logo' || !ready) return;
    const until = mountAtRef.current + LOGO_MS;
    const delay = Math.max(0, until - Date.now());
    const t = setTimeout(() => setPhase('ad'), delay);
    return () => clearTimeout(t);
  }, [phase, ready, setPhase]);

  // ad 阶段：按屏幕方向取匹配广告位第一条并从下方滑入
  useEffect(() => {
    if (phase !== 'ad') return;
    const { width, height } = Dimensions.get('window');
    const orientation = width >= height ? 'landscape' : 'portrait';
    const pool = filterAdsByOrientation(BUILTIN_AD_FLOAT_CONFIG.ads, orientation);
    if (pool.length === 0) {
      setPhase('done');
      return;
    }
    const picked = pool[0];
    setAd(picked);
    setAdLoaded(true);
    adShownAtRef.current = Date.now();
    Animated.parallel([
      Animated.timing(adAnim, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(logoOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
    return () => {};
  }, [phase, setPhase, adAnim, logoOpacity]);

  // 消失条件：homeReady 且已展示满最小时长；AD_TIMEOUT_MS 超时兜底
  useEffect(() => {
    if (phase !== 'ad') return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const dismiss = () => startFadeOut();
    // 硬超时兜底（从广告阶段进入起算）
    timers.push(setTimeout(dismiss, AD_TIMEOUT_MS));
    // 数据就绪后仍需展示满最小时长才淡出
    if (homeReady) {
      if (adShownAtRef.current > 0) {
        const remaining = AD_MIN_DISPLAY_MS - (Date.now() - adShownAtRef.current);
        if (remaining <= 0) dismiss();
        else timers.push(setTimeout(dismiss, remaining));
      } else {
        // 广告尚未开始展示（配置读取中），就绪后立即展示满 5s
        timers.push(setTimeout(() => {
          const el = Date.now() - adShownAtRef.current;
          if (el >= AD_MIN_DISPLAY_MS) dismiss();
          else timers.push(setTimeout(dismiss, AD_MIN_DISPLAY_MS - el));
        }, 200));
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [phase, homeReady]);

  useEffect(() => {
    if (phase === 'done' && adLoaded) {
      const t = setTimeout(() => setGone(true), FADE_OUT_MS + 50);
      return () => clearTimeout(t);
    }
  }, [phase, adLoaded]);

  const startFadeOut = () => {
    Animated.timing(logoOpacity, { toValue: 0, duration: FADE_OUT_MS, useNativeDriver: true }).start(() => {
      setPhase('done');
    });
  };

  if (gone) return null;

  const showingAd = phase === 'ad' && adLoaded;
  const progress = migrationProgress?.percent ?? 0;
  const stageLabel = migrationProgress?.label ?? '';
  const gb = (n: number) => `${(n / 1073741824).toFixed(1)}GB`;

  const exitApp = () => {
    if (Platform.OS === 'android') {
      BackHandler.exitApp();
    } else {
      Alert.alert('提示', '请按 Home 键返回桌面并在后台关闭本应用，再安装旧版本继续使用。');
    }
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {!diskBlocked && (
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.logoLayer, { opacity: logoOpacity }]}
          pointerEvents={phase === 'ad' && adLoaded ? 'none' : 'auto'}
        >
          <Image
            source={require('../../assets/logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.logoText}>MovieApp</Text>
        </Animated.View>
      )}

      {!diskBlocked && showingAd && ad && (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { transform: [{ translateY: adAnim.interpolate({ inputRange: [0, 1], outputRange: [BANNER_HEIGHT, 0] }) }], opacity: adAnim },
          ]}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={StyleSheet.absoluteFill}
            onPress={() => {
              if (ad.linkUrl) Linking.openURL(ad.linkUrl).catch(() => {});
            }}
          >
            {ad.imageUrl ? (
              <Image source={{ uri: ad.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.placeholderBg]}>
                <Text style={styles.placeholderTitle}>{ad.title}</Text>
              </View>
            )}
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* 数据库升级进度层：未就绪且迁移有进度时全屏展示（不透明，遮挡欢迎页） */}
      {!diskBlocked && !ready && migrationProgress && (
        <View style={StyleSheet.absoluteFill} pointerEvents="auto">
          <View style={styles.migrateLayer}>
            <Image
              source={require('../../assets/logo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.logoText}>MovieApp</Text>
            <Text style={styles.migrateDesc}>
              {stageLabel
                ? `正在升级数据库（${progress.toFixed(1)}%）：${stageLabel}`
                : '正在升级数据库，请勿关闭应用…'}
            </Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${progress}%` }]} />
            </View>
            <Text style={styles.trackPercent}>{progress.toFixed(1)}%</Text>
          </View>
        </View>
      )}

      {/* 磁盘空间不足升级引导页：不透明全屏，告知升级好处/为何需 2 倍空间/装回旧版指引 */}
      {diskBlocked && (
        <View style={StyleSheet.absoluteFill} pointerEvents="auto">
          <View style={styles.guideLayer}>
            <View style={styles.guideCard}>
              <Text style={styles.guideTitle}>需要升级数据库，当前空间不足</Text>
              <View style={styles.guideBody}>
                <Text style={styles.guideParagraph}>
                  本次免费升级将带来：{'\n'}
                  ① 数据库体积大幅缩小（实测同量级数据约 5.9GB → 1.3GB）；{'\n'}
                  ② 数据读取更快更稳定；{'\n'}
                  ③ 修复观看历史、我的追剧错乱。升级全程自动完成，可中断续跑。
                </Text>
                <Text style={styles.guideParagraph}>
                  升级需要约 <Text style={styles.guideHighlight}>{gb(diskBlocked.need)}</Text> 临时空间：
                  迁移过程需同时容纳新旧两套数据的重建（约为数据库大小 ×2），属于一次性成本，升级完成后会自动回收。
                </Text>
                <Text style={[styles.guideParagraph, styles.guideHighlight]}>
                  当前：需要约 {gb(diskBlocked.need)}，可用 {gb(diskBlocked.free)}。
                </Text>
                <Text style={styles.guideParagraph}>
                  请先安装回旧版本继续正常使用；待腾出约 {gb(diskBlocked.need)} 空间后，再安装本新版本并打开，应用将自动完成升级。
                </Text>
              </View>
              <TouchableOpacity style={styles.guideButton} onPress={exitApp}>
                <Text style={styles.guideButtonText}>
                  {Platform.OS === 'android' ? '我知道了（退出应用）' : '我知道了'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  logoLayer: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0b0f19',
  },
  logo: {
    width: 112,
    height: 112,
    borderRadius: 24,
  },
  logoText: {
    marginTop: 14,
    fontSize: 20,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.9)',
    letterSpacing: 1,
  },
  placeholderBg: {
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  placeholderTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
  },
  migrateLayer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0b0f19',
  },
  migrateDesc: {
    marginTop: 22,
    maxWidth: 300,
    textAlign: 'center',
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    lineHeight: 20,
  },
  track: {
    marginTop: 18,
    width: 280,
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  fill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  trackPercent: {
    marginTop: 8,
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },
  guideLayer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0b0f19',
    paddingHorizontal: 28,
  },
  guideCard: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    backgroundColor: '#141a2e',
    padding: 24,
  },
  guideTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.95)',
  },
  guideBody: {
    marginTop: 14,
  },
  guideParagraph: {
    marginBottom: 12,
    fontSize: 14,
    lineHeight: 21,
    color: 'rgba(255,255,255,0.85)',
  },
  guideHighlight: {
    color: '#fbbf24',
  },
  guideButton: {
    marginTop: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 12,
    alignItems: 'center',
  },
  guideButtonText: {
    fontSize: 15,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.95)',
  },
});