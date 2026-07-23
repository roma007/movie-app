import { Converter } from 'opencc-js';
import type { MediaType } from '../types';

export const DEFAULT_MIN_YEAR = 2025;

const converter = Converter({ from: 'tw', to: 'cn' });

const romanNumerals: Record<string, string> = {
  'Ⅰ': '1', 'Ⅱ': '2', 'Ⅲ': '3', 'Ⅳ': '4', 'Ⅴ': '5',
  'Ⅵ': '6', 'Ⅶ': '7', 'Ⅷ': '8', 'Ⅸ': '9', 'Ⅹ': '10',
  'Ⅺ': '11', 'Ⅻ': '12', 'ⅰ': '1', 'ⅱ': '2', 'ⅲ': '3',
  'ⅳ': '4', 'ⅴ': '5', 'ⅵ': '6', 'ⅶ': '7', 'ⅷ': '8',
  'ⅸ': '9', 'ⅹ': '10',
};

const extraVocabMap: Record<string, string> = {
  '軟體': '软件',
  '網路': '网络',
  '網站': '网站',
  '電腦': '电脑',
  '手機': '手机',
  '遊戲': '游戏',
  '音樂': '音乐',
  '圖片': '图片',
  '視頻': '视频',
  '程式': '程序',
  '資料': '数据',
  '訊息': '信息',
};

export class DataNormalizer {
  private minYear: number;

  constructor(minYear: number = DEFAULT_MIN_YEAR) {
    this.minYear = minYear;
  }

  setMinYear(minYear: number): void {
    this.minYear = minYear;
  }

  async toSimplified(text: string): Promise<string> {
    if (!text) return '';
    let result = text;
    for (const [tw, cn] of Object.entries(extraVocabMap)) {
      result = result.replace(new RegExp(tw, 'g'), cn);
    }
    result = converter(result);
    for (const [roman, arabic] of Object.entries(romanNumerals)) {
      result = result.replace(new RegExp(roman, 'g'), arabic);
    }
    return result;
  }

  normalizeYear(year: string | number): number | null {
    if (!year) return null;
    const str = String(year);
    if (str.startsWith('-')) return null;
    const match = str.match(/(\d{4})/);
    if (!match) return null;
    const num = parseInt(match[1], 10);
    return num >= this.minYear ? num : null;
  }

  async normalizeTitle(title: string): Promise<string> {
    if (!title) return '';
    let result = title
      .replace(/《/g, '')
      .replace(/》/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[\u200b\u200c\u200d\u200e\u200f\uFEFF]/g, '')
      .trim();
    result = await this.toSimplified(result);
    return result;
  }

  async normalizeGenres(genres: string[], mediaType: string): Promise<string[]> {
    if (!genres || genres.length === 0) return [];
    const simplified = await Promise.all(
      genres.filter(g => g != null).map(g => this.toSimplified(g.trim()))
    );
    const filtered = simplified.filter(g => {
      if (!g) return false;
      if (mediaType === 'MOVIE' && ['电视剧', '综艺', '动漫', '纪录片', '记录片', '纪录'].includes(g)) return false;
      if (mediaType === 'TV' && ['电影', '综艺', '动漫', '纪录片', '记录片', '纪录', 'AI漫剧', '漫剧'].includes(g)) return false;
      if (mediaType === 'VARIETY' && ['电影', '电视剧', '动漫', '纪录片', '记录片', '纪录', 'AI漫剧', '漫剧'].includes(g)) return false;
      if (mediaType === 'ANIME' && ['电影', '电视剧', '综艺', '纪录片', '记录片', '纪录', 'AI漫剧', '漫剧'].includes(g)) return false;
      if (mediaType === 'DOCUMENTARY' && ['电影', '电视剧', '综艺', '动漫', 'AI漫剧', '漫剧'].includes(g)) return false;
      return true;
    });
    return filtered;
  }

  async normalizePersonList(persons: string): Promise<string[]> {
    if (!persons) return [];
    const parts = persons.split(/[/,，、\s]+/).filter(p => p.trim().length > 0);
    const simplified = await Promise.all(
      parts.map(p => this.toSimplified(p.trim()))
    );
    return [...new Set(simplified.filter(p => p.length > 0))];
  }

  async normalizeArea(area: string): Promise<string | null> {
    if (!area) return null;
    let normalized = await this.toSimplified(area.trim());

    const invalidPatterns = [
      /年份[：:]/,
      /分类[：:]/,
      /类型[：:]/,
      /语言[：:]/,
      /主演[：:]/,
      /导演[：:]/,
      /简介[：:]/,
    ];

    for (const pattern of invalidPatterns) {
      if (pattern.test(normalized)) {
        return null;
      }
    }

    const areaMappings: Record<string, string> = {
      '内地': '中国大陆',
      '大陆': '中国大陆',
      '中国内地': '中国大陆',
      '中国': '中国大陆',
      '中国香港': '中国香港',
      '香港': '中国香港',
      '中国台湾': '中国台湾',
      '台湾': '中国台湾',
      '中国澳门': '中国澳门',
      '澳门': '中国澳门',
      '美国': '美国',
      '美利坚': '美国',
      '美利坚合众国': '美国',
      '英国': '英国',
      '大不列颠': '英国',
      '日本': '日本',
      '日本国': '日本',
      '韩国': '韩国',
      '南韩': '韩国',
      '大韩民国': '韩国',
      '朝鲜': '朝鲜',
      '北韩': '朝鲜',
      '泰国': '泰国',
      '泰王国': '泰国',
      '印度': '印度',
      '印度共和国': '印度',
      '法国': '法国',
      '法兰西': '法国',
      '德国': '德国',
      '德意志': '德国',
      '意大利': '意大利',
      '西班牙': '西班牙',
      '俄罗斯': '俄罗斯',
      '俄国': '俄罗斯',
      '加拿大': '加拿大',
      '澳大利亚': '澳大利亚',
      '澳洲': '澳大利亚',
      '新加坡': '新加坡',
      '马来西亚': '马来西亚',
      '印尼': '印度尼西亚',
      '印度尼西亚': '印度尼西亚',
      '越南': '越南',
      '菲律宾': '菲律宾',
      '柬埔寨': '柬埔寨',
      '缅甸': '缅甸',
      '老挝': '老挝',
      '文莱': '文莱',
      '新西兰': '新西兰',
      '荷兰': '荷兰',
      '比利时': '比利时',
      '瑞士': '瑞士',
      '瑞典': '瑞典',
      '挪威': '挪威',
      '丹麦': '丹麦',
      '芬兰': '芬兰',
      '波兰': '波兰',
      '奥地利': '奥地利',
      '葡萄牙': '葡萄牙',
      '爱尔兰': '爱尔兰',
      '希腊': '希腊',
      '土耳其': '土耳其',
      '以色列': '以色列',
      '伊朗': '伊朗',
      '阿联酋': '阿联酋',
      '沙特': '沙特阿拉伯',
      '沙特阿拉伯': '沙特阿拉伯',
      '墨西哥': '墨西哥',
      '巴西': '巴西',
      '阿根廷': '阿根廷',
      '智利': '智利',
      '哥伦比亚': '哥伦比亚',
      '委内瑞拉': '委内瑞拉',
      '南非': '南非',
      '埃及': '埃及',
      '尼日利亚': '尼日利亚',
    };

    const sortedAliases = Object.keys(areaMappings).sort((a, b) => b.length - a.length);

    for (const alias of sortedAliases) {
      const standard = areaMappings[alias];
      if (normalized === alias) {
        return standard;
      }
    }

    for (const alias of sortedAliases) {
      const standard = areaMappings[alias];
      if (normalized.includes(alias)) {
        return standard;
      }
    }

    return normalized;
  }

  stripHtml(html: string): string {
    if (!html) return '';
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\u200b|\u200c|\u200d|\u200e|\u200f|\uFEFF/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async normalizeDescription(description: string): Promise<string> {
    if (!description) return '';
    const stripped = this.stripHtml(description);
    const simplified = await this.toSimplified(stripped);
    return simplified.replace(/\s+/g, ' ').trim();
  }

  async generateFingerprint(
    title: string,
    year: number,
    type: MediaType,
    seasonNumber?: number
  ): Promise<string> {
    const simplified = await this.toSimplified(title);
    const cleanTitle = simplified
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]/g, '')
      .replace(/更新到第[一二三四五六七八九十百千\d]+集$/i, '')
      .replace(/更新至第[一二三四五六七八九十百千\d]+集$/i, '')
      .replace(/更新\d+集$/i, '')
      .replace(/第[一二三四五六七八九十百千\d]+季$/i, '')
      .replace(/season\s*\d+$/i, '')
      .replace(/\s+/g, '')
      .trim();

    const normalizedTitle = cleanTitle;

    if (type === 'MOVIE') {
      return `movie:${normalizedTitle}:${year}`;
    }

    const season = seasonNumber || 1;
    if (type === 'TV') {
      return `tv:${normalizedTitle}:${year}:s${season}`;
    }

    if (type === 'ANIME') {
      return `anime:${normalizedTitle}:${year}:s${season}`;
    }

    if (type === 'DOCUMENTARY') {
      return `documentary:${normalizedTitle}:${year}:s${season}`;
    }

    return `variety:${normalizedTitle}:${year}:s${season}`;
  }

  /**
   * 将 {N} 占位符模板转换为正则表达式。
   * {N} → (\d+)，支持多个 {N}（如范围模式 {N}-{N}分钟）。
   * 空格部分转换为 \s* 以容忍文本中的弹性空格。
   */
  private templateToRegex(template: string): RegExp {
    const parts = template.split('{N}');
    const escaped = parts.map(p => {
      const e = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return e.replace(/ /g, '\\s*');
    });
    const pattern = escaped.join('(\\d+)');
    return new RegExp(pattern, 'i');
  }

  extractDurationFromSummary(summary: string, patterns?: string[]): number | null {
    if (!summary) return null;

    const regexPatterns = (patterns || []).map(p => this.templateToRegex(p));

    for (const pattern of regexPatterns) {
      const match = summary.match(pattern);
      if (match) {
        const num1 = parseInt(match[1], 10);
        if (match[2]) {
          const num2 = parseInt(match[2], 10);
          return Math.round((num1 + num2) / 2);
        }
        return num1;
      }
    }

    return null;
  }

  isShortDramaByDuration(episodeDurationMinutes: number, threshold: number = 30): boolean {
    return episodeDurationMinutes < threshold;
  }

  isShortDramaByMeta(genres: string[], summary: string, title: string, keywords?: string[]): boolean {
    const metaKeywords = keywords || [];
    const shortDramaKeywords = metaKeywords.filter(k =>
      ['短剧', '微短剧', '竖屏', '短劇', '微短劇', '竪屏',
       '竖屏短剧', '竖屏剧', '短剧集', '竪屏短劇', '微短劇'].includes(k)
    );
    const summaryKeywords = metaKeywords.filter(k =>
      ['竖屏短剧', '微短剧', '竖屏剧', '短剧集', '竪屏短劇', '微短劇'].includes(k)
    );
    const titleKeywords = metaKeywords.filter(k =>
      !shortDramaKeywords.includes(k) && !summaryKeywords.includes(k)
    );

    for (const genre of genres) {
      for (const keyword of shortDramaKeywords) {
        if (genre.includes(keyword)) return true;
      }
    }

    if (summary) {
      for (const keyword of summaryKeywords) {
        if (summary.includes(keyword)) return true;
      }
    }

    if (title) {
      for (const keyword of titleKeywords) {
        if (title.includes(keyword)) return true;
      }

      const shortDramaPatterns = [
        /^.{1,15}[，,：:].{5,30}$/,
        /^.{1,10}[之].{5,25}$/,
        /^.{1,12}[的].{3,20}$/,
        /^[从在自].{2,10}[到成变].{5,30}$/,
      ];

      for (const pattern of shortDramaPatterns) {
        if (pattern.test(title)) return true;
      }
    }

    return false;
  }

  extractSeriesGroup(fingerprint: string): string | null {
    const match = fingerprint.match(/^([a-z]+:[^:]+):\d{4}:s\d+$/);
    return match ? match[1] : null;
  }

  extractSeriesSeason(fingerprint: string): number | null {
    const match = fingerprint.match(/:s(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  }

  extractSeasonNumber(title: string): number | null {
    if (!title) return null;

    const cnMatch = title.match(/第([一二三四五六七八九十百千]+)季/);
    if (cnMatch) {
      return this.chineseNumberToInt(cnMatch[1]);
    }

    const numMatch = title.match(/第(\d+)季/);
    if (numMatch) {
      return parseInt(numMatch[1], 10);
    }

    const seasonMatch = title.match(/season\s*(\d+)/i);
    if (seasonMatch) {
      return parseInt(seasonMatch[1], 10);
    }

    const sMatch = title.match(/\bS(\d+)\b/i);
    if (sMatch) {
      return parseInt(sMatch[1], 10);
    }

    return null;
  }

  private chineseNumberToInt(cn: string): number {
    const map: Record<string, number> = {
      '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
      '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
      '十': 10, '百': 100, '千': 1000,
    };

    let result = 0;
    let temp = 0;

    for (let i = 0; i < cn.length; i++) {
      const char = cn[i];
      const num = map[char];

      if (num === undefined) continue;

      if (num >= 10) {
        if (temp === 0) temp = 1;
        result += temp * num;
        temp = 0;
      } else {
        temp = num;
      }
    }

    result += temp;
    return result || 1;
  }
}

export const normalizer = new DataNormalizer();
export default normalizer;
