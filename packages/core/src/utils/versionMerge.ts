/**
 * 多语言/版本合并工具集。
 *
 * 语义（与留档《同名多版本与年份合并》一致）：
 * - 「版本条目」指标题尾部带语言后缀（或尾部年份=year）的独立 CMS 条目，
 *   归一后可并入标题为基准的同名主条目，形成「视频 → 语言 → 源 → 剧集 → 线路」层级。
 * - 合并不覆盖：版本条目走「只增不删」追加路径，只并入资源，不改写主条目。
 * - 未标明语言：按地区候选语言表推断（本地语言+国语 取首个未被已标版本占用者）。
 */

/** 语言词 → 标准语言名（长词优先匹配）。字幕类（中字/繁中/简中）不视为语言，不参与剥离。 */
const LANGUAGE_TERMS: ReadonlyArray<readonly [string, string]> = [
  ['国语配音', '国语'],
  ['普通话', '国语'],
  ['闽南语', '闽南语'],
  ['西班牙语', '西班牙语'],
  ['葡萄牙语', '葡萄牙语'],
  ['意大利语', '意大利语'],
  ['台配', '国语'],
  ['粤语', '粤语'],
  ['国语', '国语'],
  ['英语', '英语'],
  ['日语', '日语'],
  ['韩语', '韩语'],
  ['朝鲜语', '韩语'],
  ['法语', '法语'],
  ['德语', '德语'],
  ['俄语', '俄语'],
  ['泰语', '泰语'],
];

const LANGUAGE_TERMS_SORTED: ReadonlyArray<readonly [string, string]> = [...LANGUAGE_TERMS].sort(
  (a, b) => b[0].length - a[0].length,
);

const BRACKET_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['（', '）'],
  ['(', ')'],
  ['[', ']'],
  ['【', '】'],
];

/** 从一组文本中提取首个命中的语言名；未命中返回 null。 */
export function extractLanguage(...texts: Array<string | null | undefined>): string | null {
  for (const t of texts) {
    if (!t) continue;
    for (const [term, lang] of LANGUAGE_TERMS_SORTED) {
      if (t.includes(term)) return lang;
    }
  }
  return null;
}

/**
 * URL 短哈希（djb2，8 位 hex）。
 * 合并路径的 play_source id 用 `ps_<episodeId>_<hash>`：同 url 幂等、不同 url 唯一，
 * 无需计数，天然满足「不同版本同集不同 url 各自保留为多线路」。
 */
export function shortUrlHash(url: string): string {
  let h = 5381;
  for (let i = 0; i < url.length; i++) {
    h = ((h << 5) + h + url.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * 地区 → 候选语言表（本地语言 + 国语；第一项为该地区默认语言）。
 * key 对齐 normalizer.normalizeArea 的标准名。
 */
export const REGION_LANGUAGE_CANDIDATES: Record<string, string[]> = {
  中国香港: ['粤语', '国语'],
  中国大陆: ['国语'],
  中国台湾: ['国语', '闽南语'],
  美国: ['英语', '国语'],
  英国: ['英语'],
  日本: ['日语', '国语'],
  韩国: ['韩语', '国语'],
  朝鲜: ['韩语', '国语'],
  法国: ['法语', '国语'],
  德国: ['德语', '国语'],
  俄罗斯: ['俄语', '国语'],
  泰国: ['泰语', '国语'],
  西班牙: ['西班牙语', '国语'],
  意大利: ['意大利语', '国语'],
  葡萄牙: ['葡萄牙语', '国语'],
};

/** 地区关键词 → 关键命中名（用于 area 为富文本时的容错匹配，如「中国香港（TVB）」） */
const REGION_KEYWORDS: ReadonlyArray<[string, string]> = [
  ['中国台湾', '台湾'],
  ['中国香港', '香港'],
  ['中国大陆', '大陆'],
  ['中国大陆', '内地'],
  ['西班牙', '西班牙'],
  ['葡萄牙', '葡萄牙'],
  ['意大利', '意大利'],
  ['俄罗斯', '俄罗斯'],
  ['韩国', '韩国'],
  ['朝鲜', '朝鲜'],
  ['美国', '美国'],
  ['英国', '英国'],
  ['日本', '日本'],
  ['法国', '法国'],
  ['德国', '德国'],
  ['泰国', '泰国'],
];

export function regionLanguageCandidates(area?: string | null): string[] | null {
  if (!area) return null;
  if (REGION_LANGUAGE_CANDIDATES[area]) return REGION_LANGUAGE_CANDIDATES[area];
  for (const [standard, keyword] of REGION_KEYWORDS) {
    if (area.includes(keyword)) return REGION_LANGUAGE_CANDIDATES[standard];
  }
  return null;
}

/** 地区默认语言 = 候选第一项（香港→粤语、大陆→国语…），无映射返回 null。 */
export function regionDefaultLanguage(area?: string | null): string | null {
  const candidates = regionLanguageCandidates(area);
  return candidates?.[0] || null;
}

/**
 * 未标明语言版本的推断：候选集中取首个未被已标版本占用的语言；
 * 候选集全被占用时取地区默认语言。无地区映射返回 null（不推断）。
 */
export function inferLanguageForUnlabeled(
  area?: string | null,
  labelled: ReadonlySet<string> = new Set(),
): string | null {
  const candidates = regionLanguageCandidates(area);
  if (!candidates || candidates.length === 0) return null;
  for (const c of candidates) {
    if (!labelled.has(c)) return c;
  }
  return candidates[0];
}

/** 剥离标题尾部的一个语言版本片段（括号内或裸词），返回剥离后标题；无命中返回 null。 */
function stripOneVersionTail(title: string): string | null {
  for (const [open, close] of BRACKET_PAIRS) {
    if (!title.endsWith(close)) continue;
    const innerStart = title.lastIndexOf(open);
    if (innerStart < 0) continue;
    const inner = title.slice(innerStart + open.length, -close.length).trim();
    if (!inner) continue;
    for (const [term] of LANGUAGE_TERMS_SORTED) {
      if (inner === term || inner === `${term}版` || inner === `${term}版本` || inner === `${term}配音`) {
        return title.slice(0, innerStart).trimEnd();
      }
    }
  }

  for (const [term] of LANGUAGE_TERMS_SORTED) {
    if (title.endsWith(term)) return title.slice(0, -term.length).trimEnd();
    if (title.endsWith(`${term}版`)) return title.slice(0, -term.length - 1).trimEnd();
    if (title.endsWith(`${term}版本`)) return title.slice(0, -term.length - 2).trimEnd();
  }

  return null;
}

/** 循环剥离标题尾部语言版本片段（如「功夫粤语」→「功夫」、「大内密探零零发（国语版）」→「大内密探零零发」）。 */
export function stripVersionSuffix(title: string): string {
  let cur = title.trim();
  for (let i = 0; i < 4; i++) {
    const next = stripOneVersionTail(cur);
    if (next === null || next === cur || next === '') break;
    cur = next;
  }
  return cur;
}

/**
 * 剥离标题尾部与 year 完全相等的 4 位年份（仅「交锋2026」这类尾部等于条目年份的情况）。
 * 其余位置年份（如「法国空姐2018」year≠2018）不动，避免误伤。
 */
export function stripTrailingYear(title: string, year?: number | null): string {
  if (!year) return title;
  const out = title.replace(new RegExp(`${year}$`), '').trimEnd();
  if (!out) return title;
  return out;
}

export interface BaseTitleResult {
  /** 剥离语言后缀/尾部年份后的基准标题 */
  baseTitle: string;
  /** 基准标题与原始标题不同 → 这是一条可合并的「版本条目」候选 */
  isVersionItem: boolean;
}

/** 计算基准标题（成对合并用；是否真的并入由调用方按「成对校验」决定）。 */
export function computeBaseTitle(title: string, year?: number | null): BaseTitleResult {
  const baseTitle = stripTrailingYear(stripVersionSuffix(title), year);
  return {
    baseTitle,
    isVersionItem: baseTitle !== title,
  };
}