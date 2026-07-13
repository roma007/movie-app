# 页级失败处理方案（思路A：不熔断，记录失败页）

## 问题概述

`collectFromSource` 在 `getList` 失败时，内部 try-catch 吞掉了异常，返回 `{ media: [], total: 0, pagecount: 0, failedCount: 0 }`。导致：
1. 页级失败不可见——用户不知道哪些页失败了
2. failedCount 不增加——和视频级失败混在一起无法区分
3. errorMessage 不更新——任务完成/失败原因没有页级失败信息

## 当前状态分析

### collectFromSource 的错误处理（问题根源）

[collectorService.ts:390-401](file:///Users/mengfeng/我的文档/源码/movie-app/packages/core/src/services/collectorService.ts#L390-L401)

```typescript
try {
  response = await adapter.getList(page, pageSize, signal);
} catch (err) {
  // ← 吞掉异常，返回空结果
  return { media: [], total: 0, pagecount: 0, failedCount: 0 };
}
```

### 外层循环结构

[collectorService.ts:880-928](file:///Users/mengfeng/我的文档/源码/movie-app/packages/core/src/services/collectorService.ts#L880-L928)

`collectSourceAll` 中有 `consecutiveFailures` 熔断逻辑（连续3页失败停止），但因异常被吞掉而永远触发不了。

**思路A决策**：移除熔断，任务一直跑到 maxPages，只记录失败页。

### CollectTask 数据模型

[types/index.ts:139-156](file:///Users/mengfeng/我的文档/源码/movie-app/packages/core/src/types/index.ts#L139-L156)

现有字段：`failedCount`（视频级失败计数）、`lastErrorPage`（单个值）、`errorMessage`、`errorType`

**新增**：`failedPages`（逗号分隔的页码字符串，如 "3,5,8"）

### collect_task 表结构

[lib.rs:170-211](file:///Users/mengfeng/我的文档/源码/movie-app/apps/desktop/src-tauri/src/lib.rs#L170-L211)

现有列：`failed_count`、`error_message`、`error_type`、`last_error_page`

**新增列**：`failed_pages TEXT`

### 前端展示

[TaskListPage.tsx:236-248](file:///Users/mengfeng/我的文档/源码/movie-app/apps/desktop/src/pages/TaskListPage.tsx#L236-L248)

仅在 FAILED 状态下显示错误信息。

**需要补充**：COMPLETED 状态下如果有失败页，也要展示。

### collectFromSource 的其他调用方（影响确认）

- [collectLatest:576-598](file:///Users/mengfeng/我的文档/源码/movie-app/packages/core/src/services/collectorService.ts#L576-L598)：外层有 try-catch，跳过失败源继续下一个
- [collectAll:617-629](file:///Users/mengfeng/我的文档/源码/movie-app/packages/core/src/services/collectorService.ts#L617-L629)：try-catch 中 break 退出

两个调用方都有 try-catch，让 collectFromSource 抛异常不会影响它们。

## 方案核心（思路A）

**不熔断，跑到结束。记录失败页，支持单独重试。**

| 项目 | 策略 |
|------|------|
| 单页失败 | 跳过继续下一页 |
| 连续失败 | 不熔断，一直跑到 maxPages |
| 失败页记录 | 记录所有失败的页码 |
| 任务最终状态 | 采完最后一页 → COMPLETED（即使中间有失败页） |
| 失败页重试 | 提供"重试失败页"功能 |

## 修改清单

### 1. collectFromSource：getList 失败抛异常

**文件**：`packages/core/src/services/collectorService.ts`（约390-401行）

移除 getList 的内部 try-catch，让异常自然抛出。外层 catch 负责记录失败页。

`incrementSourceFailCount` 移到外层 catch 中调用。

### 2. 外层循环：移除熔断，记录失败页

**文件**：`packages/core/src/services/collectorService.ts`

`collectSourceAll` 和 `collectSourceLatest` 的 catch 块：

**移除**：
- `consecutiveFailures` 变量和累加
- `if (consecutiveFailures >= 3)` 熔断抛出

**保留/新增**：
- 记录错误信息（errorMessage / errorType / lastErrorPage）
- 记录失败页：`failedPages.push(page)`
- 更新数据库（含 failedPages 字段）
- `page++` 继续下一页

### 3. 新增 failed_pages 字段

**数据库 migration**：
- `apps/desktop/src-tauri/src/lib.rs`：新增 migration v13
  ```sql
  ALTER TABLE collect_task ADD COLUMN failed_pages TEXT;
  ```
- `apps/mobile/src/db/expoSqliteProvider.ts`：runMigrations 中新增同样的 ALTER TABLE

**类型定义**：
- `packages/core/src/types/index.ts`：`CollectTask` 新增 `failedPages?: string | null`

**Provider 适配**：
- `apps/desktop/src/db/tauriSqlProvider.ts`：updateCollectTask 和 rowToCollectTask 支持 failedPages
- `apps/mobile/src/db/expoSqliteProvider.ts`：同上

### 4. 新增"重试失败页"方法

**文件**：`packages/core/src/services/collectorService.ts`

新增方法 `retryFailedPages(taskId: string)`：
1. 读取任务的 failedPages 字段
2. 依次重试每个失败页
3. 成功的页从 failedPages 中移除
4. 仍然失败的保留在 failedPages 中

**Store 层**：`packages/core/src/store/createStore.ts` 新增 action

### 5. 前端展示

**TaskListPage.tsx**：
- 状态为 COMPLETED 但有失败页时，显示"部分完成"状态（绿色但有警告提示）
- 展示失败页列表：`失败页：3, 5, 8`
- 操作列新增"重试失败页"按钮（有失败页时显示）

**SourceManagerPage.tsx**：
- 采集进度区域展示失败页数
- 断点续传：如果有 failedPages，从第一个失败页开始（而不是 lastErrorPage）

## 改动文件清单

| 文件 | 改动 |
|------|------|
| `packages/core/src/services/collectorService.ts` | 移除 getList 内部 try-catch；移除熔断；记录 failedPages；新增 retryFailedPages |
| `packages/core/src/types/index.ts` | CollectTask 新增 `failedPages?: string \| null` |
| `packages/core/src/store/createStore.ts` | 新增 retryFailedPages action |
| `apps/desktop/src-tauri/src/lib.rs` | migration v13：ALTER TABLE collect_task ADD COLUMN failed_pages TEXT |
| `apps/desktop/src/db/tauriSqlProvider.ts` | updateCollectTask / rowToCollectTask 支持 failedPages |
| `apps/mobile/src/db/expoSqliteProvider.ts` | migration + provider 适配 |
| `apps/desktop/src/pages/TaskListPage.tsx` | 展示失败页 + 重试按钮 |
| `apps/desktop/src/pages/SourceManagerPage.tsx` | 进度展示失败页；断点续传从失败页开始 |

## 验证步骤

1. typecheck 全 workspace 通过
2. 桌面端 build 通过
3. 模拟某几页网络超时，确认：
   - 任务不中断，继续跑到最后一页
   - 最终状态为 COMPLETED
   - 能看到失败页列表
   - 点"重试失败页"能重新采集失败的页
