import { SystemConfigService } from './systemConfigService';
import type { DatabaseProvider } from '../db/provider';

const MIN_DELAY_MS = 60_000;

/**
 * 自动增量采集调度器（共享核心逻辑）
 * 定时触发 + 启动触发 + 移动端回前台触发，复用现有增量采集流程。
 * 触发前守卫：开关开启、无运行中的采集、存在启用源、距上次自动采集达到间隔。
 */
export class AutoCollectScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  constructor(
    private configService: SystemConfigService,
    private db: DatabaseProvider,
    private runCollect: () => Promise<void>,
    private isBusy: () => boolean
  ) {}

  async start(): Promise<void> {
    this.stop();
    const config = await this.configService.getCollectConfig();
    if (!config.autoEnabled) return;

    this.started = true;
    this.scheduleNext();
  }

  stop(): void {
    this.started = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);

    void this.configService.getCollectConfig().then((config) => {
      if (!this.started) return;
      const intervalMs = Math.max(1, config.autoIntervalHours) * 3600_000;
      const last = config.autoLastRunAt ? new Date(config.autoLastRunAt).getTime() : 0;
      const elapsed = last ? Math.max(0, Date.now() - last) : intervalMs;
      const delay = Math.max(MIN_DELAY_MS, intervalMs - elapsed);
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.maybeRun('interval').finally(() => this.scheduleNext());
      }, delay);
    });
  }

  /**
   * 到期判断 + 执行。
   * @returns 是否执行了采集
   */
  async maybeRun(reason: 'startup' | 'interval' | 'resume'): Promise<boolean> {
    if (this.isBusy()) return false;

    const config = await this.configService.getCollectConfig();
    if (!config.autoEnabled) return false;

    const sources = await this.db.getEnabledVideoSources();
    if (sources.length === 0) {
      console.log('[AutoCollect] 无启用视频源，跳过自动增量采集');
      return false;
    }

    const intervalMs = Math.max(1, config.autoIntervalHours) * 3600_000;
    const now = Date.now();
    const last = config.autoLastRunAt ? new Date(config.autoLastRunAt).getTime() : 0;

    if (reason === 'startup') {
      if (!config.autoOnStartup && last !== 0 && now - last < intervalMs) return false;
    } else {
      if (last !== 0 && now - last < intervalMs) return false;
    }

    await this.configService.setString('collect.autoLastRunAt', new Date().toISOString());

    try {
      await this.runCollect();
    } catch (err) {
      console.error('[AutoCollect] 自动增量采集失败:', err instanceof Error ? err.message : String(err));
    }
    return true;
  }
}
