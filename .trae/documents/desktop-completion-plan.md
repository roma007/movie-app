# 桌面端完成计划（四端 APP 收尾）

> 本计划是 `monorepo-tauri-refactor.md`（已批准）的延续，聚焦**尚未完成**的步骤 5（剩余）/6/7/8。
> 目标：让 Mac、Windows、iOS、Android 四端均可构建运行。iOS/Android（apps/mobile）已就绪，本计划完成桌面端（apps/desktop，Tauri+React），并修复一个影响两端的共享缺陷（FTS5 搜索同步）。

## Summary（摘要）

完成 `apps/desktop` 桌面端：安装 Rust 工具链与 npm 依赖、生成 Tauri 图标、实现 `TauriSqlProvider`（镜像移动端 `ExpoSqliteProvider`，SQL 完全一致）、搭建 React + shadcn/ui + Tailwind v4 的桌面 UI（侧边栏导航、首页/搜索/详情/播放/收藏/历史/视频源管理/设置）、用 hls.js 实现视频播放器，最后通过类型检查、`tauri dev` 与 `tauri build` 验证。同时在共享 `packages/core` 的 schema 中补全 FTS5 同步触发器（修复两端搜索均返回空的问题）。

## Current State Analysis（现状分析）

### 已完成
- **monorepo 根配置**：`pnpm-workspace.yaml`、`.npmrc`（`node-linker=hoisted`）、`tsconfig.base.json`、根 `package.json`（含 `mobile:ios`/`mobile:android`/`desktop:dev`/`desktop:build`/`typecheck` 脚本）。
- **packages/core**：`types`、`utils/{normalizer,typeMapper,tokenBucket,constants}`、`services/{cmsAdapter,collectorService(class)}`、`db/{provider.ts(接口),schema.ts,rowMappers.ts}`、`store/createStore.ts(工厂)`、`index.ts(统一导出)`。类型检查通过。
- **apps/mobile**：`App.tsx`（initApp 加载态 + Tab+Stack 导航）、`metro.config.js`（monorepo watchFolders + 单例锁定）、`init.ts`、`useAppStore.ts`、`db/expoSqliteProvider.ts`（DatabaseProvider 全量实现）、6 个 RN 页面。类型检查通过。
- **apps/desktop 骨架**：`package.json`、`vite.config.ts`、`tsconfig.json`、`index.html`、`src-tauri/{Cargo.toml,build.rs,src/lib.rs,src/main.rs,tauri.conf.json,capabilities/default.json}`。Rust 侧已注册 `tauri-plugin-sql` + migrations（建表 SQL 内联，与 schema.ts 一致）。

### 未完成 / 阻塞项
1. **Rust 工具链未安装**：`rustc`/`cargo` 不可用，`~/.cargo` 不存在。上一会话在沙箱非交互环境下 `rustup` 安装失败。→ 阻塞 `tauri dev`/`tauri build`。
2. **desktop npm 依赖未安装**：`apps/desktop/node_modules` 不存在，根 `node_modules/@tauri-apps` 未 hoist。→ 阻塞所有 TS 工作。
3. **Tauri 图标缺失**：`tauri.conf.json` 引用 `icons/{32x32.png,...,icon.icns,icon.ico}`，但 `apps/desktop/src-tauri/icons/` 目录不存在。→ `tauri build` 会失败。
4. **桌面端 src 代码全部缺失**：`main.tsx`/`App.tsx`/`db/tauriSqlProvider.ts`/`init.ts`/`pages/*`/`components/*` 均未创建。
5. **shadcn/ui 未初始化**：无 `components.json`、无 `src/lib/utils.ts`、无 Tailwind 入口 CSS。
6. **⚠️ 共享缺陷（影响两端）**：`schema.ts` 创建了 `media_fts` 虚拟表，但无 `media → media_fts` 的同步触发器；`upsertMedia` 也不写 FTS。结果：`searchMedia`（FTS MATCH 查询）在两端都返回空。必须修复才能让搜索可用。

### 关键契约（实现依据）
- `DatabaseProvider` 接口（30+ 方法 + `init()`）：见 [provider.ts](file:///Users/mengfeng/我的文档/源码/movie-app/packages/core/src/db/provider.ts)。
- 移动端实现参考（SQL 逐条复用）：[expoSqliteProvider.ts](file:///Users/mengfeng/我的文档/源码/movie-app/apps/mobile/src/db/expoSqliteProvider.ts)。
- Store 工厂与 hook 模式：[createStore.ts](file:///Users/mengfeng/我的文档/源码/movie-app/packages/core/src/store/createStore.ts)、[init.ts](file:///Users/mengfeng/我的文档/源码/movie-app/apps/mobile/src/init.ts)、[useAppStore.ts](file:///Users/mengfeng/我的文档/源码/movie-app/apps/mobile/src/useAppStore.ts)。
- core 导出面：[index.ts](file:///Users/mengfeng/我的文档/源码/movie-app/packages/core/src/index.ts)（导出 `DatabaseProvider`、`createAppStore`、`CollectorService`、`defaultSources`、rowMappers、SQL 常量等）。

## Proposed Changes（变更清单）

### Phase A — 环境与依赖（前置，部分需用户配合）

**A1. 安装桌面端 npm 依赖**
- 命令：`pnpm install --no-frozen-lockfile`（在仓库根执行，hoisted 模式会把 react/vite/@tauri-apps/* 等装到根 node_modules）。
- 作用：让 desktop 的 TS 能解析 `@tauri-apps/plugin-sql`、`react`、`hls.js`、`@movie-app/core` 等类型。

**A2. 安装 Rust 工具链**
- 优先尝试（沙箱内，非交互）：`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/rustup-init.sh && sh /tmp/rustup-init.sh -y --default-toolchain stable --profile minimal`，完成后 `source "$HOME/.cargo/env"`。
- 验证：`rustc --version` && `cargo --version`。
- 若沙箱仍失败（网络/权限）：需用户在终端用 `! ` 前缀手动执行 `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`（交互式安装），完成后告知继续。
- 作用：编译 Tauri Rust 后端。

**A3. 生成 Tauri 图标**
- 准备一张 1024×1024 的源图标 PNG（放 `apps/desktop/src-tauri/app-icon.png`）。若无现成素材，先用占位纯色 PNG（后续可替换）。
- 命令：`pnpm --filter @movie-app/desktop tauri icon src-tauri/app-icon.png`（`@tauri-apps/cli` 已在 devDeps）。
- 作用：生成 `icons/` 下所有尺寸（含 `.icns`/`.ico`），满足 `tauri.conf.json` 引用。

### Phase B — 修复共享 FTS5 同步缺陷（两端受益）

**B1. `packages/core/src/db/schema.ts`**（修改）
- 在 `SCHEMA_SQL` 末尾追加 3 个触发器，保持 `media_fts` 与 `media` 同步：
  - `media_ai` AFTER INSERT：`INSERT INTO media_fts(rowid,title,alias,original_title,director,cast) VALUES (new.rowid,new.title,new.alias,new.original_title,new.director,new.cast)`
  - `media_ad` AFTER DELETE：`INSERT INTO media_fts(media_fts,rowid,title,alias,original_title,director,cast) VALUES('delete',old.rowid,...)`
  - `media_au` AFTER UPDATE（仅当相关列变化时）：先 delete 再 insert（或用 `INSERT INTO media_fts(media_fts,...) VALUES('delete',...)` + 重新 insert）。
- 理由：FTS5 外部内容表（`content='media'`）必须靠触发器维护索引行，否则 MATCH 查询永远为空。

**B2. `apps/desktop/src-tauri/src/lib.rs`**（修改）
- 把 `SCHEMA_SQL` 常量替换为引用 core schema.ts 的同款内容（Rust 无法 import TS，需手动同步这 3 个触发器）。
- 理由：桌面端 migrations 必须与共享 schema 完全一致，否则两端 FTS 行为不一致。
- 注：迁移版本号可保持为 1（因 DB 尚未发布，无线上数据需迁移）。若担心重复执行，所有语句均为 `CREATE TRIGGER IF NOT EXISTS`。

**B3. 移动端验证（无需改码）**
- schema.ts 修改后 `ExpoSqliteProvider.init()` 会执行新触发器 SQL（逐条 `execAsync`），移动端搜索随之可用。无需改动 mobile 代码。

### Phase C — 桌面端数据库层

**C1. `apps/desktop/src/db/tauriSqlProvider.ts`**（新建）
- 实现 `DatabaseProvider`，用 `@tauri-apps/plugin-sql` 的 `Database`。
- API 映射（关键差异）：
  - 初始化：`const db = await Database.load('sqlite:movieapp.db');`（migrations 由 Rust 侧 lib.rs 自动跑，TS 侧不再执行 SCHEMA_SQL）。
  - 但仍需执行 `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;`（通过 `db.execute`）+ `insertDefaultSources()`（复用 core 的 `COUNT_VIDEO_SOURCE_SQL`/`INSERT_DEFAULT_SOURCE_SQL`/`defaultSources`）。
  - 单行查询：`select<T[]>(sql, params)` 返回数组 → 取 `[0] ?? null`（对应移动端 `getFirstAsync`）。
  - 多行查询：`select<T[]>(sql, params)` 直接返回（对应 `getAllAsync`）。
  - 写入：`await db.execute(sql, params)`（对应 `runAsync`，忽略返回的 `lastInsertId/rowsAffected`）。
- SQL 语句**逐条**从 [expoSqliteProvider.ts](file:///Users/mengfeng/我的文档/源码/movie-app/apps/mobile/src/db/expoSqliteProvider.ts) 复制，仅替换 API 调用形式；rowMapper 复用 core 的 `rowToMedia` 等。
- 注意：`@tauri-apps/plugin-sql` 的 `select` 参数绑定用数组，与 expo-sqlite 一致。

**C2. `apps/desktop/src/init.ts`**（新建，镜像 mobile/src/init.ts）
- `initApp()`：`new TauriSqlProvider()` → `init()` → `createAppStore(provider)` + `new CollectorService(provider)`，幂等（`_initPromise`）。
- 导出 `getStore()`/`getCollector()`/`getProvider()`。

**C3. `apps/desktop/src/useAppStore.ts`**（新建，镜像 mobile/src/useAppStore.ts）
- `useAppStore<T>(selector?)` hook，内部 `getStore()`；re-export `getStore/getCollector/initApp`。

### Phase D — 桌面端 UI 框架

**D1. Tailwind v4 + shadcn/ui 基础**
- `apps/desktop/src/index.css`（新建）：`@import "tailwindcss";` + 暗色主题变量（`--background: #0f0f0f`、`--foreground`、`--card`、`--primary: #4a9eff` 等，用 `@theme`/CSS 变量，与移动端配色一致）。在 `main.tsx` import。
- `apps/desktop/src/lib/utils.ts`（新建）：`cn(...)` = `twMerge(clsx(...))`（shadcn 标准工具）。
- `apps/desktop/components.json`（新建）：shadcn 配置（style: default, baseColor: zinc, cssVariables: true, alias `@/components`、`@/lib/utils`）。
- 因 `@tailwindcss/vite` 已配，无需 `tailwind.config.js`（v4 零配置）。

**D2. shadcn 组件**
- 用 `pnpm dlx shadcn@latest add button input card tabs scroll-area dialog dropdown-menu switch label badge` 添加到 `src/components/ui/`。
- 作用：复用成熟组件，符合用户偏好栈。

**D3. `apps/desktop/src/main.tsx`**（新建）
- `createRoot(document.getElementById('root')!).render(<App/>)`，import `./index.css`，import `@tauri-apps/plugin-sql`（确保插件被 bundle）。

**D4. `apps/desktop/src/App.tsx`**（新建）
- 初始化流程：`initApp()` 完成前显示加载态，完成后渲染 `BrowserRouter` + `<Layout>` 包裹的 `<Routes>`。
- 路由（React Router v7）：`/` 首页、`/search` 搜索、`/media/:id` 详情、`/play/:episodeId` 播放、`/favorites` 收藏、`/history` 历史、`/sources` 视频源管理、`/settings` 设置。

**D5. `apps/desktop/src/components/Layout.tsx`**（新建）
- 桌面端交互习惯：**左侧固定侧边栏**（导航项：首页/搜索/收藏/历史/视频源/设置，用 lucide-react 图标）+ 右侧主内容区（`<Outlet/>`）。
- 暗色背景 `#0f0f0f`，侧边栏 `#161616`，主区背景 `#0f0f0f`。
- 区别于移动端底部 Tab。

**D6. 页面（新建 `apps/desktop/src/pages/`，功能与 mobile 对齐，用 shadcn 组件 + Tailwind）**
- `HomePage.tsx`：`loadMediaList` → 卡片网格（poster + title + year），支持按 type/year 筛选、分页。
- `SearchPage.tsx`：搜索框 + 触发 `collector.collectByKeyword` + `searchMedia` → 结果网格。
- `DetailPage.tsx`：`loadMediaDetail`/`loadSeasons`/`loadEpisodes`；海报+信息+简介+导演演员+季数选择+剧集列表；点击剧集 → `/play/:episodeId`。
- `PlayPage.tsx`：加载 `getEpisodeById` + 关联 `playSources`；渲染 `<VideoPlayer url=...>`；保存观看进度。
- `FavoritesPage.tsx`：`loadFavorites` → 列表。
- `HistoryPage.tsx`：`loadWatchHistory` → 列表 + 清除/删除。
- `SourceManagerPage.tsx`：`loadVideoSources` → 卡片列表 + 启用 Switch + 上下移 + 删除 + 添加（dialog 表单）。
- `SettingsPage.tsx`：视频源入口、清除历史、版本信息。

**D7. `apps/desktop/src/components/player/VideoPlayer.tsx`**（新建）
- 用 hls.js + HTML5 `<video>`。
- 逻辑：若 URL 以 `.m3u8` 结尾或为 HLS → `new Hls(); hls.loadSource(url)`；否则直接 `<video src=url>`（Safari 原生 HLS 也可走此分支）。
- 控制条：用原生 `controls`（满足用户「显示当前时间/总时长」诉求；进度条原生含缓冲进度）。
- 错误/加载态覆盖层；卸载时 `hls.destroy()`。
- 满足用户偏好：简单、非过度复杂的核心播放实现。

### Phase E — 验证

**E1. 类型检查**：`pnpm typecheck`（根 `-r typecheck`，core + mobile + desktop 全过）。
**E2. 桌面端开发运行**：`pnpm desktop:dev` → Tauri 窗口打开 → 侧边栏导航 → 搜索采集 → 详情 → hls.js 播放。
**E3. 共享逻辑一致性**：两端搜同一关键词，结果一致（验证 core 抽象 + FTS 触发器生效）。
**E4. 打包**：`pnpm desktop:build` → 生成 macOS `.dmg`/`.app`（Windows 打包需在 Windows 环境 + MSVC Build Tools + WebView2，跨平台时再执行）。
**E5. 移动端回归**：`pnpm mobile:ios` → iOS 模拟器启动 → 验证 FTS 修复后搜索可用。

## Assumptions & Decisions（假设与决策）

1. **架构沿用已批准方案**：Tauri 桌面 + RN 移动，monorepo 共享 core，UI 分别实现。不再重新讨论。
2. **TauriSqlProvider 镜像 ExpoSqliteProvider**：SQL 逐条复用，仅 API 形式不同（select 返回数组，单行取 `[0]`）。migrations 由 Rust 侧负责，TS 侧不建表（仅 PRAGMA + 默认源）。
3. **FTS5 同步触发器**：用 `CREATE TRIGGER IF NOT EXISTS` 的 AFTER INSERT/DELETE/UPDATE 三触发器方案（FTS5 外部内容表标准做法），两端共享，版本号保持 1（无线上数据）。
4. **桌面 UI 用侧边栏导航**（区别于移动端底部 Tab），符合桌面交互习惯；配色与移动端统一暗色 `#0f0f0f`。
5. **视频播放器**：hls.js + 原生 `<video controls>`，保持简单；不引入重型播放器框架。
6. **Rust 安装**：先尝试沙箱非交互 `-y`，失败则需用户用 `! ` 前缀手动交互安装。这是唯一需要用户配合的环节。
7. **桌面 tsconfig.json 清理**：移除已弃用的 `baseUrl`，保留 `paths`（TS 5+ paths 不依赖 baseUrl，相对 tsconfig 解析）。
8. **不引入新业务功能**：仅完成四端构建与功能对齐；新增的视频源管理/收藏/历史已在 mobile 实现，desktop 对齐即可。

## Verification Steps（验证步骤）

1. `rustc --version` && `cargo --version` —— Rust 可用。
2. `pnpm install --no-frozen-lockfile` 成功，`apps/desktop/node_modules` 存在。
3. `pnpm --filter @movie-app/desktop tauri icon ...` 生成 `icons/` 目录。
4. `pnpm typecheck` 全 workspace 通过（含 FTS 触发器改动后 core/mobile/desktop）。
5. `pnpm desktop:dev`：窗口启动，首页/搜索/详情/播放链路通畅，搜索能返回结果（验证 FTS 触发器）。
6. `pnpm mobile:ios`：模拟器启动，搜索返回结果（验证两端共享修复）。
7. `pnpm desktop:build`：产出 macOS 安装包（`.dmg`/`.app`）。

## 执行顺序

A（A1→A2→A3）→ B（B1→B2）→ C（C1→C2→C3）→ D（D1→D2→D3→D4→D5→D6→D7）→ E（E1→E2→E3→E4→E5）。

> 注：Phase C/D 的 TS 代码编写不依赖 Rust 编译，可在 A2（Rust 安装）受阻时先行推进；E2/E4 的实际运行/打包需 Rust 就绪。
