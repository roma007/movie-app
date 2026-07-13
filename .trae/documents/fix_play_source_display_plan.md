# 播放源显示修复计划

## 问题分析

用户反馈播放线路显示两个相同名称的"电影天堂"按钮，无法区分它们的区别。

### 根因

1. **播放源数据结构**：每个视频源（CMS）可能返回多个播放源组（不同画质/版本），每个组都会创建独立的 `PlaySource` 记录
2. **显示逻辑缺失**：播放源按钮只显示 `sourceName`，没有显示 `quality`（画质）信息
3. **数据差异**：两个"电影天堂"的区别在于 `quality`（如 HD、HD中字等）和 `url` 不同

### 代码位置

- **显示逻辑**：[PlayPage.tsx](file:///Users/mengfeng/我的文档/源码/movie-app/apps/desktop/src/pages/PlayPage.tsx#L136) 第136行：`{s.sourceName || `线路${i + 1}`}`
- **数据来源**：[collectorService.ts](file:///Users/mengfeng/我的文档/源码/movie-app/packages/core/src/services/collectorService.ts#L269-L271) 第269-271行设置 `sourceName` 和 `quality`

## 修复方案

### 修改内容

1. **PlayPage.tsx**：在播放源按钮中同时显示 `sourceName` 和 `quality`，格式为 `来源名称 · 画质`

### 修改步骤

1. 修改 `PlayPage.tsx` 中播放源按钮的显示文本，将 `{s.sourceName || `线路${i + 1}`}` 改为 `{s.sourceName || `线路${i + 1}`}{s.quality ? ` · ${s.quality}` : ''}`

### 预期效果

- 修复前：`电影天堂`、`电影天堂`（无法区分）
- 修复后：`电影天堂 · HD`、`电影天堂 · HD中字`（可通过画质区分）

## 风险评估

- 低风险：仅修改显示文本，不影响数据逻辑
- 如果 `quality` 为 null，仍只显示 `sourceName`，不会产生空内容

## 文件清单

- [PlayPage.tsx](file:///Users/mengfeng/我的文档/源码/movie-app/apps/desktop/src/pages/PlayPage.tsx)
