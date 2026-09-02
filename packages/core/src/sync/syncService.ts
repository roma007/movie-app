import type { SyncResult } from '../types';
import { SyncEngine } from './syncEngine';

/**
 * 定时同步服务（II-6，复用清单 F）：
 * 递归 setTimeout + 指数退避（base=interval ≥5000，×2^(n-1) cap 10min，连续失败 ≥10 停自动保留手动）。
 * 只读状态 + 事件订阅（供两端 UI 驱动弱提醒浮窗）。
 */
export type SyncServiceEvent =
  | { type: 'start' }
  | { type: 'done'; result: SyncResult }
  | { type: 'error'; message: string }
  | { type: 'auto-stop' }
  | { type: 'manual-stop' }
  | { type: 'backup-start' };

export interface SyncStatus {
  consecutiveFailures: number;
  lastSyncAt: string | null;
  lastResult: SyncResult | null;
  lastError: string | null;
  /** 是否因连续失败而停止自动轮询 */
  autoStopped: boolean;
}

const MAX_FAILURES = 10;
const BACKOFF_CAP_MS = 10 * 60 * 1000;

export class SyncService {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private userStopped = false;
  private readonly statusInternal: SyncStatus = {
    consecutiveFailures: 0,
    lastSyncAt: null,
    lastResult: null,
    lastError: null,
    autoStopped: false,
  };
  private readonly listeners = new Set<(e: SyncServiceEvent) => void>();

  constructor(
    private engine: SyncEngine,
    private opts: { getInterval: () => number } = { getInterval: () => 30000 }
  ) {}

  get status(): SyncStatus {
    return this.statusInternal;
  }

  /** 启动：立即第一轮 + 定时轮询 */
  start(): void {
    this.userStopped = false;
    this.statusInternal.autoStopped = false;
    this.schedule(0);
  }

  /** 停止（用户显式关闭同步/登出） */
  stop(): void {
    this.userStopped = true;
    this.clearTimer();
    this.emit({ type: 'manual-stop' });
  }

  subscribe(fn: (e: SyncServiceEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 手动同步（与自动共享锁不重入） */
  async manualSync(): Promise<SyncResult> {
    this.statusInternal.autoStopped = false;
    return this.runOnce();
  }

  /** 立即全量备份 */
  async backupNow(): Promise<boolean> {
    if (this.running) return false;
    const deviceId = await this.engine.deviceId();
    if (!deviceId) return false;
    this.emit({ type: 'backup-start' });
    await this.engine.uploadBackup(deviceId);
    await this.engine.touchLastBackupAt();
    return true;
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(delayMs: number): void {
    this.clearTimer();
    if (this.userStopped) return;
    this.timer = setTimeout(() => {
      this.runOnce().finally(() => {
        if (this.userStopped || this.statusInternal.autoStopped) return;
        this.schedule(this.nextDelay());
      });
    }, delayMs);
  }

  /** 指数退避：base=interval，失败累加 ×2^(n-1)，cap 10min */
  private nextDelay(): number {
    const base = Math.max(5000, this.opts.getInterval() || 30000);
    const failures = this.statusInternal.consecutiveFailures;
    if (failures >= MAX_FAILURES) {
      this.statusInternal.autoStopped = true;
      this.emit({ type: 'auto-stop' });
      return 0;
    }
    if (failures <= 0) return base;
    return Math.min(base * 2 ** (failures - 1), BACKOFF_CAP_MS);
  }

  private async runOnce(): Promise<SyncResult> {
    if (this.running) return this.statusInternal.lastResult ?? { pushed: 0, pulled: 0, applied: 0 };
    this.running = true;
    this.emit({ type: 'start' });
    try {
      const result = await this.engine.syncNow();
      this.statusInternal.consecutiveFailures = 0;
      this.statusInternal.lastSyncAt = new Date().toISOString();
      this.statusInternal.lastResult = result;
      this.statusInternal.lastError = null;
      this.emit({ type: 'done', result });
      return result;
    } catch (e) {
      this.statusInternal.consecutiveFailures++;
      this.statusInternal.lastError = e instanceof Error ? e.message : String(e);
      this.emit({ type: 'error', message: this.statusInternal.lastError });
      throw e;
    } finally {
      this.running = false;
    }
  }

  private emit(e: SyncServiceEvent): void {
    for (const fn of this.listeners) fn(e);
  }
}