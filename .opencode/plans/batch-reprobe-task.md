# 批量重新探测长短剧 - 任务化改造计划

## 一、需求分析

### 当前问题
- 批量探测功能直接在 VideoManagementPage 组件中执行 async 函数
- 进度状态保存在 Zustand store 的 `reprobeProgress` 中
- 当用户跳转到其他页面时，组件卸载，UI 更新丢失
- 用户无法看到后台运行的探测进度

### 解决方案
将批量探测做成后台任务，任务状态持久化到数据库，在 VideoManagementPage 中显示当前运行的探测任务并支持取消。

### 用户需求
1. 不需要支持应用重启后自动恢复任务
2. 需要支持取消正在运行的探测任务
3. 限制同时运行的任务数量为1个
4. 不需要在页面上建任务列表（在 VideoManagementPage 中显示即可）

---

## 二、技术方案

### 1. 扩展 CollectTask 类型

**文件**: `packages/core/src/types/index.ts`

```typescript
// 扩展 TaskType
export type TaskType = 'INCREMENTAL' | 'FULL' | 'KEYWORD' | 'REPROBE';

// 扩展 CollectTask 接口
export interface CollectTask {
  // ... 现有字段
  probedCount?: number;      // 已探测数量
  shortDramaCount?: number;  // 短剧数量
  longDramaCount?: number;   // 长剧数量
}
```

### 2. 数据库 Schema 变更

**需要添加的字段**（collect_task 表）：
- `probed_count INTEGER DEFAULT 0` - 已探测数量
- `short_drama_count INTEGER DEFAULT 0` - 短剧数量
- `long_drama_count INTEGER DEFAULT 0` - 长剧数量

### 3. 数据库迁移

**桌面端** (`apps/desktop/src-tauri/src/lib.rs`)：
```rust
Migration {
    version: 14,
    description: "add_reprobe_fields_to_collect_task",
    sql: "ALTER TABLE collect_task ADD COLUMN probed_count INTEGER DEFAULT 0;
          ALTER TABLE collect_task ADD COLUMN short_drama_count INTEGER DEFAULT 0;
          ALTER TABLE collect_task ADD COLUMN long_drama_count INTEGER DEFAULT 0;",
    kind: MigrationKind::Up,
},
```

**移动端** (`apps/mobile/src/db/expoSqliteProvider.ts`)：
```typescript
{
  version: 12,
  description: 'add_reprobe_fields_to_collect_task',
  sql: `ALTER TABLE collect_task ADD COLUMN probed_count INTEGER DEFAULT 0;
        ALTER TABLE collect_task ADD COLUMN short_drama_count INTEGER DEFAULT 0;
        ALTER TABLE collect_task ADD COLUMN long_drama_count INTEGER DEFAULT 0;`,
},
```

### 4. DatabaseProvider 接口扩展

**文件**: `packages/core/src/db/provider.ts`

添加新方法：
```typescript
// Reprobe Task DAO
createReprobeTask(task: CollectTask): Promise<void>;
updateReprobeTaskProgress(taskId: string, updates: {
  probedCount?: number;
  shortDramaCount?: number;
  longDramaCount?: number;
  status?: TaskStatus;
}): Promise<void>;
getRunningReprobeTask(): Promise<CollectTask | null>;
```

### 5. CollectorService 修改

**文件**: `packages/core/src/services/collectorService.ts`

1. **添加 `startReprobeTask()` 方法**：
   - 创建任务记录（status: PENDING）
   - 启动后台异步探测
   - 返回 taskId

2. **修改 `batchReprobeMedia()` 方法**：
   - 接受 taskId 参数
   - 探测过程中更新数据库任务进度
   - 支持取消（检查 AbortController）

3. **添加 `cancelReprobeTask()` 方法**：
   - 通过 AbortController 取消探测
   - 更新任务状态为 FAILED

### 6. Zustand Store 修改

**文件**: `packages/core/src/store/createStore.ts`

添加新 action：
```typescript
startReprobeTask: () => Promise<string>;  // 返回 taskId
cancelReprobeTask: (taskId: string) => Promise<void>;
loadRunningReprobeTask: () => Promise<CollectTask | null>;
```

### 7. VideoManagementPage UI 修改

**文件**: `apps/desktop/src/pages/VideoManagementPage.tsx`

1. **显示当前运行的探测任务**（如果有）
2. **按钮状态动态变化**：
   - 有运行中任务：显示"探测中..." + 取消按钮
   - 无运行中任务：显示"开始批量重新探测"
3. **进度显示**：从数据库读取任务进度

---

## 三、实施顺序

1. 类型定义 (`packages/core/src/types/index.ts`)
2. 数据库 Schema (`packages/core/src/db/schema.ts`)
3. 桌面端数据库迁移 (`apps/desktop/src-tauri/src/lib.rs`)
4. 移动端数据库迁移 (`apps/mobile/src/db/expoSqliteProvider.ts`)
5. DatabaseProvider 接口 (`packages/core/src/db/provider.ts`)
6. 桌面端 TauriSqlProvider 实现 (`apps/desktop/src/db/tauriSqlProvider.ts`)
7. 移动端 ExpoSqliteProvider 实现 (`apps/mobile/src/db/expoSqliteProvider.ts`)
8. CollectorService (`packages/core/src/services/collectorService.ts`)
9. Zustand Store (`packages/core/src/store/createStore.ts`)
10. VideoManagementPage UI (`apps/desktop/src/pages/VideoManagementPage.tsx`)

---

## 四、关键设计点

1. **任务持久化**：任务状态保存到数据库，UI 可以随时读取
2. **后台运行**：探测逻辑在 async 函数中执行，不依赖组件生命周期
3. **取消支持**：通过 AbortController 实现任务取消
4. **并发限制**：同一时间只允许一个探测任务运行
5. **进度更新**：每探测一部媒体后更新数据库

---

## 五、文件修改清单

| 文件 | 修改内容 |
|------|----------|
| `packages/core/src/types/index.ts` | 扩展 TaskType 和 CollectTask 接口 |
| `packages/core/src/db/schema.ts` | 添加新字段到 collect_task 表（可选） |
| `packages/core/src/db/provider.ts` | 添加新的 DAO 方法 |
| `packages/core/src/services/collectorService.ts` | 添加任务管理方法 |
| `packages/core/src/store/createStore.ts` | 添加新的 action |
| `apps/desktop/src-tauri/src/lib.rs` | 添加迁移 v14 |
| `apps/desktop/src/db/tauriSqlProvider.ts` | 实现新的 DAO 方法 |
| `apps/desktop/src/pages/VideoManagementPage.tsx` | 修改 UI 显示 |
| `apps/mobile/src/db/expoSqliteProvider.ts` | 添加迁移 v12 + 实现新的 DAO 方法 |

---

## 六、测试验证

1. 启动桌面端应用
2. 进入视频管理页面
3. 点击"开始批量重新探测"
4. 立即跳转到其他页面
5. 返回视频管理页面，确认探测仍在进行
6. 测试取消功能
7. 验证数据库中的任务状态更新
