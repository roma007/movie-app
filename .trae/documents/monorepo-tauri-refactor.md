# Monorepo 重构方案：支持 Mac/Windows/iOS/Android 四端

## Context（背景与目标）

当前 `movie-app` 是单仓库 React Native + Expo 项目，仅面向 iOS/Android。用户需要同时产出 **Mac、Windows、iOS、Android 四端 APP**。

经确认，采用 **Tauri 桌面 + React Native 移动** 方案，UI 分别实现，共享核心 TS 业务逻辑层。理由：
- Tauri 桌面包体积小（~10MB vs Electron 100MB+）、资源占用低、官方维护
- 桌面端视频用 hls.js（成熟方案），移动端保留 expo-av
- 共享 normalizer/typeMapper/cmsAdapter/采集服务/数据库抽象，避免重复开发

目标产出：重构为 pnpm monorepo，包含共享核心包 `@movie-app/core`、移动端 `apps/mobile`、桌面端 `apps/desktop`，实现四端可构建。

## 技术选型（已确认）

| 端 | 技术 |
|---|---|
| 移动端 iOS/Android | React Native + Expo SDK 57（保留现有） |
| 桌面端 Mac/Windows | Tauri v2 + React 19 + Vite + TypeScript |
| 桌面端 UI | shadcn/ui + Tailwind CSS v4（用户偏好栈） |
| 桌面端视频 | hls.js + HTML5 `<video>` |
| 桌面端存储 | Tauri 官方 `tauri-plugin-sql`（sqlx，FTS5 开箱即用） |
| 共享包管理 | pnpm workspace（`node-linker=hoisted` 兼容 Expo Metro） |
| 共享状态 | Zustand store 工厂（依赖注入 DatabaseProvider） |

## 前置环境准备

需在执行前确认/安装：
1. **pnpm**：`npm i -g pnpm`（或 `corepack enable`）
2. **Rust 工具链**（Tauri 构建必需）：`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
3. macOS 已有 Xcode（已确认）；Windows 构建需 MSVC Build Tools + WebView2（跨平台打包时再说）

## 目标目录结构

```
movie-app/
├── pnpm-workspace.yaml
├── package.json                # 根 workspace 脚本
├── .npmrc                      # node-linker=hoisted
├── tsconfig.base.json
├── packages/
│   └── core/                    # @movie-app/core 共享核心
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── types/index.ts
│           ├── utils/           # normalizer, typeMapper, tokenBucket, constants
│           ├── services/        # cmsAdapter, collectorService(重构为class)
│           ├── db/
│           │   ├── provider.ts  # DatabaseProvider 接口（核心抽象）
│           │   ├── schema.ts    # 建表 SQL
│           │   └── rowMappers.ts# row→领域对象转换（两端共享）
│           └── store/createStore.ts  # Zustand 工厂（注入 db）
├── apps/
│   ├── mobile/                  # @movie-app/mobile (RN+Expo)
│   │   ├── app.json, metro.config.js, App.tsx, index.ts
│   │   └── src/
│   │       ├── pages/          # 现有 RN 页面迁移
│   │       ├── db/expoSqliteProvider.ts  # DatabaseProvider 实现
│   │       └── init.ts         # 初始化注入
│   └── desktop/                 # @movie-app/desktop (Tauri+React)
│       ├── vite.config.ts, index.html, package.json
│       ├── src/
│       │   ├── main.tsx, App.tsx
│       │   ├── pages/          # React + shadcn/ui 页面
│       │   ├── components/{ui,player}/
│       │   ├── db/tauriSqlProvider.ts  # DatabaseProvider 实现
│       │   └── init.ts
│       └── src-tauri/
│           ├── Cargo.toml, tauri.conf.json
│           ├── capabilities/default.json
│           └── src/{main.rs, lib.rs}  # 注册 tauri-plugin-sql
```

## 核心设计：数据库抽象层

**关键**：定义 `DatabaseProvider` 接口（`packages/core/src/db/provider.ts`），包含现有 6 个 DAO 的全部方法签名（getMediaById/upsertMedia/searchMedia/getEpisodesByMediaId/toggleFavorite/upsertWatchHistory 等共 30+ 方法 + `init()`）。

- `collectorService` 和 `createStore(db)` 通过依赖注入接收 `DatabaseProvider` 实例，与具体 SQLite 实现解耦
- `rowMappers.ts`（rowToMedia/rowToEpisode 等）放 core 中，两端共享
- `schema.ts` 建表 SQL 两端共享
- 移动端 `ExpoSqliteProvider`：复用现有 DAO 的 SQL（`getFirstAsync`/`getAllAsync`/`runAsync`）
- 桌面端 `TauriSqlProvider`：SQL 完全相同，API 映射为 `select()`/`execute()`（单行取 `[0]`）

接口定义见现有 DAO 方法签名：[mediaDao.ts](file:///Users/mengfeng/我的文档/源码/movie-app/src/database/mediaDao.ts)、[episodeDao.ts](file:///Users/mengfeng/我的文档/源码/movie-app/src/database/episodeDao.ts)、[videoSourceDao.ts](file:///Users/mengfeng/我的文档/源码/movie-app/src/database/videoSourceDao.ts)、[playSourceDao.ts](file:///Users/mengfeng/我的文档/源码/movie-app/src/database/playSourceDao.ts)、[favoriteDao.ts](file:///Users/mengfeng/我的文档/源码/movie-app/src/database/favoriteDao.ts)、[watchHistoryDao.ts](file:///Users/mengfeng/我的文档/源码/movie-app/src/database/watchHistoryDao.ts)。

## 实施步骤

### 步骤 1：创建 monorepo 根配置
- 清理根目录现有 Expo 文件（App.tsx/index.ts/app.json/tsconfig.json/package.json/node_modules 临时保留）
- 创建 `pnpm-workspace.yaml`、根 `package.json`（含 mobile/desktop/filter 脚本）、`.npmrc`（`node-linker=hoisted`）、`tsconfig.base.json`
- 创建 `apps/`、`packages/` 目录

### 步骤 2：抽取 `packages/core`
- 创建 `packages/core/`，初始化 package.json（name: `@movie-app/core`，main: `src/index.ts`，依赖 axios/opencc-js/zustand）
- 迁移纯 TS 文件：[src/types/index.ts](file:///Users/mengfeng/我的文档/源码/movie-app/src/types/index.ts)、[src/utils/normalizer.ts](file:///Users/mengfeng/我的文档/源码/movie-app/src/utils/normalizer.ts)、[typeMapper.ts](file:///Users/mengfeng/我的文档/源码/movie-app/src/utils/typeMapper.ts)、[tokenBucket.ts](file:///Users/mengfeng/我的文档/源码/movie-app/src/utils/tokenBucket.ts)、[constants.ts](file:///Users/mengfeng/我的文档/源码/movie-app/src/utils/constants.ts)、[cmsAdapter.ts](file:///Users/mengfeng/我的文档/源码/movie-app/src/services/cmsAdapter.ts)
- 新建 `db/provider.ts`（DatabaseProvider 接口）、`db/schema.ts`（从 [database/index.ts](file:///Users/mengfeng/我的文档/源码/movie-app/src/database/index.ts) 抽取建表 SQL）、`db/rowMappers.ts`（从各 DAO 抽取 rowToXxx）
- 重构 [collectorService.ts](file:///Users/mengfeng/我的文档/源码/movie-app/src/services/collectorService.ts)：改为 class，构造函数注入 DatabaseProvider，DAO 调用改为 `this.db.xxx`
- 重构 [useAppStore.ts](file:///Users/mengfeng/我的文档/源码/movie-app/src/store/useAppStore.ts) → `createStore.ts`：改为 `createAppStore(db)` 工厂，DAO 调用改为 `db.xxx`

### 步骤 3：迁移移动端到 `apps/mobile`
- 创建 `apps/mobile/`，配置 package.json（依赖 `@movie-app/core: workspace:*` + expo 相关）、app.json、tsconfig.json、metro.config.js（monorepo watchFolders + 单例锁定）
- 迁移 App.tsx、index.ts、src/pages/（6 个 RN 页面）
- 创建 `src/db/expoSqliteProvider.ts`：实现 DatabaseProvider（SQL 复用现有 DAO，this.db 访问）
- 创建 `src/init.ts`：`new ExpoSqliteProvider()` → `init()` → `createAppStore(provider)`
- 修改页面中 store 引用方式

### 步骤 4：验证移动端
- `pnpm install`
- `pnpm mobile:ios` 验证 iOS 模拟器运行正常
- 功能回归：列表加载、搜索、详情、采集

### 步骤 5：创建 Tauri 桌面端骨架
- 在 `apps/desktop/` 用 `pnpm create tauri-app` 创建 Tauri v2 + React + Vite + TS 项目
- 配置 `vite.config.ts`（Tailwind v4 插件）、`src-tauri/Cargo.toml`（加 `tauri-plugin-sql --features sqlite`）
- 配置 `src-tauri/src/lib.rs`：注册 SQL 插件 + migrations（用 schema.ts 的 SQL）
- 配置 `src-tauri/capabilities/default.json`：SQL 权限
- 配置 `src-tauri/tauri.conf.json`：frontendDist/devUrl
- `pnpm dlx shadcn@latest init` 初始化 shadcn/ui
- 添加 `@movie-app/core: workspace:*` 依赖

### 步骤 6：实现桌面端数据库层
- 创建 `src/db/tauriSqlProvider.ts`：实现 DatabaseProvider（SQL 与移动端相同，API 映射 select/execute）
- 复用 core 的 rowMappers/schema
- 创建 `src/init.ts`：初始化 provider + store
- 验证 FTS5 搜索在 Tauri SQL 下工作

### 步骤 7：桌面端 UI 框架
- 安装 shadcn/ui 组件（button, input, card, dialog, tabs, scroll-area, dropdown-menu）
- 创建 Layout.tsx：**侧边栏导航**（首页/搜索/收藏/历史/设置）+ 主内容区（桌面端交互习惯，区别于移动端底部 Tab）
- 实现 HomePage、SearchPage、DetailPage、SettingsPage、SourceManagerPage
- 实现 PlayPage + VideoPlayer.tsx（hls.js，Safari 原生 HLS 优先）
- React Router 路由配置
- 暗色主题 `#0f0f0f`（与移动端一致）

### 步骤 8：打包验证
- macOS：`pnpm desktop:build` → 生成 .dmg/.app
- iOS/Android：`pnpm mobile:ios` / `mobile:android`
- Windows 打包：跨平台时在 Windows 环境执行（需 MSVC Build Tools）

## 关键文件清单（实现时最关键）

**新建**：
1. `packages/core/src/db/provider.ts` — DatabaseProvider 接口（核心契约）
2. `packages/core/src/store/createStore.ts` — Zustand 工厂（注入 db）
3. `apps/mobile/src/db/expoSqliteProvider.ts` — 移动端实现
4. `apps/desktop/src/db/tauriSqlProvider.ts` — 桌面端实现
5. `apps/desktop/src/components/player/VideoPlayer.tsx` — hls.js 播放器

**重构**：
- [collectorService.ts](file:///Users/mengfeng/我的文档/源码/movie-app/src/services/collectorService.ts) → class + 依赖注入
- [useAppStore.ts](file:///Users/mengfeng/我的文档/源码/movie-app/src/store/useAppStore.ts) → createStore 工厂

**SQL 复用来源**（实现两 provider 时对照）：
- [database/index.ts](file:///Users/mengfeng/我的文档/源码/movie-app/src/database/index.ts) 建表 SQL
- [mediaDao.ts](file:///Users/mengfeng/我的文档/源码/movie-app/src/database/mediaDao.ts) 含 FTS5 搜索（最复杂）

## 验证方式

1. **移动端**：`pnpm mobile:ios` → iOS 模拟器启动 → 首页加载 → 搜索采集 → 详情页 → 播放
2. **桌面端**：`pnpm desktop:dev` → Tauri 窗口打开 → 侧边栏导航 → 搜索 → 详情 → hls.js 播放视频
3. **共享逻辑**：两端搜索同一关键词，结果一致（验证 core 抽象正确）
4. **类型检查**：`pnpm typecheck` 全 workspace 通过
5. **打包**：`pnpm desktop:build` 生成 Mac .dmg；`pnpm mobile:ios` 真机/模拟器

## 风险与应对

| 风险 | 应对 |
|---|---|
| pnpm + Expo Metro 解析 | `.npmrc` 设 `node-linker=hoisted`；metro.config.js 单例锁定 react/react-native/expo |
| Tauri SQL 无显式事务 | WAL 模式 + 单条 upsert 已足够；复杂事务后续加 Rust 命令 |
| FTS5 在 Tauri 不可用 | sqlx bundled SQLite 默认含 FTS5；极端情况降级 LIKE 查询 |
| Rust 未安装 | 步骤 5 前确认 `rustc --version`，未装则 `rustup` 安装 |
