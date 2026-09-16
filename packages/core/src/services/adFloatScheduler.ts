import type { AdFloatConfig, AdFloatItem } from './systemConfigService';

/**
 * 播放中横幅广告的随机调度器（纯逻辑，桌面端/移动端共用）。
 *
 * 语义（对照需求留档）：
 * - 播放中随机出现一次，不打断播放；
 * - 首次展示点 = 播放后在 firstShowRandomRangeSeconds 范围内随机选点；
 * - 单次播放（单个视频）最多展示 1 次（maxShowsPerSession 默认 1）。
 *
 * 状态由「播放进度 currentTime」驱动：调用方在播放进度推进时调用 `shouldShow`，
 * 返回 true 表示该时间点应展示广告。展示/消失由调用方（UI 层）负责。
 */
export class AdFloatScheduler {
  private showsInSession = 0;
  private nextShowAtSeconds = 0;

  constructor(private readonly cfg: AdFloatConfig) {
    this.scheduleNextShow();
  }

  /** 重置（换集/会话开始时调用）。 */
  reset(): void {
    this.showsInSession = 0;
    this.scheduleNextShow();
  }

  /** 依据当前播放位置判断是否应触发展示；触发后推进下一次展示点。 */
  shouldShow(currentTime: number): boolean {
    const { enabled, ads, maxShowsPerSession } = this.cfg;
    if (!enabled || !Array.isArray(ads) || ads.length === 0) return false;
    if (this.showsInSession >= maxShowsPerSession) return false;
    if (currentTime < this.nextShowAtSeconds) return false;
    this.showsInSession += 1;
    return true;
  }

  /** 从广告池随机取一条（避免连续重复），列表为空返回 null。 */
  pickRandomExclude(last?: AdFloatItem | null): AdFloatItem | null {
    const ads = this.cfg.ads ?? [];
    if (ads.length === 0) return null;
    if (ads.length === 1) return ads[0];
    const candidates = ads.filter((a) => a !== last);
    const pool = candidates.length > 0 ? candidates : ads;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private scheduleNextShow(): void {
    const [from, to] = this.cfg.firstShowRandomRangeSeconds ?? [30, 180];
    const low = Math.max(0, from);
    const high = Math.max(low + 1, to);
    this.nextShowAtSeconds = low + Math.random() * (high - low);
  }
}