import type { DatabaseProvider } from '../db/provider';
import type { ImportSourceItem, ParsedImportSource, VideoSource } from '../types';

const CODE_REGEX = /^[a-zA-Z0-9_]{2,50}$/;

function generateId(code: string): string {
  return `source_${code}`;
}

export class SourceImportService {
  constructor(private db: DatabaseProvider) {}

  static parseJson(jsonStr: string): { items: ImportSourceItem[]; errors: { index: number; message: string }[] } {
    const errors: { index: number; message: string }[] = [];
    let parsed: any;

    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return { items: [], errors: [{ index: -1, message: 'JSON 格式错误，请检查是否为合法的 JSON 字符串' }] };
    }

    if (!Array.isArray(parsed)) {
      return { items: [], errors: [{ index: -1, message: '数据格式错误，应为 JSON 数组 [...]' }] };
    }

    if (parsed.length === 0) {
      return { items: [], errors: [{ index: -1, message: '数组为空，未找到任何视频源数据' }] };
    }

    if (parsed.length > 20) {
      return { items: [], errors: [{ index: -1, message: `一次最多导入 20 个视频源，当前 ${parsed.length} 个` }] };
    }

    const items: ImportSourceItem[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const raw = parsed[i];
      if (!raw || typeof raw !== 'object') {
        errors.push({ index: i, message: `第 ${i + 1} 项不是有效的对象` });
        continue;
      }
      items.push({
        name: raw.name,
        code: raw.code,
        baseUrl: raw.baseUrl,
        rateLimit: raw.rateLimit,
        priority: raw.priority,
      });
    }

    return { items, errors };
  }

  static validateItem(item: ImportSourceItem): string[] {
    const errors: string[] = [];

    if (!item.name || typeof item.name !== 'string' || !item.name.trim()) {
      errors.push('名称(name)不能为空');
    }

    if (!item.code || typeof item.code !== 'string') {
      errors.push('编码(code)不能为空');
    } else if (!CODE_REGEX.test(item.code)) {
      errors.push('编码(code)格式无效，仅允许字母、数字和下划线，长度 2-50');
    }

    if (!item.baseUrl || typeof item.baseUrl !== 'string' || !item.baseUrl.trim()) {
      errors.push('API 地址(baseUrl)不能为空');
    } else {
      try {
        new URL(item.baseUrl);
      } catch {
        errors.push('API 地址(baseUrl)不是合法的 URL 格式');
      }
    }

    if (item.rateLimit != null) {
      const rl = Number(item.rateLimit);
      if (!Number.isInteger(rl) || rl < 1 || rl > 5) {
        errors.push('速率限制(rateLimit)须为 1-5 的整数');
      }
    }

    if (item.priority != null) {
      const pr = Number(item.priority);
      if (!Number.isInteger(pr) || pr < 1 || pr > 100) {
        errors.push('优先级(priority)须为 1-100 的整数');
      }
    }

    return errors;
  }

  static applyDefaults(item: ImportSourceItem): ImportSourceItem {
    return {
      ...item,
      code: item.code.trim(),
      baseUrl: item.baseUrl.trim(),
      rateLimit: item.rateLimit ?? 2,
      priority: item.priority ?? 5,
    };
  }

  async validateAndDedup(items: ImportSourceItem[]): Promise<ParsedImportSource[]> {
    const existing = await this.db.getAllVideoSources();

    const seenCode = new Map<string, number>();
    const seenUrl = new Map<string, number>();

    const result: ParsedImportSource[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = SourceImportService.applyDefaults(items[i]);
      const fieldErrors = SourceImportService.validateItem(item);

      if (fieldErrors.length > 0) {
        result.push({ item, status: 'invalid_field', errors: fieldErrors });
        continue;
      }

      const code = item.code;
      const url = item.baseUrl;

      const existingByCode = existing.find((s) => s.code === code);
      if (existingByCode) {
        result.push({
          item,
          status: 'code_exists',
          errors: [`编码 "${code}" 已存在（${existingByCode.name}）`],
          existingSource: existingByCode,
        });
        continue;
      }

      const existingByUrl = existing.find((s) => s.baseUrl === url);
      if (existingByUrl) {
        result.push({
          item,
          status: 'url_exists',
          errors: [`API 地址已存在（${existingByUrl.name}）`],
          existingSource: existingByUrl,
        });
        continue;
      }

      const prevCodeIdx = seenCode.get(code);
      if (prevCodeIdx !== undefined) {
        result.push({
          item,
          status: 'duplicate_in_list',
          errors: [`编码 "${code}" 在列表中第 ${prevCodeIdx + 1} 项已出现`],
        });
        continue;
      }

      const prevUrlIdx = seenUrl.get(url);
      if (prevUrlIdx !== undefined) {
        result.push({
          item,
          status: 'duplicate_in_list',
          errors: [`API 地址在列表中第 ${prevUrlIdx + 1} 项已出现`],
        });
        continue;
      }

      seenCode.set(code, i);
      seenUrl.set(url, i);

      result.push({ item, status: 'valid', errors: [] });
    }

    return result;
  }

  async batchImport(items: ImportSourceItem[]): Promise<{ imported: number; skipped: number; errors: { index: number; message: string }[] }> {
    let imported = 0;
    let skipped = 0;
    const errors: { index: number; message: string }[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = SourceImportService.applyDefaults(items[i]);
      const fieldErrors = SourceImportService.validateItem(item);
      if (fieldErrors.length > 0) {
        skipped++;
        errors.push({ index: i, message: `第 ${i + 1} 项 "${item.name || item.code}" ${fieldErrors.join('; ')}` });
        continue;
      }

      try {
        const existing = await this.db.getVideoSourceByCode(item.code);
        if (existing) {
          skipped++;
          errors.push({ index: i, message: `第 ${i + 1} 项 "${item.name}" 编码 "${item.code}" 已存在，跳过` });
          continue;
        }

        const source: VideoSource = {
          id: generateId(item.code),
          code: item.code,
          name: item.name.trim(),
          baseUrl: item.baseUrl,
          type: 'CMS',
          isEnabled: true,
          rateLimit: item.rateLimit ?? 2,
          priority: item.priority ?? 5,
          healthStatus: null,
          lastCheckAt: null,
        };

        await this.db.upsertVideoSource(source);
        imported++;
      } catch (err: any) {
        skipped++;
        errors.push({ index: i, message: `第 ${i + 1} 项 "${item.name}" 保存失败: ${err.message}` });
      }
    }

    return { imported, skipped, errors };
  }
}
