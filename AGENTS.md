# 项目规则（AI 必读）

> 本文件为 AI 工具执行任务前的必读规则。任何涉及数据库结构改动的任务，必须完整遵守「数据库 Schema 变更规则」。

## 需求留档与全程对照机制（铁律）

> 适用于任何原始需求，无论功能大小、涉及桌面端/移动端/基建。任何 AI 助手处理需求时必须遵守，违反视为未完成。

### 铁律
1. 接收原始需求后，必须先完成「需求留档」，才允许进一步分析或动手。
2. 每轮分析/方案/代码/口头确认之前，必须对照留档逐条核查，一次都不许跳。
3. 发现偏离时禁止自行调整，必须指出偏离点 → 向用户确认 → 同步更新留档后才能继续。

### 机制速查
- **留档位置**：`.trae/documents/<功能名>_plan.md`（工具文档，不提交）；已有同名文档则追加，不另起新档。
- **留档固定两节**：
  - 「原始需求」：尽量逐字记录用户原话；无法逐字时标注「转述」并请用户确认。
  - 「分析结果」：需求拆解、关键语义（状态由哪个真实数据源/事件驱动）、实现方案、可观测验收清单、场景推演（断网/seek/边界等）。
- **留档粒度**：微需求（一行改动等）同样必须留档，可用极简格式：「原始需求」一句原话 + 「分析结果」几行要点，但留档与对照一次不落。
- **对照时机**：每轮产出新的分析/方案/代码/口头确认之前；被用户询问「是否符合我的想法」时，必须重读留档 + 相关代码核对后再答。
- **偏离处理**：指出「偏离点 vs 原始需求原文」→ 询问用户 → 确认后同步更新「原始需求」与「分析结果」两节。

### 禁止行为
- 不写留档直接分析/动手。
- 用近似语义/代理事件替换需求中的真实语义（典型反例：请求前沿代替播放位置）。
- 被问是否符合需求时只复述代码行为而不对照留档。
- 发现偏离后悄悄改实现或改需求，不告知用户。

### 完成标准
- 留档含「原始需求」「分析结果」两节，且随讨论同步更新。
- 交付前对照留档逐条自查，并向用户报告：哪些与需求一致、哪些为额外行为、哪些偏离已确认。

## 数据库 Schema 变更规则

### 铁律
任何修改 `packages/core/src/db/schema.ts` 中 `SCHEMA_SQL` 的行为（新增表、加列、删列、改列类型/约束、改索引/触发器），必须同时完成「新库路径」与「已有库升级路径」，否则视为未完成。
禁止用删库重建的方式升级：`migrateFromOldSchema()` 仅保留历史用途，不得作为升级手段，也不得依赖用户删库。

### 机制速查
- `SCHEMA_SQL` 是完整 schema 源，全部使用 `CREATE ... IF NOT EXISTS`（幂等），是未来 DB 结构变更的基准文件。
- 桌面端 `apps/desktop/src/db/tauriSqlProvider.ts`：
  - `initSchema()` 每次启动执行 SCHEMA_SQL → 新增表/索引/触发器自动生效。
  - 已有表加列不自动，必须手动在 `initSchema()` 中追加 `addColumnIfMissing(table, column, type)`（当前仅 series_group/series_season）。
- 移动端 `apps/mobile/src/db/expoSqliteProvider.ts`：
  - 版本化迁移：`MIGRATIONS` 数组 + `migrations` 表，启动时增量执行。
  - SCHEMA_SQL 只在全新安装的迁移里执行过，**仅改 SCHEMA_SQL 对已安装用户无效**，任何结构变更都必须新增一条迁移。

### 变更类型 → 必做清单
| 变更类型 | schema.ts | 桌面端 | 移动端 |
|---|---|---|---|
| 新增表 | 加 CREATE TABLE IF NOT EXISTS | 无需额外（启动自动建） | 新增迁移 CREATE TABLE IF NOT EXISTS |
| 已有表加列 | 加列定义 | initSchema() 加 addColumnIfMissing() | 新增迁移 ALTER TABLE ADD COLUMN |
| 新索引/触发器 | 加 | 无需额外 | 新增迁移 |
| 删列/改列类型/改列名/改约束 | 改定义 | 写重建表升级逻辑 | 新增迁移重建表 |

### 重建表标准流程（SQLite 不支持原地改列）
1. `PRAGMA foreign_keys=OFF`
2. `CREATE TABLE 新表（新结构）` → `INSERT INTO 新表 SELECT ... FROM 旧表`（含数据转换）
3. `DROP TABLE 旧表` → `ALTER TABLE 新表 RENAME TO 旧表`
4. 恢复外键，重建索引
5. 若重建的是 `media`，必须先 DROP FTS 触发器与 `media_fts*`，重建后用 `rebuildFts5()`（桌面端）或等价逻辑（移动端）重建全文索引

### SQLite 加列限制
`ALTER TABLE ADD COLUMN` 不能添加 `PRIMARY KEY`/`UNIQUE`/`NOT NULL`（无默认值）列。需要这类约束的列，必须走重建表流程。

### provider 接口 / DAO 同步
改库结构时，涉及新增字段的数据访问必须同步更新三处，不允许只改 schema 而不改代码：
1. `packages/core/src/db/provider.ts`：DatabaseProvider 接口新增对应方法（如 `getHiddenGenres()`）。
2. `apps/desktop/src/db/tauriSqlProvider.ts` 与 `apps/mobile/src/db/expoSqliteProvider.ts`：两端实现同步新增/修改，SQL 行为语义保持一致。
3. `packages/core/src/services/*`：共享业务逻辑若需读取新字段，在此统一修改。

### 完成标准
- `pnpm typecheck` 通过。
- 桌面端升级验证：复制现有库文件（`~/Library/Application Support/com.movie.app.desktop/movieapp.db`）→ 用新代码启动 → `PRAGMA table_info` 确认新列/新表存在、`media` 行数不变、引用新字段的查询正常。
- 所有改动必须同时落到 schema.ts + 桌面端 + 移动端三条路径，缺一不可。

## UI 规范

### 弹窗不透明度规则

弹窗（Dialog / Modal / 底部弹层 / 选择弹层等）主体背景与内部大面积表面必须**不透明**，禁止用半透明背景（`rgba`、`hexToRgba(token, alpha)`、Tailwind `bg-*/N`、`--color-*-alpha`）作为弹窗面板底色，避免背景内容透过弹窗。

- 允许：弹窗背后的半透明遮罩（backdrop，如 `rgba(0,0,0,0.5~0.8)`）。
- 允许：弹窗面板已不透明前提下的小面积选中/状态强调（如 `bg-success/5`、`bg-muted-foreground/10`）。
- 此规则**仅限弹窗**；卡片、按钮、页面其它元素基于 cardOpacity 的半透明设计不受影响。

## 导航返回规则（从哪来回哪去）

> 本项目的核心交互铁律。任何「列表页 → 详情页/播放页 → 返回」类改动，无论哪个 AI 助手编写，必须遵守，违反视为未完成。

### 铁律
任何「列表页 → 详情页/播放页 → 返回」，必须回到**进入前的同一个页面、同一个列表状态**：同一页码、同一筛选条件、同一搜索词、同一滚动位置。
禁止返回时跳到不同页面组件；禁止把列表重置回第 1 页或默认筛选。

### 机制速查
- **列表状态必须可经 URL 恢复**：翻页、筛选变更必须同步写入 URL query（`?page=N&subType=动作&year=2024`），系统/浏览器返回键才能还原。
- **来源信息必须显式传递**：列表页进详情/播放时，用 `navigate(path, { state: { page, type, subType, year, area, episodeType, subtypePage, ... } })` 携带完整来源状态。
- **返回必须还原**：详情页返回用 `getBackUrl()` 依据 `location.state` 生成回源 URL；页面挂载时按 URL/state 初始化页码与筛选，禁止硬编码重置。
- **来源页标记**：子类型页向详情传 `subtypePage: true`，返回据此回子类型页；无此标记一律回分类页（含全部筛选与页码）。

### 禁止行为
- 翻页/筛选只改内存状态、不写 URL。
- 返回时拼出不带页码/筛选参数的 URL。
- 列表页挂载时硬编码 `page: 1` 覆盖应恢复的页码。
- 从 A 列表进详情，返回却落到 B 列表。

### 变更必做清单
改动触碰「跳转/返回/列表加载/URL query」相关代码（如 `DetailPage.getBackUrl`、`CategoryPage`、`SubtypePage`、`HomePage`、`MediaCard`）时，必须：
1. 复查返回 URL 是否含页码与全部筛选。
2. 复查挂载初始化是否按 URL/state 恢复而非硬编码第 1 页。
3. 手动走通三条路径：分类页（无筛选）→详情→返回；分类页（有筛选）→详情→返回；子类型页→详情→返回。

## 提交规范

- 默认单 commit 全量提交：工作区所有代码改动一次提交，除非用户明确要求按功能拆分。
- 提交前 `git status` 核对暂存内容；使用 `git add -A` 前先确认 `.gitignore` 已覆盖工具文档，避免误加。
- 提交信息：中文，`feat:`/`fix:`/`refactor:` 前缀 + 一句话概括本次改动。
- 提交后同时推送两端：`git push origin master`（gitee）与 `git push github master`。
- 提交/推送一律走 `pnpm push "提交信息"`（含版本 tag 全流程）。GitHub 端由 `.github/workflows/release-check.yml` 兜底：push 到 master 时自动补打 `v<版本号>` 标签（版本号以 `package.json` 的 version 为准），随后用 `workflow_dispatch` 显式触发 `build.yml` 在 tag 上构建并生成 GitHub Release 安装包。**注意：GITHUB_TOKEN 推送的 tag 不会自动触发 `build.yml`（GitHub 限制），必须显式 dispatch，否则只有构建产物没有 Release。** **默认不需要手动打标签**；仅当 CI 不可用需手动发布时，才执行 `git tag v<版本号>` 与 `git push github v<版本号>`（手动 push tag 会按 `tags: v*` 正常触发 `build.yml`）。
- 工具文档（`.trae/`、`BUTTON_COLORS.md`、`MOBILE_DESKTOP_DIFF.md`、`主题字色*.md`）永不提交，`.gitignore` 已兜底。
