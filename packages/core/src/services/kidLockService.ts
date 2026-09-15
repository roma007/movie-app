import type { DatabaseProvider } from '../db/provider';
import type { MediaType } from '../types';
import { isChildSafe, KID_SAFE_RULES_VERSION } from '../utils/kidSafe';
import { SystemConfigService } from './systemConfigService';

const CONFIG_PIN_HASH = 'parental.pinHash';
const CONFIG_PIN_SALT = 'parental.salt';
const CONFIG_BACKFILLED = 'db.kidSafeBackfilled';
const CONFIG_RULES_VERSION = 'db.kidSafeRulesVersion';

/**
 * 儿童锁服务（两端共享）。
 *
 * - PIN 以「已哈希串」形式传入：桌面端由 Tauri webview 的 crypto.subtle 计算 SHA-256+盐，
 *   移动端由 expo-crypto 计算，core 层只做字符串存储与比对，保持平台中立。
 * - 儿童模式状态为系统数据源：SystemConfigService 读写 `parental.kidMode`，
 *   并通过 provider 的 getKidModeActive()/setKidModeActive() 维持查询侧内存缓存。
 */
export class KidLockService {
  private config: SystemConfigService;

  constructor(private db: DatabaseProvider) {
    this.config = new SystemConfigService(db);
  }

  async hasPin(): Promise<boolean> {
    return (await this.config.getString(CONFIG_PIN_HASH, '')).length > 0;
  }

  async setPin(pinHash: string, salt: string): Promise<void> {
    await this.config.setString(CONFIG_PIN_HASH, pinHash);
    await this.config.setString(CONFIG_PIN_SALT, salt);
  }

  async getSalt(): Promise<string> {
    return this.config.getString(CONFIG_PIN_SALT, '');
  }

  async verifyPin(pinHash: string): Promise<boolean> {
    const stored = await this.config.getString(CONFIG_PIN_HASH, '');
    if (!stored) return false;
    return stored === pinHash;
  }

  async isEnabled(): Promise<boolean> {
    return this.db.getKidModeActive();
  }

  async enable(): Promise<void> {
    await this.db.setKidModeActive(true);
  }

  async disable(): Promise<void> {
    await this.db.setKidModeActive(false);
  }

  /**
   * 是否已完成回填且与当前判定规则一致。
   * 除标记外还校验：
   * - 是否残留未评估行（兼容历史 OFFSET 分页 bug 留下的「标记已置但仍有 NULL」状态）；
   * - 是否已按当前 KID_SAFE_RULES_VERSION 重标（词表升级后需全量重估，见 backfillKidSafe）。
   */
  async isBackfilled(): Promise<boolean> {
    const flagged = (await this.config.getString(CONFIG_BACKFILLED, '')) === '1';
    if (!flagged) return false;
    if ((await this.config.getString(CONFIG_RULES_VERSION, '')) !== KID_SAFE_RULES_VERSION) {
      return false;
    }
    const row = await this.db.selectOne<{ c: number }>(
      'SELECT COUNT(*) as c FROM media WHERE kid_safe IS NULL'
    );
    return (row?.c || 0) === 0;
  }

  /**
   * 存量数据回填/重估 kid_safe（幂等）。
   * - 规则版本不一致 → 对全部 media 按最新词表重算（词表升级自动全量重标）；
   * - 版本一致且仍有 NULL → 仅增量补齐（兼容历史 OFFSET bug 的残留行）。
   * 处理完毕才写 db.kidSafeBackfilled 标记与当前规则版本。
   */
  async backfillKidSafe(progress?: (done: number, total: number) => void): Promise<void> {
    if (await this.isBackfilled()) return;

    const needsFullRemark =
      (await this.config.getString(CONFIG_RULES_VERSION, '')) !== KID_SAFE_RULES_VERSION;
    const whereClause = needsFullRemark ? '' : 'WHERE kid_safe IS NULL';

    const totalRow = await this.db.selectOne<{ c: number }>(
      `SELECT COUNT(*) as c FROM media ${whereClause}`
    );
    const total = totalRow?.c || 0;
    if (total === 0) {
      await this.config.setString(CONFIG_BACKFILLED, '1');
      await this.config.setString(CONFIG_RULES_VERSION, KID_SAFE_RULES_VERSION);
      return;
    }

    const BATCH = 400;
    let done = 0;
    let lastRowId = 0;
    for (;;) {
      // keyset 分页（按 rowid 推进）：全量重标时结果集不因 UPDATE 收缩，
      // 不能用「LIMIT 400 不偏移」的增量写法（会无限重处理同一批）；
      // 增量补 NULL 路径同样安全（收缩集在 lastRowId 左侧，不影响推进）。
      const rows = await this.db.select<
        {
          rowid: number;
          id: string;
          title: string;
          type: MediaType;
          genre: string | null;
          description: string | null;
        }
      >(
        needsFullRemark
          ? 'SELECT rowid, id, title, type, genre, description FROM media WHERE rowid > ? ORDER BY rowid LIMIT ?'
          : 'SELECT rowid, id, title, type, genre, description FROM media WHERE kid_safe IS NULL AND rowid > ? ORDER BY rowid LIMIT ?',
        [lastRowId, BATCH]
      );
      if (rows.length === 0) break;

      const safeIds: string[] = [];
      const unsafeIds: string[] = [];
      for (const r of rows) {
        let genres: string[] = [];
        if (r.genre) {
          try {
            const g = JSON.parse(r.genre);
            if (Array.isArray(g)) genres = g;
          } catch {
            // invalid json -> 空
          }
        }
        if (isChildSafe({ title: r.title, type: r.type, genres, description: r.description })) {
          safeIds.push(r.id);
        } else {
          unsafeIds.push(r.id);
        }
      }
      if (safeIds.length > 0) {
        await this.db.execute(
          `UPDATE media SET kid_safe = 1 WHERE id IN (${safeIds.map(() => '?').join(',')})`,
          safeIds
        );
      }
      if (unsafeIds.length > 0) {
        await this.db.execute(
          `UPDATE media SET kid_safe = 0 WHERE id IN (${unsafeIds.map(() => '?').join(',')})`,
          unsafeIds
        );
      }
      done += rows.length;
      lastRowId = rows[rows.length - 1].rowid;
      progress?.(done, total);
    }

    await this.config.setString(CONFIG_BACKFILLED, '1');
    await this.config.setString(CONFIG_RULES_VERSION, KID_SAFE_RULES_VERSION);
  }
}