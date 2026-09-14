import type { MediaType } from '../types';

/**
 * 儿童适龄判定规则（黑+白结合）。
 *
 * 优先级：
 * 1. 黑名单一票否决：title/description/genres 命中成人或暴力惊悚恐怖关键词 → 判定不适合儿童（kid_safe=0）。
 * 2. 白名单高置信：未命中黑名单，且 type 为动漫/纪录片，或命中少儿/卡通/益智/科普等词 → 适合（kid_safe=1）。
 * 3. 其余（普通剧情片等）默认适合（kid_safe=1），保持「黑名单过滤为主」的实用性取向。
 *
 * 词表为启发式，后续可在此集中校准。采集入库打标与存量回填共用本函数，口径一致。
 */

const ADULT_OR_VIOLENT_KEYWORDS = [
  // 成人向
  '里番', '伦理', '情色', '色情', '成人', '18禁', '限制级', '三级', '工口',
  '艳情', '风月', '儿童不宜', '少儿不宜',
  // 惊悚恐怖/血腥暴力向
  '恐怖', '惊悚', '血腥', '虐杀', '食人',
];

const CHILD_FRIENDLY_KEYWORDS = [
  '少儿', '儿童', '益智', '亲子', '学前', '幼儿', '卡通', '动画', '动漫', '科普', '绘本', '低幼',
];

const CHILD_FRIENDLY_TYPES: MediaType[] = ['ANIME', 'DOCUMENTARY'];

export function isChildSafe(input: {
  title?: string | null;
  type?: MediaType | null;
  genres?: string[];
  description?: string | null;
}): boolean {
  const haystack = [input.title, input.description, ...(input.genres || [])]
    .filter((x): x is string => !!x)
    .join(' ')
    .toLowerCase();

  if (ADULT_OR_VIOLENT_KEYWORDS.some((kw) => haystack.includes(kw))) return false;

  if (input.type && CHILD_FRIENDLY_TYPES.includes(input.type)) return true;
  if (CHILD_FRIENDLY_KEYWORDS.some((kw) => haystack.includes(kw))) return true;

  return true;
}