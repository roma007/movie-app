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
  '足球', '篮球', '排球', '网球', '羽毛球', '乒乓球', '橄榄球', '棒球',
  '高尔夫', '斯诺克', '台球', '体育', '运动', '赛事', '比赛', '决赛',
  '半决赛', '预告片', '预告', '先行预告', '前瞻', '幕后花絮', '花絮',
  '特辑', '纪录片预告', '预告版', '预告篇',
];

export const MIN_YEAR = 2025;
