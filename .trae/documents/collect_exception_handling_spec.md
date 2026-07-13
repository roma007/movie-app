# 采集任务异常处理完整规格说明书

## 1. 背景与目标

### 1.1 问题背景

用户在使用过程中发现采集任务列表显示"运行中"的任务，但实际 APP 已重启，任务早已停止。这暴露了之前的异常处理方案存在盲区——只覆盖了任务执行过程中的异常，未覆盖**进程级异常**和**生命周期边界**的异常。

基于此反馈，需要系统性地重新梳理采集任务全生命周期的异常场景，补全所有遗漏的异常处理机制。

### 1.2 项目约束回顾

- 纯客户端架构：采集任务在应用进程内运行，无后台服务
- APP 关闭/重启后，正在运行的任务会中断
- 任务状态持久化在本地 SQLite
- 支持多视频源并发采集
- 桌面端（Tauri）和移动端（Expo）两端共享业务逻辑

### 1.3 已覆盖能力（当前状态）

| 类别 | 能力 | 状态 |
|------|------|------|
| 网络层 | 指数退避重试（3次） | ✅ 已实现 |
| 单条处理 | 单条视频失败不影响整批 | ✅ 已实现 |
| 页级容错 | 单页失败跳过继续 | ✅ 已实现 |
| 连续失败 | 连续3页熔断 | ✅ 已实现 |
| 任务超时 | 30分钟任务级超时 | ✅ 已实现 |
| 失败持久化 | FAILED 状态 + errorMessage + errorType | ✅ 已实现 |
| 断点续传 | lastErrorPage 记录 | ✅ 已实现 |
| 僵尸任务清理 | 启动时 resetStaleTasks | ✅ 已实现 |
| 错误分类 | NETWORK/PARSE/DB/TIMEOUT/CANCELLED/UNKNOWN | ✅ 已实现 |
| 源未启用检测 | store 层 taskId 空值检查 | ✅ 已实现 |

### 1.4 本次目标

补全以下 5 项异常处理能力：

| # | 优先级 | 项目 | 核心解决的问题 |
|---|--------|------|---------------|
| 1 | P0 | 重复任务检测 | 防止同一源同类型任务重复启动 |
| 2 | P1 | AbortController 取消彻底性 | 删除任务后真正中止网络请求 |
| 3 | P1 | 单条媒体失败清理 | 防止部分写入导致脏数据 |
| 4 | P2 | 休眠唤醒超时修正 | 系统休眠后超时判断不准确 |
| 5 | — | 内存优化 | **不做**（当前规模下收益低） |
| 6 | — | DB连接/磁盘异常 | **不做**（概率极低） |

---

## 2. 功能规格

### 2.1 P0：重复任务检测

#### 2.1.1 功能描述

用户启动采集任务时，检查是否已有**同一视频源 + 同一任务类型**的 RUNNING 或 PENDING 任务存在。如有，则拒绝创建新任务并提示用户。

#### 2.1.2 判定规则

- 匹配维度：`sourceCode`（视频源标识） + `type`（任务类型：INCREMENTAL / FULL）
- 命中状态：`status IN ('PENDING', 'RUNNING')`
- INCREMENTAL 和 FULL 视为不同类型，互不阻塞

#### 2.1.3 用户交互

- 触发位置：视频源管理页 → 「增量采集」/「全量采集」按钮
- 冲突提示：`alert("该视频源已有同类型采集任务正在运行，请等待完成后再启动。")`
- 用户确认后关闭弹窗，不创建新任务

#### 2.1.4 错误码与消息

| 场景 | success | error 消息 |
|------|---------|-----------|
| 正常创建 | true | — |
| 重复任务 | false | "该视频源已有同类型采集任务正在运行" |
| 源不存在/未启用 | false | "视频源不存在或未启用" |

---

### 2.2 P1-1：AbortController 取消彻底性

#### 2.2.1 功能描述

用户删除采集任务时，不仅标记任务为已删除，还立即中止正在进行的网络请求，确保资源快速释放，避免后台继续写数据库。

#### 2.2.2 取消机制

使用 `AbortController` 实现请求取消：

1. 每个运行中的任务对应一个 `AbortController` 实例
2. 任务开始时创建并存入 `activeAbortControllers: Map<string, AbortController>`
3. 所有网络请求（`getList`、`getDetail`）传入 `signal` 参数
4. 取消时调用 `abortController.abort()`，触发所有进行中的请求抛出 `AbortError`

#### 2.2.3 取消流程

```
用户点击删除 → store.deleteCollectTask(taskId)
  → collectorService.cancelTask(taskId)
    → abortController.abort()  [同步触发信号]
    → 从 activeAbortControllers 移除
  → 进行中的网络请求抛出 Cancel 错误
  → 采集循环捕获错误，跳出循环
  → 更新任务状态：FAILED + errorType=CANCELLED + errorMessage="用户已取消"
  → 删除任务记录
```

#### 2.2.4 错误识别

Axios 取消请求的错误特征：
- `err.name === 'Cancel'` 或 `err.code === 'ERR_CANCELED'`
- `err.message` 包含 "cancel" 或 "aborted"

`classifyError` 函数中增加对取消错误的识别，归类为 `CANCELLED`。

#### 2.2.5 DatabaseProvider 变更

新增方法：`cancelCollectTask(taskId: string): Promise<void>`
- 将任务状态置为 `FAILED`
- `errorType = 'CANCELLED'`
- `errorMessage = '用户已取消'`
- `completedAt = now`

#### 2.2.6 用户感知

- 删除操作 UI 无变化，用户点删除后任务立即从列表消失
- 取消过程是异步的，但通常在几百毫秒内完成
- 即使取消过程中有延迟，任务记录最终会被删除，用户不会感知

---

### 2.3 P1-2：单条媒体失败清理（防脏数据）

#### 2.3.1 问题描述

`processItem` 函数处理单条媒体时，包含多次数据库写入：
1. `upsertMedia` — 写入媒体主记录
2. `deletePlaySourcesByMediaIdAndSourceId` — 删除该源旧播放源
3. `upsertEpisode` — 写入剧集（多条）
4. `upsertPlaySource` — 写入播放源（多条）

如果第 1 步成功但后续步骤失败，会导致：
- 媒体记录存在，但该视频源的播放源被删空了 → **用户看到媒体但无法播放**

#### 2.3.2 解决方案

在 `processItem` 的 catch 块中增加清理逻辑：
- 用 `mediaWritten` 变量标记是否已写入 media
- 如果已写入且后续步骤失败，调用 `deleteMediaCompletely(mediaId)` 完全清理该媒体

#### 2.3.3 deleteMediaCompletely 规格

DatabaseProvider 新增方法：`deleteMediaCompletely(mediaId: string): Promise<void>`

删除顺序（子表→父表，避免外键约束）：
1. `DELETE FROM play_sources WHERE media_id IN (SELECT id FROM episodes WHERE media_id = ?)`
   （或先查 episodeIds，再删 play_sources）
2. `DELETE FROM episodes WHERE media_id = ?`
3. `DELETE FROM media WHERE id = ?`
4. `DELETE FROM favorites WHERE media_id = ?`
5. `DELETE FROM watch_history WHERE media_id = ?`

> 注：实际执行顺序需根据两端 SQLite 外键配置调整。如果开启了 `PRAGMA foreign_keys = ON` 且有 `ON DELETE CASCADE`，则只需删 media，子表自动级联。需确认两端的外键配置。

如果没有外键级联，则按上述顺序手动删除。

---

### 2.4 P2-2：休眠唤醒后超时修正

#### 2.4.1 问题描述

当前任务超时判断：`Date.now() - startedAtMs > TASK_TIMEOUT_MS`

系统休眠时，采集循环挂起，但墙上时钟继续走。唤醒后，休眠时间被算进了"运行时间"，可能导致任务立即超时。

#### 2.4.2 解决方案

用**实际运行时长**替代墙上时间差：

- 新增变量 `totalRuntimeMs = 0`
- 每次循环迭代开始时记录 `iterationStart = Date.now()`
- 每次循环迭代结束时 `totalRuntimeMs += Date.now() - iterationStart`
- 超时判断：`if (totalRuntimeMs > TASK_TIMEOUT_MS)`

这样系统休眠的时间不会被算入运行时长。

#### 2.4.3 边界情况

- 单次迭代内休眠：如果在 `collectFromSource` 调用期间系统休眠，`iterationStart` 到迭代结束的时间差会包含休眠时间。但 `collectFromSource` 内部有网络请求超时（axios 默认或自定义），休眠会导致请求超时并失败，然后进入下一次迭代或熔断。这种情况误判的影响有限——最坏情况是一页的等待时间被算入运行时长，但不会导致整任务立即超时。
- 对于精度要求，此方案足够。

---

## 3. 数据结构变更

### 3.1 数据库 schema

本次无新增表或列，沿用现有 schema。

### 3.2 TypeScript 类型

本次无新增类型，沿用现有 `CollectTask`、`TaskStatus`、`TaskErrorType`。

### 3.3 CMSAdapter 接口变更

```typescript
// 修改前
getList(page?: number, size?: number): Promise<CMSListResponse>
getDetail(id: string): Promise<CMSDetailResponse>

// 修改后
getList(page?: number, size?: number, signal?: AbortSignal): Promise<CMSListResponse>
getDetail(id: string, signal?: AbortSignal): Promise<CMSDetailResponse>
```

### 3.4 DatabaseProvider 接口变更

新增方法：
```typescript
cancelCollectTask(taskId: string): Promise<void>
deleteMediaCompletely(mediaId: string): Promise<void>
```

---

## 4. 接口变更清单

### 4.1 packages/core

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `services/cmsAdapter.ts` | 修改 | `requestWithRetry`、`getList`、`getDetail` 增加 `signal?: AbortSignal` 参数 |
| `services/collectorService.ts` | 修改 | 新增 `activeAbortControllers` Map、`cancelTask` 方法、查重逻辑、休眠超时修正、失败清理 |
| `db/provider.ts` | 修改 | 新增 `cancelCollectTask`、`deleteMediaCompletely` 接口声明 |
| `store/createStore.ts` | 修改 | `deleteCollectTask` 改为先取消再删除；查重错误透传 |

### 4.2 apps/desktop

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `db/tauriSqlProvider.ts` | 修改 | 实现 `cancelCollectTask`、`deleteMediaCompletely` |
| `pages/SourceManagerPage.tsx` | 修改 | 重复任务冲突提示 |

### 4.3 apps/mobile

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `db/expoSqliteProvider.ts` | 修改 | 实现 `cancelCollectTask`、`deleteMediaCompletely` |
| （UI 页面） | — | 移动端无采集 UI，无需改动 |

---

## 5. 测试验证

### 5.1 功能验证清单

| # | 测试项 | 预期结果 | 验证方式 |
|---|--------|---------|----------|
| 1 | 重复启动增量采集 | 提示"已有同类型任务运行中"，不创建新任务 | 手动 |
| 2 | 重复启动全量采集 | 同上 | 手动 |
| 3 | 增量+全量同时启动 | 两个任务都能创建成功（不同类型） | 手动 |
| 4 | 删除运行中的任务 | 任务立即从列表消失，网络请求被中止 | DevTools Network |
| 5 | 删除失败任务 | 直接删除，无取消逻辑 | 手动 |
| 6 | 单条媒体处理失败 | 不残留脏数据（媒体+剧集+播放源要么全有要么全无） | SQL 查询验证 |
| 7 | 休眠唤醒后超时 | 休眠时间不计入运行时长，不会立即超时 | 模拟系统休眠 |
| 8 | APP 重启后僵尸任务 | 启动时自动标记为 FAILED + CANCELLED | 手动重启验证 |

### 5.2 回归验证

- 全 workspace typecheck 通过
- 桌面端构建通过（Vite + cargo check）
- 移动端 typecheck 通过
- 现有采集流程（增量/全量）功能正常
- 断点续传功能正常
- 任务列表展示正常

---

## 6. 实施步骤

| 步骤 | 内容 | 涉及文件 |
|------|------|----------|
| 1 | DatabaseProvider 接口新增两个方法 + 两端实现 | provider.ts, tauriSqlProvider.ts, expoSqliteProvider.ts |
| 2 | CMSAdapter 增加 AbortSignal 支持 | cmsAdapter.ts |
| 3 | CollectorService 接入 AbortController + cancelTask | collectorService.ts |
| 4 | CollectorService 增加重复任务检测 | collectorService.ts |
| 5 | CollectorService 增加 processItem 失败清理 | collectorService.ts |
| 6 | CollectorService 休眠超时修正 | collectorService.ts |
| 7 | Store 层适配：deleteCollectTask 先取消后删除；查重错误透传 | createStore.ts |
| 8 | 前端 SourceManagerPage 重复任务提示 | SourceManagerPage.tsx |
| 9 | typecheck + 构建验证 | — |
