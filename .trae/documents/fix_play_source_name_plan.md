# 修复播放源名称英文转中文问题

## 问题分析

### 问题描述
新爬取的视频在前端显示的播放源是英文字符串（如 `modum3u8`, `dbm3u8`, `wjm3u8`, `dytt`, `dyttm3u8`），而应该显示为中文（如 `电影天堂`, `魔都资源`）。

### 问题根因
在 `collectorService.ts` 的 `processItem` 方法中，播放源名称直接使用了 CMS API 返回的原始英文名称，没有进行中文映射转换：

```typescript
// collectorService.ts 第 242 行
const sourceNameFromList = sources[sourceIdx] || `线路${sourceIdx + 1}`;

// 第 281 行 - 直接存入数据库
sourceName: sourceNameFromList,
```

用户之前通过 `fix_movie_quality.js` 脚本批量修改了数据库中的数据，但没有修改采集代码，导致新采集的视频仍然使用英文名称。

### 映射关系（从修复脚本提取）

| 英文标识 | 中文名称 | 关联视频源 |
|---------|---------|-----------|
| `modum3u8` | 正片 | 魔都资源 |
| `dbm3u8` | HD | 百度云资源 |
| `wjm3u8` | HD | 无尽资源 |
| `dytt` | HD中字 | 电影天堂 |
| `dyttm3u8` | HD中字 | 电影天堂 |
| `liangzi` | HD中字 | 量子资源 |
| `lzm3u8` | HD中字 | 量子资源 |
| `hnyun` | 正片 | 红牛资源 |
| `hnm3u8` | 正片 | 红牛资源 |

## 修复方案

### 修改文件

#### 1. `packages/core/src/utils/constants.ts`
添加播放源类型名称映射表：
- 添加 `PLAY_SOURCE_TYPE_MAP` 对象，包含英文到中文的映射
- 添加 `SOURCE_ID_TO_NAME_MAP` 对象，包含 source_id 到中文名称的映射

#### 2. `packages/core/src/services/collectorService.ts`
在 `processItem` 方法中：
- 导入映射表
- 在获取 `sourceNameFromList` 后，根据 `sourceId` 查找对应的视频源中文名称
- 将 `sourceName` 设置为视频源中文名称（如"电影天堂"）
- 将 `quality` 设置为映射后的画质名称（如"HD中字"）

### 修复逻辑

```typescript
// 修复前
const sourceNameFromList = sources[sourceIdx] || `线路${sourceIdx + 1}`;
// ...
sourceName: sourceNameFromList,
quality: isVersion ? ep.title : null,

// 修复后
const sourceNameFromList = sources[sourceIdx] || `线路${sourceIdx + 1}`;
const sourceDisplayName = SOURCE_ID_TO_NAME_MAP[sourceId] || '未知源';
const mappedQuality = PLAY_SOURCE_TYPE_MAP[sourceNameFromList] || (isVersion ? ep.title : null);
// ...
sourceName: sourceDisplayName,
quality: mappedQuality,
```

## 实施步骤

1. **添加映射表**：在 `constants.ts` 中添加 `PLAY_SOURCE_TYPE_MAP` 和 `SOURCE_ID_TO_NAME_MAP`
2. **修改采集逻辑**：在 `collectorService.ts` 的 `processItem` 方法中应用映射转换
3. **验证构建**：运行 `pnpm --filter @movie-app/core build` 验证 TypeScript 编译
4. **验证功能**：启动桌面端 `pnpm run desktop:dev`，测试新采集视频的播放源显示

## 风险评估

| 风险 | 影响 | 缓解措施 |
|-----|------|---------|
| 映射表不完整 | 部分播放源仍显示英文 | 后续可根据实际数据补充映射表 |
| 数据库已有英文数据 | 历史数据仍显示英文 | 用户可重新运行之前的修复脚本清理历史数据 |
| source_id 格式变化 | 映射失败显示"未知源" | 使用 `getVideoSourceById` 查询确保映射正确 |

## 验证方式

1. 启动应用：`pnpm run desktop:dev`
2. 进入"视频源管理"页面
3. 点击"增量采集"按钮采集新视频
4. 查看新采集视频的详情页，确认播放源显示为中文（如"电影天堂 · HD中字"）