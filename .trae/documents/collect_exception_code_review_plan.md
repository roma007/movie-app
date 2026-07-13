# 采集异常处理代码审查报告与修复计划

## 审查结论

代码审查发现 **3 个严重问题 + 2 个中等问题 + 2 个轻微问题**，需要修复。

---

## 严重问题（必须修复）

### 问题1：collectSourceLatest 完全没有被改造（P0）

**位置**：[collectorService.ts:683-794](file:///Users/mengfeng/我的文档/源码/movie-app/packages/core/src/services/collectorService.ts#L683-L794)

**现状**：`collectSourceLatest` 函数完全是旧代码：
- ❌ 没有重复任务检测（没有 `getRunningTasksBySourceCode` 调用）
- ❌ 没有 AbortController（没有 `controller.signal`）
- ❌ 没有休眠超时修正（还是用 `Date.now() - startedAtMs`）
- ❌ `collectFromSource` 调用没有传 signal 参数
- ❌ 没有 `activeAbortControllers.set` / `.delete`

**对比**：`collectSourceAll` 改造是完整的（第796行起，有 totalRuntimeMs、controller.signal、iterationStart）。

**原因推测**：之前的 Python 脚本中，`collectSourceLatest` 的替换模式可能因为某些原因匹配失败但没有报错（脚本先做了 latest 的替换且声称成功，但实际可能替换到了别的位置，或者替换后又被后续操作覆盖了）。需要实际验证代码内容。

**修复方案**：重新对 `collectSourceLatest` 做完整改造（查重 + AbortController + 休眠修正 + signal 传递 + activeAbortControllers 生命周期管理）。

---

### 问题2：重复任务检测完全缺失（P0）

**位置**：`collectorService.ts` 两个顶层采集函数

**现状**：全文件搜索 "重复任务"、"getRunningTasksBySourceCode"、"已有.*任务正在运行" —— **0 处匹配**。

这意味着之前声称已完成的"P0：重复任务检测"实际上**完全没有实现**。只有 collectSourceAll 有 AbortController 和休眠修正，但没有查重。

**修复方案**：在 `collectSourceLatest` 和 `collectSourceAll` 两个函数的任务创建之前，增加查重逻辑：
```typescript
const runningTasks = await this.db.getRunningTasksBySourceCode(sourceCode);
if (runningTasks.some(t => t.type === 'INCREMENTAL' && (t.status === 'RUNNING' || t.status === 'PENDING'))) {
  throw new Error('该视频源已有增量采集任务正在运行，请等待完成后再启动');
}
```

---

### 问题3：collectFromSource 内的串行 getDetail 调用缺少 signal（P1）

**位置**：[collectorService.ts:415](file:///Users/mengfeng/我的文档/源码/movie-app/packages/core/src/services/collectorService.ts#L415) 附近

**现状**：`collectFromSource` 的串行处理路径（concurrency=1 时走的 else 分支）中，`adapter.getDetail` 已经传了 signal（之前的替换成功了）。

但 `collectSourceLatest` 调用 `collectFromSource` 时没传 signal（因为 collectSourceLatest 根本没改），所以串行路径的 signal 也没用上。

**修复方案**：collectSourceLatest 改造后自然会传 signal，这个问题随之解决。但需要确认 collectSourceAll 调用 collectFromSource 时传了 signal（已经传了，第852行有 controller.signal）。

---

## 中等问题

### 问题4：processItem 中 return null 的分支没有清理风险（但实际安全）

**位置**：[collectorService.ts:96-160](file:///Users/mengfeng/我的文档/源码/movie-app/packages/core/src/services/collectorService.ts#L96-L160)

**现状**：processItem 函数在 upsertMedia 之前有多个 `return null` 的分支（年份解析失败、标题为空、黑名单命中...）。这些分支在 `mediaWritten = false` 的阶段返回，不会触发 catch 块的清理。这是**正确的**——因为还没写库，不需要清理。

但有一个细节：`return null` 是在 try 块内直接返回，不会执行 catch 也不会执行 finally（没有 finally）。这没问题，因为 mediaWritten 还是 false。

**结论**：逻辑正确，无需修复。记录在此供参考。

---

### 问题5：getRunningTasksBySourceCode 返回的类型可能不含 type 字段（需确认）

**位置**：DatabaseProvider 的 `getRunningTasksBySourceCode` 方法

**现状**：查重逻辑依赖 `t.type` 字段判断是 INCREMENTAL 还是 FULL。需要确认 `getRunningTasksBySourceCode` 返回的是完整的 CollectTask 对象还是部分字段。

**需验证**：两端 provider 的 getRunningTasksBySourceCode 实现中，SELECT 是否查了 `type` 列。

**修复方案**：如果没查 type 列，加上即可。

---

## 轻微问题

### 问题6：startedAtMs 变量在 collectSourceLatest 中不再使用但还声明了

**位置**：`collectSourceLatest` 函数内

**现状**：`startedAtMs` 被声明但超时判断改用了 `totalRuntimeMs`，所以 `startedAtMs` 是未使用变量。不过 typecheck 没报（可能因为 strict 模式没开 noUnusedParameters）。

**修复方案**：移除或保留（无害但冗余）。建议移除保持整洁。

注意：collectSourceAll 也有 startedAtMs，同样的问题。

---

### 问题7：cancelTask 是同步方法，store 层调用后立即删除任务

**位置**：[createStore.ts:447](file:///Users/mengfeng/我的文档/源码/movie-app/packages/core/src/store/createStore.ts#L447)

**现状**：
```
collectorService.cancelTask(taskId); // 同步：触发 abort
await db.cancelCollectTask(taskId);  // 异步：更新数据库状态
await db.deleteCollectTask(taskId);  // 异步：删除记录
```

**问题**：cancelTask 是同步的（触发 signal.abort()），但网络请求的取消是异步的（abort 后请求需要时间真正停止）。之后立即删除任务记录，而采集循环可能还在跑、还在尝试写数据库。

**实际风险**：低。因为：
1. 采集循环内每步都检查 `existing = await db.getCollectTaskById(taskId)`，如果记录已删除，`!existing` 成立，直接 break
2. signal.abort() 会让正在进行的网络请求很快失败（抛出 AbortError），然后进入 catch

但理论上存在一个时间窗口：在 cancelTask 触发后、任务记录被删除前，采集循环可能刚完成 getCollectTaskById 检查，正在执行 collectFromSource，signal 会中止它，所以还是安全的。

**结论**：逻辑上是安全的（双重保险：signal + 轮询 taskId 存在性）。无需修复。

---

## 待确认项

### 待确认 A：getRunningTasksBySourceCode 返回的字段完整性

需要检查两端 provider 的 `getRunningTasksBySourceCode` SQL 中是否包含 `type` 列。

### 待确认 B：collectByKeyword 方法不需要 signal

`collectByKeyword` 是搜索用的，不是采集任务，不需要取消机制。这个是对的。

---

## 修复步骤

| 步骤 | 内容 | 涉及文件 |
|------|------|----------|
| 1 | 确认 getRunningTasksBySourceCode 返回字段含 type | tauriSqlProvider.ts, expoSqliteProvider.ts |
| 2 | 完整改造 collectSourceLatest：查重 + AbortController + 休眠修正 + signal | collectorService.ts |
| 3 | 给 collectSourceAll 补上重复任务检测 | collectorService.ts |
| 4 | 移除未使用的 startedAtMs 变量（可选） | collectorService.ts |
| 5 | 全量 typecheck 验证 | — |
