# 采集任务异常处理完整方案

## 背景

用户指出之前的异常处理方案存在盲区——进程级异常（APP重启/崩溃）导致的僵尸任务状态不一致问题未被覆盖。基于此反馈，重新梳理采集任务全生命周期异常矩阵，补全所有遗漏的异常场景。

## 当前已覆盖（P0/P1/P2 已完成）

- ✅ 单条视频处理失败（try-catch + failedCount）
- ✅ 单页采集失败（页级 try-catch + 跳过继续）
- ✅ 连续多页失败（3页熔断，保留原始 errorType）
- ✅ 网络请求失败（cmsAdapter 指数退避 + 3次重试）
- ✅ 任务级超时（30分钟硬超时）
- ✅ 任务失败状态持久化（status=FAILED + errorMessage + errorType）
- ✅ 用户删除任务检测（循环内轮询 taskId 存在性）
- ✅ 断点续传（lastErrorPage）
- ✅ 僵尸任务清理（resetStaleTasks，启动时自动清理）
- ✅ 源未启用时正确返回失败（store 层 taskId 空值检查）
- ✅ 错误分类（errorType: NETWORK/PARSE/DB/TIMEOUT/CANCELLED/UNKNOWN）

## 待补全缺口（本次实施）

### P0：重复任务检测

**问题**：用户可能对同一视频源同时启动多个同类型采集任务（如连续点击"全量采集"），导致：
- 多个任务并发写同一批数据，产生竞态条件
- 数据库请求量翻倍，资源浪费
- 任务进度互相干扰

**方案**：
- 在 `CollectorService.collectSourceLatest` / `collectSourceAll` 创建任务前，调用 `db.getRunningTasksBySourceCode(sourceCode)` 检查是否已有同源同类型的 RUNNING/PENDING 任务
- 有则抛出 `"已有同类型采集任务正在运行，请等待完成后再启动"` 错误
- Store 层透传该错误，前端弹窗提示
- 注意：INCREMENTAL 和 FULL 算不同类型，可同时存在（但实际不建议同时跑同一个源的增量和全量）

**设计决策**：INCREMENTAL 和 FULL 视为不同类型，互不阻塞。原因：增量和全量的用途不同（增量追最新、全量补历史），同时跑虽然有数据重叠但功能上可接受。如果用户觉得有问题，后续可收紧。

---

### P1-1：任务取消彻底性（AbortController）

**问题**：当前删除任务后，仅靠循环内轮询 `getCollectTaskById` 返回 null 来 break。但 break 之前正在进行的网络请求（可能是整页 getList 或单条 getDetail，加上 3 次重试）仍会在后台跑完，浪费资源且可能在 break 后还在写数据库。

**方案**：
- `CollectorService` 内部维护 `activeAbortControllers: Map<string, AbortController>`（taskId → AbortController）
- `collectSourceLatest` / `collectSourceAll` 开始时创建 AbortController，存入 Map
- `CMSAdapter` 的 `requestWithRetry` 接收 `signal?: AbortSignal` 参数，传给 `this.client.get(url, { signal })`
- 采集循环中每次 `adapter.getList()` 和 `adapter.getDetail()` 都传 signal
- `processItemsWithConcurrency` 的 worker 也传 signal
- 新增 `CollectorService.cancelTask(taskId)` 方法：调用对应 AbortController.abort()，并从 Map 删除
- 捕获 `AbortError`（`err.name === 'Cancel'` 或 message 含 cancel/aborted），归类为 CANCELLED
- **DatabaseProvider 增加 `cancelCollectTask(taskId)` 方法**：将状态置为 FAILED + errorType=CANCELLED + errorMessage="用户已取消" + completedAt=now
- Store 层 `deleteCollectTask` 改为：先调用 collectorService.cancelTask(taskId) 中止请求，等待一小段时间后再删除数据库记录（或直接让取消后的任务置 FAILED，用户手动删除）

**设计决策**：删除操作是否同时删除数据库记录？两种方案：
- A：删除=取消+删除（用户点删除时直接取消并删除记录）
- B：删除只是删除，取消是另一个操作

选择 **方案 A**，符合用户直觉——用户点"删除"就是想让它消失。内部流程：取消请求 → 更新状态为 FAILED/CANCELLED → 删除记录。这样即使取消过程中有延迟，记录最终也会被删掉。

---

### P1-2：单条媒体 DB 写入细粒度容错

**问题**：`processItem` 内一次处理包含多次 DB 写入（upsertMedia、deletePlaySources、getEpisodes、upsertEpisode、upsertPlaySource...）。其中任何一步抛错，整条媒体算失败，且 `failedCount++`。这是合理的。

但真正的问题在 **页级**：当前 `collectFromSource` 串行版（concurrency=1）的 try-catch 包住整条处理，单条失败 continue 不影响其他，✅ 没问题。

**并发版** `processItemsWithConcurrency` 呢？需要确认：worker 内单条失败是否只影响自身，还是会导致 Promise.all 全部拒绝。

**调研结论**：查看代码，`processItemsWithConcurrency` 的 worker 是 try-catch 包住的，单条失败只 failedCount++，不会冒泡到 Promise.all。✅ 并发粒度没问题。

**真正的缺口**：`processItem` 内部 DB 写入失败时，是否有**部分写入**导致数据不一致的风险？
- 例如：upsertMedia 成功了，但 upsertEpisode 失败了 → 媒体入库了，但剧集/播放源缺失
- 目前没有事务（SQLite 支持事务，但 tauri-plugin-sql 和 expo-sqlite 都可以执行 BEGIN/COMMIT）

**方案**：`processItem` 内用事务包裹所有 DB 写入操作。
- DatabaseProvider 增加 `transaction<T>(fn: (tx: TransactionProvider) => Promise<T>): Promise<T>` 接口
- 两端 provider 分别实现（tauri-plugin-sql 可用 `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`；expo-sqlite 同理）
- `processItem` 内所有 DB 操作放在一个事务中，要么全成功要么全回滚

**设计决策**：这是比较重的改动，但数据一致性是硬需求。如果不做事务，极端情况下会出现"有媒体无播放源"的脏数据。

但考虑到改动范围较大（涉及 provider 接口变更、两端实现、所有调用点检查），且当前实际场景中 DB 写入失败概率极低（本地 SQLite，不是远程），**降级为 P2**，先做更关键的。

P1-2 调整为：**在 processItem 级别增加更细粒度的错误处理，确保单条失败不会留下脏数据**——不引入事务，而是在 catch 中做清理（如果 media 已写入但后续失败，删除已写入的 media）。

**P1-2 简化方案**：
- `processItem` 内 try-catch，catch 中调用 `this.db.deleteMediaById(mediaId)` 清理可能已写入的媒体
- 但更简单的方案：**当前 upsertMedia 是在 processItem 的末尾才调用的**（先解析所有数据，最后才写库）——等等，实际不是。让我再确认。

**实际代码结构**（collectorService.ts 160-276 行）：
- processItem 接收 item + sourceId
- 第1步：规范化数据（计算 fingerprint 等）——纯内存
- 第2步：getMediaByFingerprint 查是否已存在——读 DB
- 第3步：parsePlayInfo 解析剧集——纯内存
- 第4步：长短剧判断——可能读 DB
- 第5步：构造 media 对象
- 第6步：upsertMedia ——写 DB（第1次写）
- 第7步：deletePlaySourcesByMediaIdAndSourceId ——写 DB（第2次写）
- 第8步：getEpisodesByMediaId ——读 DB
- 第9步：循环 upsertEpisode + upsertPlaySource ——写 DB（N次写）

风险点：第6步 upsertMedia 成功了，但第7-9步某一步失败，导致：
- media 存在但 play_source 被删除了？不，第7步是"删除该媒体该源的旧播放源"，然后第9步写入新的。如果第7步后第9步失败 → 该源的播放源被清空了但没重建 → **脏数据**

**简化修复（不引入事务）**：
- 不先 delete 再 insert，改成"查出已有播放源 → 对比差异 → 只删需要删的，只插需要插的"
- 或者更简单：**把 delete 操作移到所有 insert 成功之后**
  - 先插入所有新 episode 和 play_source
  - 全部成功后再删除旧的（不在新列表里的）

但这需要知道"哪些是旧的"，逻辑较复杂。

**最简方案（P1-2 最终选择）**：
- 接受当前的小风险，不做事务
- 在 processItem 的 catch 中增加清理逻辑：如果已经写了 media（用 try 块内的标记变量判断），则删除该 mediaId 对应的所有 play_source 和 episode（级联清理）
- 这样即使中间失败，也不会留脏数据

DatabaseProvider 增加 `deleteMediaCompletely(mediaId)` 方法：删除 media + 级联删除其 episodes + play_sources + favorites + watch_history 中引用它的记录。

实际上之前的 collectorService 中 `deleteMediaAndSources` 可能已有类似逻辑。让我检查...如果没有，就加一个。

这个方案改动小，效果接近事务，作为 P1-2 的最终方案。

---

### P2-1：内存优化（分批入库 + 释放引用）

**问题**：全量采集时 `results: Media[]` 数组越积越大（每页20条，100页就是2000条，还好），但真正吃内存的是 processItem 内的 epGroups 解析（大量剧集数据）。2000 条媒体在内存里其实不大。

**实际风险**：不大。当前 100 页 × 20 条 = 2000 条媒体，JS 内存完全hold住。

**结论**：P2-1 暂不做，实际收益低。如果将来 maxPages 提到 500+ 再考虑。

---

### P2-2：系统休眠唤醒处理

**问题**：系统休眠时任务挂起，唤醒后继续执行，但任务级超时判断是基于 `Date.now() - startedAtMs` 的，休眠时间也会被算进去，导致唤醒后立即超时。

**方案**：
- 在采集循环中增加"时间跳变检测"：记录上一次循环的时间戳，每次循环开始时比较当前时间与上次时间的差值，如果差值 > 阈值（如 5分钟），说明系统可能休眠过，调整 startedAtMs 加上休眠时间
- 或者更简单：**用实际运行时间**而非墙上时间来判断超时。维护一个 `totalRuntimeMs` 变量，每次循环迭代累加实际耗时。

**选择**：第二种方案更准确。
- 每次循环开始时记录 `iterationStart = Date.now()`
- 循环结束时 `totalRuntimeMs += Date.now() - iterationStart`
- 超时判断用 `totalRuntimeMs > TASK_TIMEOUT_MS`

改动小，准确率高。

---

### P2-3：数据库连接丢失/磁盘满

**问题**：极端情况，纯客户端场景概率极低。

**方案**：不做。真遇到了，应用级错误会冒泡到顶层，用户也能看到。

---

## 实施步骤总结

按优先级排列，本次共实施 **5 项**：

| # | 优先级 | 项目 | 改动范围 | 预计工作量 |
|---|--------|------|----------|-----------|
| 1 | P0 | 重复任务检测 | collectorService + createStore + SourceManagerPage | 小 |
| 2 | P1-1 | AbortController 取消彻底性 | cmsAdapter + collectorService + provider + createStore + SourceManagerPage | 中 |
| 3 | P1-2 | 单条媒体失败清理（防脏数据） | collectorService + provider | 中 |
| 4 | P2-2 | 休眠唤醒后超时修正 | collectorService | 小 |
| 5 | P2-1 | 内存优化 | — | **不做**（收益低） |
| 6 | P2-3 | DB连接/磁盘异常 | — | **不做**（概率极低） |

---

## 详细改动文件清单

### P0：重复任务检测
- `packages/core/src/services/collectorService.ts`
  - `collectSourceLatest` / `collectSourceAll` 创建任务前查重
  - 新增 `DuplicateTaskError` 或直接抛带消息的 Error
- `packages/core/src/store/createStore.ts`
  - 透传错误消息
- `apps/desktop/src/pages/SourceManagerPage.tsx`
  - 前端捕获后弹窗提示

### P1-1：AbortController 取消彻底性
- `packages/core/src/services/cmsAdapter.ts`
  - `requestWithRetry` 增加 `signal?: AbortSignal` 参数
  - `getList` / `getDetail` 透传 signal
- `packages/core/src/services/collectorService.ts`
  - 类成员 `activeAbortControllers: Map<string, AbortController>`
  - 新增 `cancelTask(taskId: string): void` 方法
  - `collectSourceLatest` / `collectSourceAll` 创建 AbortController，传入 adapter 调用
  - `processItemsWithConcurrency` worker 接收 signal 参数
  - 捕获 Cancel/Abort 错误，归类为 CANCELLED
- `packages/core/src/db/provider.ts`
  - 新增 `cancelCollectTask(taskId: string): Promise<void>`（状态置 FAILED + CANCELLED）
- `apps/desktop/src/db/tauriSqlProvider.ts`
  - 实现 cancelCollectTask
- `apps/mobile/src/db/expoSqliteProvider.ts`
  - 实现 cancelCollectTask
- `packages/core/src/store/createStore.ts`
  - `deleteCollectTask` 改为：先 cancelTask（中止请求 + 置 FAILED），再删除
  - 新增 `cancelCollectTask` 方法（可选，用于"取消但保留记录"的场景）
- `apps/desktop/src/pages/SourceManagerPage.tsx`
  - 删除操作无 UI 变化（删除=取消+删除，用户感知一致）

### P1-2：单条媒体失败清理（防脏数据）
- `packages/core/src/db/provider.ts`
  - 新增 `deleteMediaCompletely(mediaId: string): Promise<void>`
- `apps/desktop/src/db/tauriSqlProvider.ts`
  - 实现 deleteMediaCompletely（级联删除 media + episodes + play_sources + favorites + watch_history）
- `apps/mobile/src/db/expoSqliteProvider.ts`
  - 实现 deleteMediaCompletely
- `packages/core/src/services/collectorService.ts`
  - `processItem` 内增加 `mediaWritten` 标记
  - catch 中如果 mediaWritten 为 true，调用 `deleteMediaCompletely` 清理

### P2-2：休眠唤醒后超时修正
- `packages/core/src/services/collectorService.ts`
  - `collectSourceLatest` / `collectSourceAll` 用 `totalRuntimeMs` 替代 `Date.now() - startedAtMs` 判断超时
  - 每次循环累加实际耗时

---

## 风险与注意事项

1. **AbortController 兼容性**：axios 支持 `signal` 参数（0.22+），需确认 httpClient（axios 封装）是否正确透传。
2. **级联删除顺序**：deleteMediaCompletely 必须按"子表→父表"顺序删除（play_sources → episodes → media），并清理 favorites/watch_history 中的引用。
3. **两端 provider 一致性**：所有新增 provider 方法必须在桌面端和移动端都实现，保持行为一致。
4. **取消任务的竞态**：cancelTask 调用和任务循环内的 getCollectTaskById 检查可能存在竞态，但 AbortController 是同步触发的，信号会在下次异步操作（网络请求）时立即生效，安全。
