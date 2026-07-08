# APP 移植指南

> 本文档记录从 `movie`（网站服务模式）移植到 `movie-app`（纯客户端APP模式）的完整清单。
> 原项目路径：`/Users/mengfeng/我的文档/源码/movie`

## 一、架构变更说明

### 原架构（movie 项目）
```
用户 → 浏览器 → 后端API(Fastify) → 视频源CMS API
                    ↓
              PostgreSQL / Redis / MeiliSearch / BullMQ
```

### 新架构（movie-app 项目）
```
用户 → APP → 直接调用视频源CMS API
        ↓
    本地SQLite缓存
```

### 丢弃的组件
- ❌ Fastify 后端
- ❌ PostgreSQL + Prisma
- ❌ Redis
- ❌ MeiliSearch
- ❌ BullMQ 任务队列
- ❌ HLS 代理
- ❌ Docker / Nginx
- ❌ Prometheus / Grafana / Loki
- ❌ 管理后台（Admin）
- ❌ 认证服务（JWT）

## 二、技术选型

| 模块 | 技术 | 说明 |
|------|------|------|
| 框架 | React Native + Expo | 跨平台，复用React知识 |
| iOS/Android | Expo | 管理原生构建 |
| Mac/Windows | Tauri 或 Electron | 桌面端 |
| 数据存储 | SQLite (expo-sqlite) | 本地数据库 |
| 搜索 | SQLite FTS5 | 全文搜索 |
| 视频播放 | expo-av / react-native-video | HLS播放 |
| 网络请求 | Axios 或 fetch | 兼容RN |
| 繁简转换 | opencc-js | 已有JS版本 |
| 路由 | React Navigation | RN标准路由 |
| 状态管理 | Zustand | 轻量级 |

## 三、可直接移植的代码（纯TS，不依赖React/DOM/Node）

以下文件可直接复制到新项目，稍作适配即可使用：

### 3.1 CMS适配器
- **源文件**：`server/src/collectors/adapters/cmsAdapter.ts`
- **功能**：调用视频源CMS API（列表、详情、搜索）
- **适配**：去掉对 Node.js `fetch` 的依赖，改用 RN 的 fetch/Axios
- **关键接口**：
  - `getList(page, pageSize)` — 获取视频列表
  - `getDetail(id)` — 获取视频详情
  - `search(keyword, page)` — 按关键词搜索

### 3.2 类型映射
- **源文件**：`server/src/collectors/normalizer/typeMapper.ts`
- **功能**：将视频源的类型名称映射为标准类型（MOVIE/TV/VARIETY/ANIME/DOCUMENTARY）
- **适配**：无需修改，直接复制

### 3.3 数据标准化
- **源文件**：`server/src/collectors/normalizer/index.ts`
- **功能**：标题标准化、繁简转换、年份提取、地区标准化、类型过滤、指纹生成
- **适配**：
  - 去掉对 `config.collection.minYear` 的依赖，改为常量或本地配置
  - opencc-js 在 RN 中可直接使用
- **关键方法**：
  - `toSimplified(text)` — 繁转简
  - `normalizeTitle(title)` — 标题标准化
  - `normalizeYear(year)` — 年份提取
  - `normalizeArea(area)` — 地区标准化
  - `normalizeGenres(genres, mediaType)` — 类型标准化
  - `normalizePersonList(persons)` — 演员/导演标准化
  - `generateFingerprint(title, year, type, season)` — 指纹生成（去重用）
  - `extractSeasonNumber(title)` — 提取季数
  - `isShortDramaByDuration(duration)` — 短剧判断
  - `isShortDramaByMeta(genres, description, title)` — 短剧判断（元数据）

### 3.4 令牌桶（速率限制）
- **源文件**：`server/src/collectors/utils/tokenBucket.ts`
- **功能**：控制请求频率，防止触发反爬
- **适配**：无需修改，直接复制

### 3.5 类型定义
- **源文件**：`server/src/types/index.ts`
- **功能**：API响应、分页等类型定义
- **适配**：可能需要新增APP专用的类型

## 四、需要适配的逻辑

### 4.1 采集服务
- **源文件**：`server/src/collectors/collectorService.ts`
- **功能**：采集视频源数据并入库
- **适配**：
  - 去掉 Prisma，改为 SQLite 操作
  - 去掉 MeiliSearch 索引，改为 SQLite FTS 索引
  - 去掉 BullMQ 队列，改为直接执行或本地任务管理
  - 保留核心逻辑：年份过滤、黑名单过滤、指纹去重、分集/播放源创建
- **关键方法**：
  - `processItem(adapter, item, sourceId, sourceName, ...)` — 处理单条视频
  - `collectByKeyword(keyword)` — 按关键词搜索采集
  - 黑名单检查逻辑（`isBlacklisted`）

### 4.2 采集配置
- **源文件**：`server/src/services/collectConfigService.ts`
- **功能**：采集参数配置（并发数、最大页数、黑名单关键词等）
- **适配**：改为本地存储（AsyncStorage / SQLite）

### 4.3 视频时长检测
- **源文件**：`server/src/services/videoDurationService.ts`
- **功能**：检测视频时长用于短剧判断
- **适配**：在RN中用 expo-av 获取时长

## 五、需要参考UI但重写的页面

以下页面需要用 React Native 组件重写（不能复用HTML/CSS）：

### 5.1 首页
- **源文件**：`web/src/pages/Home.tsx`
- **功能**：轮播图、分类导航、热门推荐、最新上线
- **RN组件**：ScrollView / FlatList / 轮播图组件

### 5.2 媒体详情页
- **源文件**：`web/src/pages/MediaDetail.tsx`
- **功能**：海报、标题、年份、地区、类型、演员、导演、简介、分集列表、播放源选择
- **RN组件**：ScrollView / Image / Text / TouchableOpacity

### 5.3 播放页
- **源文件**：`web/src/pages/Play.tsx`
- **功能**：视频播放器、选集、播放源切换
- **RN组件**：expo-av / VideoPlayer自定义组件

### 5.4 搜索页
- **源文件**：`web/src/pages/Search.tsx`
- **功能**：搜索框、热门搜索、搜索建议、搜索结果
- **RN组件**：TextInput / FlatList

### 5.5 排行榜
- **源文件**：`web/src/pages/Ranking.tsx`
- **功能**：按类型查看排行榜
- **RN组件**：FlatList / TabView

### 5.6 媒体列表
- **源文件**：`web/src/pages/MediaList.tsx`
- **功能**：按类型/地区/年份筛选浏览
- **RN组件**：FlatList / 筛选器组件

### 5.7 标签页
- **源文件**：`web/src/pages/Tags.tsx`
- **功能**：按标签浏览
- **RN组件**：FlatList

### 5.8 视频播放器组件
- **源文件**：`web/src/components/player/VideoPlayer.tsx`
- **功能**：Plyr播放器、进度条、控制栏、缓存预加载
- **RN组件**：expo-av 自定义控制UI
- **注意**：Plyr 不能在 RN 中使用，需要完全重写

## 六、APP特有功能（原项目没有）

### 6.1 视频源管理
- APP内置默认视频源列表
- 用户可添加/删除/排序视频源
- 视频源健康检查

### 6.2 本地收藏/观看历史
- 收藏夹（本地SQLite存储）
- 观看历史（本地SQLite存储）
- 观看进度记录

### 6.3 离线浏览
- 已采集的视频信息可离线浏览
- 海报图片缓存

### 6.4 设置页
- 采集配置（并发数、最大页数）
- 黑名单关键词管理
- 清除缓存
- 关于/版本信息

## 七、数据模型（SQLite）

参考原项目的 Prisma schema（`server/prisma/schema.prisma`），适配为 SQLite 表结构：

```sql
-- 媒体表
CREATE TABLE media (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  original_title TEXT,
  alias TEXT,
  type TEXT NOT NULL,        -- MOVIE/TV/VARIETY/ANIME/DOCUMENTARY
  year INTEGER NOT NULL,     -- >= 2025
  area TEXT,
  genre TEXT,                -- JSON array
  director TEXT,             -- JSON array
  cast TEXT,                 -- JSON array
  description TEXT,
  poster_url TEXT,
  backdrop_url TEXT,
  status TEXT,               -- PUBLISHED/ONGOING/COMPLETED
  fingerprint TEXT UNIQUE,   -- 去重用
  current_episodes INTEGER,
  total_episodes INTEGER,
  is_short_drama INTEGER,    -- 0/1
  view_count INTEGER DEFAULT 0,
  favorite_count INTEGER DEFAULT 0,
  search_count INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

-- 分集表
CREATE TABLE episode (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL,
  season_number INTEGER DEFAULT 1,
  episode_number INTEGER NOT NULL,
  title TEXT,
  duration INTEGER,
  FOREIGN KEY (media_id) REFERENCES media(id)
);

-- 播放源表
CREATE TABLE play_source (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_name TEXT,
  url TEXT NOT NULL,
  quality TEXT,
  FOREIGN KEY (episode_id) REFERENCES episode(id)
);

-- 视频源表
CREATE TABLE video_source (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  type TEXT DEFAULT 'CMS',
  is_enabled INTEGER DEFAULT 1,
  rate_limit INTEGER DEFAULT 5,
  priority INTEGER DEFAULT 0,
  health_status TEXT,
  last_check_at TEXT
);

-- 收藏表
CREATE TABLE favorite (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL,
  created_at TEXT
);

-- 观看历史表
CREATE TABLE watch_history (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL,
  episode_id TEXT,
  progress INTEGER,         -- 播放进度（秒）
  duration INTEGER,         -- 总时长（秒）
  updated_at TEXT
);

-- 全文搜索索引
CREATE VIRTUAL TABLE media_fts USING fts5(
  title, alias, original_title, director, cast,
  content='media',
  content_rowid='rowid'
);
```

## 八、业务约束（必须遵守）

以下约束从原项目继承，在APP中同样适用：

1. **只收录2025年及以后的视频内容**
2. **不存储视频文件**，仅聚合第三方来源
3. **繁简转换必须使用 opencc-js**
4. **媒体指纹**必须包含类型、标准化标题、年份；电视剧/综艺须保留季/集标识
5. **视频源过滤**：排除类型名含「足球」「篮球」「预告片」等关键词的内容
6. **黑名单关键词**：足球、篮球、排球、网球、羽毛球、乒乓球、橄榄球、棒球、高尔夫、斯诺克、台球、体育、运动、赛事、比赛、决赛、半决赛、预告片、预告、先行预告、前瞻、幕后花絮、花絮、特辑、纪录片预告、预告版、预告篇
7. **无普通用户注册/登录/支付/评论/点赞功能**
8. **用户界面隐藏技术细节**（如Cron表达式），提供直观的中文描述
9. **视频播放器控制栏**显示当前时间/总时长，不使用倒计时模式
10. **视频播放器**所有功能按钮集成在底部控制栏，无浮动按钮

## 九、参考文件路径速查

| 功能 | 原项目文件路径 |
|------|---------------|
| CMS适配器 | `server/src/collectors/adapters/cmsAdapter.ts` |
| 类型映射 | `server/src/collectors/normalizer/typeMapper.ts` |
| 数据标准化 | `server/src/collectors/normalizer/index.ts` |
| 采集服务 | `server/src/collectors/collectorService.ts` |
| 默认视频源 | `server/src/collectors/sources/defaults.ts` |
| 视频源管理 | `server/src/collectors/sources/manager.ts` |
| 令牌桶 | `server/src/collectors/utils/tokenBucket.ts` |
| 采集配置 | `server/src/services/collectConfigService.ts` |
| 视频时长检测 | `server/src/services/videoDurationService.ts` |
| Prisma Schema | `server/prisma/schema.prisma` |
| 类型定义 | `server/src/types/index.ts` |
| 首页UI | `web/src/pages/Home.tsx` |
| 详情页UI | `web/src/pages/MediaDetail.tsx` |
| 播放页UI | `web/src/pages/Play.tsx` |
| 搜索页UI | `web/src/pages/Search.tsx` |
| 排行榜UI | `web/src/pages/Ranking.tsx` |
| 媒体列表UI | `web/src/pages/MediaList.tsx` |
| 标签页UI | `web/src/pages/Tags.tsx` |
| 播放器组件 | `web/src/components/player/VideoPlayer.tsx` |
| 媒体卡片组件 | `web/src/components/common/MediaCard.tsx` |
| 格式化工具 | `web/src/utils/format.ts` |
