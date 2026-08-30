# 项目规则（AI 必读）

> 本文件为 AI 工具执行任务前的必读规则。任何涉及数据库结构改动的任务，必须完整遵守「数据库 Schema 变更规则」。

## 语言规则（铁律）

> 与用户的所有交流（包括代码 commit message）一律使用**中文**回复，禁止使用英文或中英混杂输出。

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
- 工具文档（`.trae/`、`BUTTON_COLORS.md`、`MOBILE_DESKTOP_DIFF.md`、`主题字色*.md`）永不提交，`.gitignore` 已兜底。

## 移动端构建同步铁律（模拟器 + iPhone 保持最新）

> 任何修改移动端代码（`apps/mobile`、`packages/core` 被移动端消费的 JS/TS）后，必须同时构建部署到**安卓模拟器**与 **iPhone 真机（MfiPhone）**，保证两端运行的都是最新构建。违反视为未完成。

### 机制速查
- 模拟器/真机运行的是独立安装包（embedded bundle），不会自动获取源码新改动；必须重新构建安装后才生效。
- **安卓模拟器更新命令**：
  ```
  cd apps/mobile/android && ./gradlew :app:assembleDebug
  adb -s emulator-5554 install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
  adb -s emulator-5554 shell am start -n com.movie.app/.MainActivity
  ```
- **iPhone 真机更新命令**（实测可用，**不要用 `npx expo run:ios --device MfiPhone`**——expo CLI 用 `xcrun xctrace list devices` 匹配设备，而 MfiPhone 在 xctrace 被判 offline，永匹配不到；须用 devicectl 标识符构建+安装+启动）：
  ```
  cd apps/mobile/ios
  APP_DIR=$(xcodebuild -workspace MovieApp.xcworkspace -scheme MovieApp -configuration Release -showBuildSettings 2>/dev/null | awk '/ BUILT_PRODUCTS_DIR =/{print $3}')
  xcodebuild -workspace MovieApp.xcworkspace -scheme MovieApp -configuration Release \
    -destination 'platform=iOS,id=1D4B63FE-82F6-5C8B-9C7F-DAA006E0B13D' -allowProvisioningUpdates build
  xcrun devicectl device install app --device 1D4B63FE-82F6-5C8B-9C7F-DAA006E0B13D "$APP_DIR/MovieApp.app"
  xcrun devicectl device process launch --device 1D4B63FE-82F6-5C8B-9C7F-DAA006E0B13D com.mengfeng.movieapp
  ```
  Release 独立包，内嵌最新 JS；部署前置条件见「移动端真机部署」节。**由 AI 执行，不得推给用户/等用户手动跑**；构建完成后报告结果。（注意：勿加 `-derivedDataPath` 到项目内——会再编一整份派生目录，此前触发过磁盘满。）
- 两者都以「进入对应页面验证改动已生效」为完成标准（如设置页滑杆可见、日志出现新输出等）。
- 依赖 node_modules 补丁（`DataSourceUtils.kt` 并发、`expo-modules-jsi` no-op 等）在重装/重编时有丢失风险；构建异常时报错优先对照 `apps/mobile/NATIVE_PATCHES.md` 重打，不得擅自绕过。

## 推荐分数增量重算规则（铁律）

> 任何改动涉及 `packages/core/src/services/recommendationService.ts` 的 `personal_score` / 增量重算 / `recomputePersonalScores` 时，必须遵守。违反视为未完成。

### 正确性判据
增量重算结果必须等于「从零全量重算」结果（同一 `now` 下逐 media 分数一致）。任何增量 / 缓存 / 短路优化都不得破坏此判据。

### 影响集 A 必须覆盖的输入
`A` 为需重算的 media 集合，必须包含所有因本次变更分数会改变的 media，包括「移除类操作」（取消收藏 / 取消不喜欢）使 media 离开当前行为集的情况（用 `lastBehaviorMediaIds` 记录上次并集，`A` 取 `currentB ∪ prevB`）。

### personal_score 不得依赖当前时间 now
`recentFactor`（已看抑制）已移至展示层 `reorder`，**不得**放回 `computeMediaScore` / `personal_score`。坏源豁免 `exemptMedia` 为永久豁免，不依赖时间窗口。

### 兴趣画像必须每次重建，禁止陈旧缓存
`buildUserInterestTags` 须每次重算时基于当前行为数据重建，**不得**缓存复用旧 interest（否则增量复用陈旧值，与全量不一致）。

## 移动端真机开发流程（事实，供参考）

> 用户已于 2026-08-28 明确授权「任何拦路虎全部删除」，解除原「真机开发铁律（禁止安装/卸载任何东西）」中阻碍功能开发/原生补丁/依赖管理的条款（留档：`.trae/documents/mobile_segment_progress_plan.md` 偏离记录）。以下仅保留流程事实。

### 真机运行方式
1. **真机运行 = 编译内嵌代码的独立包**：`cd apps/mobile && npx expo run:ios --device MfiPhone --configuration Release`（经实测此命令匹配不到 MfiPhone，改用「移动端构建同步铁律」节的 xcodebuild + devicectl 命令）。
   - 产出的 App 内嵌当前 JS，装到手机后独立运行，不依赖 Metro、不需要 dev-client。
2. **看代码改动 = 重编一次**：改了任何 JS / `packages/core` 源码 / 原生补丁后，想在看效果就再跑一次上面的命令重编重装。
3. **Metro 不用于真机**：真机不连 Metro、不使用 dev-client。Mac 上的 Metro 仅用于 iOS 模拟器。

### 模拟器（可选）
- 如需热重载看改动，用 **iOS 模拟器**：`npx expo start` 后按 `i`（或 `expo run:ios` 编模拟器）。模拟器 `localhost` = Mac，Metro 热重载即时生效。
- 真机走上面的 Release 独立包流程，二者不可混用。

## 移动端真机部署（Xcode 26.6 + iOS 18 设备）

> 本机真机：iPhone XS Max（设备名 `MfiPhone`，UDID `00008020-0008053001E9002E`），iOS 18.7.10。**XS Max 最高仅支持 iOS 18，无法升级 iOS 26**。

### 铁律（版本死结）
- 项目所有 expo 预编译库（ExpoModulesCore、ExpoModulesJSI 等）均为 **Swift 6.2 / Xcode 26** 产物；Xcode 16.4（Swift 6.1）编译器无法消费其模块接口（报 `this SDK is not supported` / `unknown attribute '_Concurrency.MainActor'`）。
- 结论：**必须用 Xcode 26.6 编译**；但 Xcode 26.6 默认不带 iOS 18 支持，需额外步骤才能部署到 iOS 18 真机。Xcode 16.4 能部署 iOS 18 却编不了 6.2 库——二者不可兼得，故统一走 Xcode 26.6。

### 正确部署步骤（一次性环境准备 + 后续复用）
1. `sudo xcode-select -s /Applications/Xcode.app`（Xcode 26.6 路径），`xcodebuild -version` 应为 26.6。
2. 安装 iOS 26.5 platform（Xcode 26.6 把真机也当作需 iOS 26.5 platform 的 destination，否则报 `iOS 26.5 is not installed`）：`xcodebuild -downloadPlatform iOS`（下载 iOS 26.5，无需 sudo，Xcode.app 归用户所有）。
3. 在 **Xcode 26.6** 的 Settings › Accounts 登录 Apple ID（16.4 的账号不共享），否则报 `No Accounts` / `No profiles`。登录后 Xcode 自动关联本机证书并生成 `com.mengfeng.movieapp` 的 development profile。
4. 运行：`cd apps/mobile/ios` 后用「移动端构建同步铁律」节的 xcodebuild + devicectl 命令（构建、安装、启动三步）。手机与 Mac 同 WiFi，安装后独立运行（不连 Metro）。

### 已知临时 workaround（node_modules 内，不提交，必要时可删）
- `node_modules/expo-modules-jsi/apple/scripts/build-xcframework.sh` 被改为 no-op（`exit 0`），复用 8/24 预编译的 Swift 6.2 xcframework，避免重建。若 `pod install` 重置该脚本，Xcode 26.6 下原始脚本也能正常重建 6.2 xcframework，无需该 hack。
- **切勿用 Xcode 16.4 编此项目**（必失败于 ExpoModulesCore / ExpoModulesJSI 的 Swift 6.2 接口）。

### 为什么 Xcode 26.6 能部署 iOS 18
Xcode 26 用 CoreDevice 机制连真机，不依赖传统 DeviceSupport 目录；`xcrun devicectl list devices` 已显示 MfiPhone `available (paired)`。构建用 iOS 26.5 SDK、deployment target 设为 ≤ iOS 18 即可装到 iOS 18.7.10。

## 安卓模拟器 DNS（沙箱事实，AI 必知）

> 本机安卓模拟器（`avd name = movieapp`，序列号 `emulator-5554`）DNS 默认失效。

- **唯一修复**：启动时必须带 `-dns-server`，运行时无法改（`adb root` / `setprop` 在 production build 无效）：
  ```
  adb -s emulator-5554 emu kill          # 先 kill，禁止同 AVD 多实例
  sleep 2
  emulator -avd movieapp -dns-server 8.8.8.8,8.8.4.4
  ```
- **验证**：`adb -s emulator-5554 shell ping -c 2 www.baidu.com` 应解析并收到回包。
