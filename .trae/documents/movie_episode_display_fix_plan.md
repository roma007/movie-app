# 电影详情页播放列表显示修复方案

## 问题描述

用户反馈：电影详情页显示"第1集"，但电影没有集数概念。视频源返回的原始播放标题（如"正片"、"HD"、"HD中字"等）被丢弃了。

## 问题根因

在 `collectorService.ts` 第248-268行：
```typescript
const isVersion = isVersionTitle(ep.title) && mediaType === 'MOVIE';
// ...
episode = {
  id: episodeId,
  mediaId,
  seasonNumber,
  episodeNumber: isVersion ? 1 : epNumber,
  title: isVersion ? null : ep.title,  // 版本标题被设为 null
  duration: null,
};
```

版本标题（"正片"、"HD"、"HD中字"等）被 `isVersionTitle` 判断为版本标识，然后被丢弃，导致数据库中 `episode.title` 为空。

同时，`play_source.quality` 字段也未保存版本标题。

## 修复方案

### 修改内容

1. **采集层修复**：对于电影，把版本标题存到 `play_source.quality` 字段
2. **显示层修复**：对于电影，显示 `play_source.sourceName` + `play_source.quality` 作为播放标题

### 修改文件

| 文件 | 修改位置 | 修改内容 |
|------|---------|---------|
| `packages/core/src/services/collectorService.ts` | 第277-284行 | MOVIE类型保存版本标题到quality |
| `apps/desktop/src/pages/DetailPage.tsx` | 第301行 | MOVIE类型显示sourceName+quality |
| `apps/desktop/src/pages/DetailPage.tsx` | 第123行 | MOVIE类型显示sourceName+quality |
| `apps/desktop/src/pages/DetailPage.tsx` | 第145行 | MOVIE类型显示sourceName+quality |

### 代码修改示例

**采集层**（collectorService.ts）：
```typescript
const playSource: PlaySource = {
  id: playSourceId,
  episodeId: episode.id,
  sourceId,
  sourceName: sourceNameFromList,
  url: ep.url,
  quality: isVersion ? ep.title : null,  // 保存版本标题
};
```

**显示层**（DetailPage.tsx）：
```typescript
const isMovie = currentMedia?.type === 'MOVIE';
const quality = sources.length > 0 ? sources[0].quality : null;
const sourceName = sources.length > 0 ? sources[0].sourceName : null;
const title = isMovie 
  ? `${sourceName || ''}${quality ? ` · ${quality}` : ''}`.trim() || '正片'
  : (ep.title || `第${ep.episodeNumber}集`);
```

## 风险评估

- **低风险**：仅修改显示逻辑和采集时的quality字段保存，不影响核心数据结构
- **兼容性**：其他类型（电视剧、综艺、动漫、纪录片）保持原有逻辑不变

## 验证步骤

1. 打开电影详情页，确认播放列表显示"视频源名称 · 版本标题"（如"魔都资源 · 正片"）
2. 打开电视剧详情页，确认播放列表仍显示"第X集"
3. 测试复制链接功能，确认标题正确显示