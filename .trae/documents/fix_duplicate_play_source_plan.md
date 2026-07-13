# 重复播放源修复计划

## 问题分析

用户反馈播放线路显示两个完全相同的"电影天堂 · HD中字"按钮，无法区分。

### 根因

1. **CMS 返回多个播放源组**：一个视频源（如电影天堂）可能返回多个播放源组（通过 `$$$` 分隔），每个组对应不同的播放 URL
2. **源名称映射相同**：不同的源名称（如 `dytt` 和 `dyttm3u8`）都映射到相同的画质（`HD中字`）
3. **显示信息不足**：播放源按钮只显示 `sourceName` 和 `quality`，无法区分相同来源+画质的不同播放源

### 数据结构

从采集代码分析：
- `sourceId`：CMS 源的唯一标识（如 `source_dianyingtiantang`）
- `sourceName`：映射后的中文名称（如 `电影天堂`）
- `quality`：映射后的画质（如 `HD中字`）
- `url`：实际播放地址（不同播放源组的 URL 不同）
- `sourceIdx`：播放源组索引（从 0 开始）

两个"电影天堂 · HD中字"的区别：
- `sourceIdx` 不同（0 和 1）
- `url` 不同（不同的播放服务器）
- `id` 不同（`ps_{episodeId}_{sourceId}_{sourceIdx}`）

## 修复方案

### 方案选择：合并相同来源+画质的播放源

对于同一个剧集的播放源，如果 `sourceName` 和 `quality` 都相同，只保留第一个有效的播放源，避免显示重复选项。

### 修改内容

1. **PlayPage.tsx**：在显示播放源列表前，过滤掉重复的播放源（相同 `sourceName` 和 `quality`）

### 修改步骤

1. 在 `PlayPage.tsx` 中，对 `sources` 数组进行去重处理，保留 `sourceName + quality` 组合唯一的播放源

### 预期效果

- 修复前：`电影天堂 · HD中字`、`电影天堂 · HD中字`（两个相同按钮）
- 修复后：`电影天堂 · HD中字`（只显示一个按钮）

## 风险评估

- 低风险：仅修改显示逻辑，不影响数据存储
- 如果用户需要备用播放源，播放器的自动线路切换机制仍会生效（因为失败时会尝试下一个线路）

## 文件清单

- [PlayPage.tsx](file:///Users/mengfeng/我的文档/源码/movie-app/apps/desktop/src/pages/PlayPage.tsx)
