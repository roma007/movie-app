# 项目规则（AI 必读）

> 本文件为 AI 工具执行任务前的必读规则。任何涉及数据库结构改动的任务，必须完整遵守「数据库 Schema 变更规则」。

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

## 提交规范

- 默认单 commit 全量提交：工作区所有代码改动一次提交，除非用户明确要求按功能拆分。
- 提交前 `git status` 核对暂存内容；使用 `git add -A` 前先确认 `.gitignore` 已覆盖工具文档，避免误加。
- 提交信息：中文，`feat:`/`fix:`/`refactor:` 前缀 + 一句话概括本次改动。
- 提交后同时推送两端：`git push origin master`（gitee）与 `git push github master`。
- GitHub Actions（`.github/workflows/build.yml`）会在 push 到 master 时自动构建安装包；如需生成 GitHub Release 安装包，必须额外打版本标签并推送：`git tag v<版本号>` 与 `git push github v<版本号>`（版本号以 `package.json` 的 version 为准，如 `v1.0.39`），仅推 master 不会创建 Release。
- 工具文档（`.trae/`、`BUTTON_COLORS.md`、`MOBILE_DESKTOP_DIFF.md`、`主题字色*.md`）永不提交，`.gitignore` 已兜底。
