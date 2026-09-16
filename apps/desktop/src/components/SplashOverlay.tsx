import { useEffect, useRef, useState } from 'react';
import { getSplashStore, BUILTIN_AD_FLOAT_CONFIG, filterAdsByOrientation, type AdFloatItem } from '@movie-app/core';

/** 按窗口宽高比判定当前屏幕方向（宽≥高=横屏）。 */
function isLandscapeWindow(): boolean {
  return window.innerWidth >= window.innerHeight;
}

interface SplashOverlayProps {
  /** initApp 是否已完成（主应用可渲染、数据库就绪）。 */
  ready: boolean;
}

const LOGO_MS = 1500;
const AD_TIMEOUT_MS = 10000;
const AD_MIN_DISPLAY_MS = 5000;
const FADE_OUT_MS = 400;

/**
 * 启动欢迎页 + 全屏广告覆盖层（桌面端）。
 * - 欢迎页：logo 居中展示，至少 LOGO_MS；待 init 就绪后切广告；
 * - 全屏广告：取内置广告配置第一条，展示；
 * - 自动消失：首页四大板块数据就绪（homeReady）后淡出；AD_TIMEOUT_MS 超时兜底；
 * - 主应用渲染在其下层，首页数据在广告展示期间后台加载。
 */
export function SplashOverlay({ ready }: SplashOverlayProps) {
  const phase = getSplashStore()((s) => s.phase);
  const homeReady = getSplashStore()((s) => s.homeReady);
  const setPhase = getSplashStore()((s) => s.setPhase);

  const [ad, setAd] = useState<AdFloatItem | null>(null);
  const [adLoaded, setAdLoaded] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
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

  // ad 阶段：按屏幕方向取匹配广告位的第一条（竖屏取竖版、横屏取横版；无匹配保底取全部）
  useEffect(() => {
    if (phase !== 'ad') return;
    const orientation = isLandscapeWindow() ? 'landscape' : 'portrait';
    const pool = filterAdsByOrientation(BUILTIN_AD_FLOAT_CONFIG.ads, orientation);
    if (pool.length === 0) {
      setPhase('done');
      return;
    }
    const picked = pool[0];
    setAd(picked);
    setAdLoaded(true);
    adShownAtRef.current = Date.now();
    return () => {};
  }, [phase, setPhase]);

  // 消失条件：homeReady 且已展示满最小时长；AD_TIMEOUT_MS 超时兜底
  useEffect(() => {
    if (phase !== 'ad') return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const dismiss = () => setLeaving(true);
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

  // leaving → 淡出 → 卸载
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => { setGone(true); setPhase('done'); }, FADE_OUT_MS);
    return () => clearTimeout(t);
  }, [leaving, setPhase]);

  useEffect(() => {
    if (phase === 'done' && adLoaded) {
      const t = setTimeout(() => setGone(true), 100);
      return () => clearTimeout(t);
    }
  }, [phase, adLoaded]);

  if (gone) return null;

  const showingAd = phase === 'ad' && adLoaded && !leaving;

  return (
    <div className="fixed inset-0 z-[999] select-none">
      {/* 欢迎页（logo）layer */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center bg-[#0b0f19] transition-opacity duration-300"
        style={{ opacity: showingAd ? 0 : 1, pointerEvents: showingAd ? 'none' : 'auto' }}
      >
        <img
          src="/logo.png"
          alt="logo"
          draggable={false}
          className="h-28 w-28 rounded-2xl object-cover shadow-2xl"
        />
        <div className="mt-4 text-lg font-bold tracking-wide text-white/90">MovieApp</div>
      </div>

      {/* 全屏广告 layer */}
      <div
        className="absolute inset-0 transition-opacity duration-300"
        style={{ opacity: leaving ? 0 : 1 }}
      >
        {showingAd && ad && (ad.imageUrl ? (
          <button
            type="button"
            className="block h-full w-full cursor-pointer"
            onClick={() => {
              if (ad.linkUrl) {
                try { window.open(ad.linkUrl, '_blank', 'noopener,noreferrer'); } catch {}
              }
            }}
          >
            <img src={ad.imageUrl} alt={ad.title} className="h-full w-full object-cover" draggable={false} />
          </button>
        ) : (
          <div
            className="relative flex h-full w-full items-center justify-center bg-gradient-to-br from-[#1e293b] via-[#0f172a] to-[#020617]"
            onClick={() => {
              if (ad.linkUrl) {
                try { window.open(ad.linkUrl, '_blank', 'noopener,noreferrer'); } catch {}
              }
            }}
          >
            <div className="text-center px-8">
              <div className="text-2xl font-bold text-white drop-shadow">{ad.title}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}