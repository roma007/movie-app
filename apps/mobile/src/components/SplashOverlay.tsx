import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, Linking, Animated, Easing } from 'react-native';
import { getSplashStore, BUILTIN_AD_FLOAT_CONFIG, type AdFloatItem } from '@movie-app/core';

interface SplashOverlayProps {
  /** initApp 是否已完成（主应用可渲染、数据库就绪）。 */
  ready: boolean;
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
export function SplashOverlay({ ready }: SplashOverlayProps) {
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

  // ad 阶段：取内置广告配置第一条并从下方滑入
  useEffect(() => {
    if (phase !== 'ad') return;
    const ads = BUILTIN_AD_FLOAT_CONFIG.ads;
    if (!Array.isArray(ads) || ads.length === 0) {
      setPhase('done');
      return;
    }
    setAd(ads[0]);
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

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
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

      {showingAd && ad && (
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
});