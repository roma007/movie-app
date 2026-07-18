export interface DefaultSourceConfig {
  name: string;
  code: string;
  baseUrl: string;
  priority: number;
  rateLimit: number;
}

export const defaultSources: DefaultSourceConfig[] = [
  {
    name: '魔都资源',
    code: 'mdzuzi',
    baseUrl: 'https://www.mdzyapi.com/api.php/provide/vod',
    priority: 10,
    rateLimit: 2,
  },
  {
    name: '百度云资源',
    code: 'baiduyunziyuan',
    baseUrl: 'https://api.apibdzy.com/api.php/provide/vod',
    priority: 8,
    rateLimit: 2,
  },
  {
    name: '量子资源',
    code: 'liangziziyuan',
    baseUrl: 'http://cj.lziapi.com/api.php/provide/vod',
    priority: 7,
    rateLimit: 2,
  },
  {
    name: '无尽资源',
    code: 'wujinziziyuan',
    baseUrl: 'https://api.wujinapi.com/api.php/provide/vod',
    priority: 6,
    rateLimit: 2,
  },
  {
    name: '红牛资源',
    code: 'hongniuziyuan',
    baseUrl: 'https://www.hongniuzy3.com/api.php/provide/vod',
    priority: 5,
    rateLimit: 2,
  },
  {
    name: '电影天堂',
    code: 'dianyingtiantang',
    baseUrl: 'http://caiji.dyttzyapi.com/api.php/provide/vod',
    priority: 4,
    rateLimit: 2,
  },
];

export const BLACKLIST_KEYWORDS = [
  // 体育类
  '足球', '篮球', '排球', '网球', '羽毛球', '乒乓球', '橄榄球', '棒球',
  '高尔夫', '斯诺克', '台球', '体育', '运动', '赛事', '比赛', '决赛',
  '半决赛', '世界杯', '联赛', '锦标赛', '奥运', '奥运会',
  // 预告/花絮类
  '预告片', '预告', '先行预告', '前瞻', '幕后花絮', '花絮',
  '特辑', '纪录片预告', '预告版', '预告篇',
  // 成人内容
  '里番', '里番动漫', '伦理片', '情色', '成人',
];

export const MIN_YEAR = 2025;

export const SOURCE_ID_TO_NAME_MAP: Record<string, string> = {
  'source_mdzuzi': '魔都资源',
  'source_baiduyunziyuan': '百度云资源',
  'source_liangziziyuan': '量子资源',
  'source_wujinziziyuan': '无尽资源',
  'source_hongniuziyuan': '红牛资源',
  'source_dianyingtiantang': '电影天堂',
};

export const PLAY_SOURCE_TYPE_MAP: Record<string, string> = {
  'modum3u8': '正片',
  'dbm3u8': 'HD',
  'dytt': 'HD中字',
  'dyttm3u8': 'HD中字',
  'liangzi': 'HD中字',
  'lzm3u8': 'HD中字',
  'wjm3u8': 'HD',
  'hnyun': '正片',
  'hnm3u8': '正片',
};

export const AI_SOURCE_PROMPT = `你是一个视频源推荐专家。请提供 3-8 个当前可用的苹果CMS/海洋CMS视频采集源。

## 要求
1. 每个源必须提供完整的 API 地址（如 https://xxx.com/api.php/provide/vod）
2. API 地址必须真实可用，支持标准的苹果CMS接口（ac=list, ac=detail, ac=videolist）
3. 优先推荐国内可直接访问的源，无需科学上网
4. 源应多样化覆盖电影、电视剧、综艺、动漫等内容

## 输出格式
请严格按以下 JSON 数组格式输出，不要加任何额外文字和 markdown 代码块标记：

[
  {
    "name": "视频源名称",
    "code": "唯一英文编码（短小无空格）",
    "baseUrl": "CMS API 完整地址",
    "rateLimit": 2,
    "priority": 10
  }
]

## 参数说明
- name: 中文名称，如 "极速资源"
- code: 唯一英文标识，如 "jisuziyuan"
- baseUrl: API 地址，必须以 /api.php/provide/vod 结尾
- rateLimit: 并发数，1-5 之间的整数，建议 2
- priority: 优先级，数值越大越优先，建议 5-10

## 示例
[
  {
    "name": "示例资源",
    "code": "shiliziyuan",
    "baseUrl": "https://example.com/api.php/provide/vod",
    "rateLimit": 2,
    "priority": 8
  }
]`;

export const AI_SOURCE_IMPORT_SAMPLE = JSON.stringify([
  {
    name: '极速资源',
    code: 'jisuziyuan',
    baseUrl: 'https://api.jisuzy.com/api.php/provide/vod',
    rateLimit: 2,
    priority: 10,
  },
  {
    name: '酷云资源',
    code: 'kuyunzy',
    baseUrl: 'https://www.kuyunzy.com/api.php/provide/vod',
    rateLimit: 2,
    priority: 8,
  },
], null, 2);
