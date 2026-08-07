// 子类型（genre 数组内元素）噪音过滤。
// 数据源站的 genre 数组除真实分类外，还混有年份、术语代码、人名、
// 编辑标签、剧名碎片等噪音。getSubTypesByType 全量展开后需过滤，
// 桌面端/移动端共用本模块保证语义一致。

// 白名单式黑名单：仅收录明确无用的词。
// 保留规则：XX剧 / XX片 / XX动漫 / XX综艺 等剧种词属于合法分类，不列入。
export const NOISE_SUBTYPES: ReadonlySet<string> = new Set([
  // 国家/地区（独立成词的才删）
  '中国大陆', '美国', '法国', '英国', '日本', '韩国', '泰国', '印度', '瑞典',
  '台湾', '香港', '意大利', '西班牙', '俄罗斯', '澳大利亚', '加拿大',
  '欧美', '海外', '国产', '大陆', '内地', '亚洲', '欧洲', '美洲',
  // 人名（制作/主持/嘉宾）
  '晏吉', '火树', '郭文韬', '林默语',
  // 源站编辑标签/剧名碎片
  '卫视', '向前', '女生', '上限', '之巅', '修为', '师尊', '徒弟', '开局',
  '开挂', '化身', '反转', '排解', '矛盾', '体验', '实景', '天灾', '末世',
  '末日', '泡面', '脑洞', '节目', '规则', '行动', '转职', '逆袭', '采访',
  '纠纷', '第七', '第三', '密神', '密室', '庭前', '玩晚会', '公益晚会',
  '宅门风云', '零元购', '遇强则强', '重来人生', '深度访谈', '明星访谈',
  '访谈节目', '演播室', '演唱会', '音乐会', '晚会', '虐心', '惊梀', '热血战',
  '第三调解室', '跨物种对决', '合家欢剧场',
]);

// 判断单个词是否为噪音。
export function isNoiseSubtype(token: string): boolean {
  const t = token.trim();
  if (!t) return true;
  // 年份 / 纯数字
  if (/^\d+$/.test(t)) return true;
  // 术语代码：TV / 2D / CSM
  if (/^[A-Za-z0-9]+$/.test(t)) return true;
  // 含全半角标点（通常是整剧名：xxx！xxx / xxx：xxx）
  if (/[：:！!？?，,。.；;]/.test(t)) return true;
  // 超长串（整剧名/动态漫标题）
  if (t.length > 6) return true;
  return NOISE_SUBTYPES.has(t);
}

// 展开 genre 数组的全部元素：复合串（"剧情 / 动作"、"都市 剧情"）拆分后
// 逐词过滤，去重排序。genres 为数据库读取到的 genre JSON 字符串集合。
export function expandSubTypes(genres: Iterable<string | null | undefined>): string[] {
  const out = new Set<string>();
  const pushRaw = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '[]') return;
    let arr: unknown;
    try {
      arr = JSON.parse(trimmed);
    } catch {
      arr = null;
    }
    const source = Array.isArray(arr) ? arr : [trimmed];
    for (const item of source) {
      if (typeof item !== 'string') continue;
      for (const part of item.split(/[/、·／\s]+/)) {
        const t = part.trim();
        if (!t || isNoiseSubtype(t)) continue;
        out.add(t);
      }
    }
  };
  for (const genre of genres) {
    if (genre) pushRaw(genre);
  }
  return Array.from(out).sort();
}
