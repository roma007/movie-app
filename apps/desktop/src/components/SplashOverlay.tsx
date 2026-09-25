import { useEffect, useRef, useState } from 'react';
import { getSplashStore, BUILTIN_AD_FLOAT_CONFIG, filterAdsByOrientation, type AdFloatItem } from '@movie-app/core';
import type { MigrationProgress, MigrationDiskError } from '../db/tauriSqlProvider';

/** 按窗口宽高比判定当前屏幕方向（宽≥高=横屏）。 */
function isLandscapeWindow(): boolean {
  return window.innerWidth >= window.innerHeight;
}

interface SplashOverlayProps {
  /** initApp 是否已完成（主应用可渲染、数据库就绪）。 */
  ready: boolean;
  /** 主键 INTEGER 数据库升级进行中：全屏占位（不透明背景 + 提示文案 + 转圈）。 */
  migrating?: boolean;
  /** 迁移进度（百分比 + 阶段文案），升级占位层渲染进度条。 */
  migrationProgress?: MigrationProgress | null;
  /** 磁盘空间不足：渲染升级引导页（不执行迁移、不进入应用）。 */
  diskBlocked?: MigrationDiskError | null;
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
export function SplashOverlay({ ready, migrating = false, migrationProgress, diskBlocked }: SplashOverlayProps) {
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

  // 磁盘空间不足引导页：关闭窗口退出应用（新版不提供"用旧库半残继续"）
  const closeWindow = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    } catch {
      /* ignore */
    }
  };
  const gb = (n: number) => `${(n / 1073741824).toFixed(1)}GB`;
  const progress = migrationProgress?.percent ?? 0;
  const stageLabel = migrationProgress?.label ?? '';

  // 广告内容渲染条件：leaving 期间仍渲染以下层内容，配合容器 opacity 平滑淡出
  const showingAd = phase === 'ad' && adLoaded;
  // logo 层独立显隐：logo 阶段、或广告未就绪时显示；leaving/done 一律透明，防止淡出期间闪现
  const logoVisible = phase === 'logo' || (phase === 'ad' && !adLoaded);

  return (
    <div className="fixed inset-0 z-[999] select-none">
      {/* 数据库升级占位层（主键 INTEGER 迁移期间）：不透明全屏，禁止误关闭 */}
      {migrating && (
        <div className="absolute inset-0 z-[1002] flex flex-col items-center justify-center bg-[#0b0f19]">
          <img
            src="/logo.png"
            alt="logo"
            draggable={false}
            className="h-28 w-28 rounded-2xl object-cover shadow-2xl"
          />
          <div className="mt-4 text-lg font-bold tracking-wide text-white/90">MovieApp</div>
          <div className="mt-6 max-w-md text-center text-sm text-white/80">
            {stageLabel
              ? `正在升级数据库（${progress.toFixed(1)}%）：${stageLabel}`
              : '正在升级数据库，请勿关闭应用…'}
          </div>
          <div className="mt-5 h-2 w-80 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-white/90 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-2 text-xs text-white/50">{progress.toFixed(1)}%</div>
        </div>
      )}

      {/* 磁盘空间不足升级引导页：不透明全屏，告知升级好处/为何需 2 倍空间/装回旧版指引 */}
      {diskBlocked && (
        <div className="absolute inset-0 z-[1003] flex items-center justify-center bg-[#0b0f19] p-8">
          <div className="max-w-md rounded-2xl bg-[#141a2e] p-8 shadow-2xl">
            <div className="text-lg font-bold text-white/95">需要升级数据库，当前空间不足</div>
            <div className="mt-4 space-y-3 text-sm leading-relaxed text-white/85">
              <p>
                本次免费升级将带来：<br />
                ① 数据库体积大幅缩小（实测同量级数据约 5.9GB → 1.3GB）；<br />
                ② 数据读取更快更稳定；<br />
                ③ 修复观看历史、我的追剧错乱。升级全程自动完成，可中断续跑。
              </p>
              <p>
                升级需要约 <span className="text-amber-300">{gb(diskBlocked.need)}</span>{' '}
                临时空间：迁移过程需同时容纳新旧两套数据的重建（约为数据库大小 ×2），
                属于一次性成本，升级完成后会自动回收。
              </p>
              <p className="text-amber-300">
                当前：需要约 {gb(diskBlocked.need)}，可用 {gb(diskBlocked.free)}。
              </p>
              <p>
                请先安装回旧版本继续正常使用；待腾出约 {gb(diskBlocked.need)}{' '}
                空间后，再安装本新版本并打开，应用将自动完成升级。
              </p>
            </div>
            <button
              type="button"
              className="mt-6 w-full rounded-xl bg-white/10 py-2.5 text-sm font-medium text-white/95 transition-colors hover:bg-white/15"
              onClick={closeWindow}
            >
              我知道了（退出应用）
            </button>
          </div>
        </div>
      )}

      {/* 欢迎页（logo）layer */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center bg-[#0b0f19] transition-opacity duration-300"
        style={{ opacity: logoVisible ? 1 : 0, pointerEvents: logoVisible ? 'auto' : 'none' }}
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