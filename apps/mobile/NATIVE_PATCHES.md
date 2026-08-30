# 移动端「播放缓冲并发数」（功能12）原生补丁

JS 层已通过 `PlaybackConfig.prefetchConcurrency` 打通：UI 在「使用偏好」页、播放页读取并下发。
iOS 走 expo-video-cache 本地代理（N 并发下载分片），Android 走 OkHttp `maxRequestsPerHost=N`。

# 移动端「预读分片进度」（功能13）原生补丁

JS 层已通过 `PlaybackConfig.showSegmentProgress` 打通：UI 在「使用偏好」页、播放设置菜单读取切换。
核心思路（真数据源，禁止伪造）：**分片加载状态必须来自真实播放器/下载器事件**。

- Android：`expo-video` 的 `VideoPlayer.kt` 扩展 `AnalyticsListener`，用 `onLoadStarted/onLoadCompleted/onLoadError`
  捕获每个真实分片 URL 的状态（0=loading 1=done 2=error），节流写 `cacheDir/segment_progress.json`。
- iOS：`expo-video-cache` 的 `SessionRouter`（URLSessionDataDelegate）在 `didReceiveResponse` 记录
  Content-Length、`didReceive data` 累计真实字节、`didCompleteWithError` 标记 完成/失败，
  节流写 `Library/Caches/segment_progress.json`。
- 两端路径均落在 expo-file-system `Paths.cache` 根下（Android=cacheDir，iOS=NSCachesDirectory），
  与功能12 `prefetch_concurrency` 文件桥机制完全一致。
- JS 层 `apps/mobile/src/services/segmentProgress.ts` 轮询桥文件 + 解析 m3u8 分片清单 +
  用真实播放位置（`player.currentTime`）计算 playing 分片与「预读 Xs」，
  `apps/mobile/src/components/SegmentProgress.tsx` 渲染浮窗（语义对齐桌面 SegmentProgress.tsx）。

Android 无字节级进度回调（Media3 1.9.0 AnalyticsListener 无 onBytesLoaded），下载中呈条纹不确定态（与桌面一致）。

部署时机注意：功能13 依赖功能12 的补丁均在 `apply-native-patches.mjs`（postinstall 自动重打）。

## 自动重打（postinstall）

`apps/mobile/package.json` 已挂 `postinstall: node scripts/apply-native-patches.mjs`。
`pnpm install` 后会自动：
- **Android**：对 `expo-video` 的 `DataSourceUtils.kt` 注入 `maxRequestsPerHost`（读 `cacheDir/prefetch_concurrency`）。已做幂等，重复安装不重复打。
- **Android（功能13）**：对 `expo-video` 的 `VideoPlayer.kt` 注入 AnalyticsListener 分片状态落盘（`cacheDir/segment_progress.json`）。已做幂等。
- **iOS**：对 `expo-video-cache` 暴露 `maxConcurrency`（best-effort，匹配不到 startServer / 并发符号时只打印手动指引，不破坏原库）。
- **iOS（功能13）**：对 `expo-video-cache` 的 `NetworkDownloader.swift` `SessionRouter` 注入分片进度跟踪（`Library/Caches/segment_progress.json`）。已做幂等。

因此**一般不需要手动重打**；仅当 iOS 自动补丁未命中时才按下方手动步骤改。

## 安装依赖（在用户构建环境，沙箱禁止联网安装）

```
cd apps/mobile && pnpm add expo-video-cache@2.1.0
```
（package.json 已声明该依赖，install 后即可使用；未安装时 JS 层自动降级为直连，不崩溃。）

## Android：expo-video DataSourceUtils.kt 注入 maxRequestsPerHost

文件：`node_modules/expo-video/android/src/main/java/expo/modules/video/utils/DataSourceUtils.kt`

1) 顶部 import 增加两行：
```kotlin
import okhttp3.Dispatcher
import java.io.File
```

2) `buildOkHttpDataSourceFactory` 函数，把
```kotlin
  val client = OkHttpClient.Builder().build()
```
替换为：
```kotlin
  // 功能12: N 并发分片读取。运行时并发数由 JS 写入 cacheDir/prefetch_concurrency（expo-file-system cacheDirectory）
  val prefetchFile = File(context.cacheDir, "prefetch_concurrency")
  val maxRequests = if (prefetchFile.exists()) {
    try {
      prefetchFile.readText().trim().toIntOrNull()?.coerceAtLeast(1) ?: 5
    } catch (e: Exception) {
      5
    }
  } else {
    5
  }
  val client = OkHttpClient.Builder()
    .dispatcher(Dispatcher().apply { maxRequestsPerHost = maxRequests })
    .build()
```

JS 侧已写入：`FileSystem.cacheDirectory + 'prefetch_concurrency'`（内容为整数字符串）。
`context.cacheDir` 即 expo-file-system 的 cacheDirectory，路径一致。

## Android（功能13）：VideoPlayer.kt 注入分片状态

文件：`node_modules/expo-video/android/src/main/java/expo/modules/video/player/VideoPlayer.kt`

1) 顶部 import 增加：
```kotlin
import java.io.File
import org.json.JSONArray
import org.json.JSONObject
```

2) 在 `private val analyticsListener = object : AnalyticsListener { ... }` 内追加：
- `onLoadStarted`：`isMediaSegment(uri)` 时 `segmentStates[url] = 0` + `flushSegmentStates()`
- `onLoadCompleted`：写 `segmentStates[url] = 1` + `segmentProgress[url] = 1.0`
- `onLoadError`：写 `segmentStates[url] = 2`
- `flushSegmentStates()`：节流 400ms，序列化 `{updatedAt, segments:[{url,state,progress}]}` 写
  `File(context.cacheDir, "segment_progress.json")`（catch Exception 保证不阻断播放）

`isMediaSegment`：排除 `.m3u8` / `init.mp4` / `.mpd` 等清单与初始化片。

JS 读取：`Paths.cache + 'segment_progress.json'`（`context.cacheDir` 即 cacheDirectory）。

## iOS：expo-video-cache 暴露 maxConcurrency

expo-video-cache 2.1.0 内部并发上限写死为 `32`，位于两处：`NetworkDownloader.swift` 的
`DispatchSemaphore(value: 32)` 与 `config.httpMaximumConnectionsPerHost = 32`。其 `startServer` 是
Expo 的 `AsyncFunction("startServer") { (port, maxCacheSize, headOnlyCache) in ... }` 宏（**不是** `@objc func`）。
`postinstall` 脚本已按下方精确改动自动完成；若需手动，照此改。

文件：
- `node_modules/expo-video-cache/ios/NetworkDownloader.swift`
- `node_modules/expo-video-cache/ios/ExpoVideoCacheModule.swift`

### NetworkDownloader.swift
```swift
// 在 `static let shared = NetworkDownloader()` 之后新增：
/// 功能12: 用户可控的并发分片下载上限（由 JS startServer 的第 4 个参数写入）
static var maxConcurrency: Int = 32

// 替换两处写死的 32：
private let semaphore = DispatchSemaphore(value: NetworkDownloader.maxConcurrency)
config.httpMaximumConnectionsPerHost = NetworkDownloader.maxConcurrency
```

### ExpoVideoCacheModule.swift
```swift
// startServer 增加第 4 个参数，并在闭包开头写入模块变量
AsyncFunction("startServer") { (port: Int?, maxCacheSize: Int?, headOnlyCache: Bool?, maxConcurrency: Int? = 32) in
    NetworkDownloader.maxConcurrency = maxConcurrency ?? 32
    let cacheLimit = maxCacheSize ?? 1_073_741_824 // Default: 1GB
    ...
}
```
JS 侧 `VideoCache.startServer(9000, cacheBytes, false, N)` 的第 4 参即 `maxConcurrency`，
通过 `NetworkDownloader.maxConcurrency` 同时驱动信号量与 `httpMaximumConnectionsPerHost`。

JS 侧调用方式（已写入 PlayScreen）：
```ts
VideoCache.startServer(9000, 500 * 1024 * 1024, false, prefetchConcurrency) // 第 4 参 = N
VideoCache.convertUrl(videoUrl) // 返回走本地代理的 URL
```

## iOS（功能13）：SessionRouter 注入分片进度

文件：`node_modules/expo-video-cache/ios/NetworkDownloader.swift`（`SessionRouter: URLSessionDataDelegate` 内）

自动补丁已在 `// MARK: - URLSessionDataDelegate` 前注入：
- `SegState { state, received, total }` 字典 `segStates[url]` + `lastSegFlush`
- `segTouch(_:received:total:state:)`：加锁更新真实累计字节/总分/状态，节流 `flushSegStates()`
- `flushSegStates()`：≥600ms 节流，JSONSerialization 序列化
  `{updatedAt, segments:[{url,state,progress}]}`，原子写
  `Library/Caches/segment_progress.json`（= expo-file-system `Paths.cache`）

并在三个 delegate 方法注入：
- `didReceive response`：`segTouch(url, total: expectedContentLength)`
- `didReceive data`：`segTouch(url, received: data.count)`
- `didCompleteWithError`：`segTouch(url, state: error == nil ? 1 : 2)`

状态语义（与 Android/桌面一致）：`0=loading 1=done 2=error`；`progress=received/total`。

## 验证

- Android：改并发数 → 重编 Release 包 → 播放时观察分片请求并行度（代理/抓包看同一 host 并发连接数）。
- iOS：同上下，确认本地 `http://localhost:9000` 代理以 N 并发拉取 `.ts` 分片。
- 通用：调大 `prefetchConcurrency` 时 `player.bufferOptions.preferredForwardBufferDuration` 同步放大
  （= max(20, N*8) 秒），使播放器向前调度更多分片供并发填充。

## 已知限制
- 运行时改 N 对「当前正在播放」的视频需重新打开/重进播放页才生效（DataSourceFactory 在源创建时构建；
  forward buffer 通过 `bufferOptions` 即时生效，但并发连接数随下次建源生效）。iOS 代理在离开播放页时停掉、
  下次进入以最新 N 重启；Android 重写 cacheDir 文件，下次建源读取。
- 仅 HLS（`.m3u8`）适用并发分片；非 HLS 源不走代理/并发，功能13 浮窗不显示（无分片清单）。
- iOS 自动补丁若未命中符号，需按上方手动步骤改（库较新/低星，内部结构可能变化）。
- iOS 走代理时 `useCaching: false`（缓存由 expo-video-cache 代理负责），避免双重缓存；Android `useCaching: true`。
- iOS 真机若访问 `http://localhost:9000` 被 ATS 拦截，在 `app.json` 的 `ios.infoPlist.NSAppTransportSecurity`
  增加允许 `localhost` 的例外（通常 `localhost`/`127.0.0.1` 默认豁免，多数情况无需改）。
- 代理端口写死 9000，避免与已占用端口冲突即可。
- 功能13 依赖功能12 的 `useCaching:true`（Android）/ 代理（iOS）下载路径，禁用播放缓冲并发即无分片下载事件，
  浮窗自然为空。
- Android 无字节级进度（Media3 1.9.0 无 onBytesLoaded），下载中为条纹不确定态；完成/失败仍真实精确。

## Android 预编译 AAR 死代码陷阱（必须 buildFromSource 强制源码编译）

**根因**：expo-video（`node_modules/expo-video/expo-module.config.json`）声明了 `android.publication`
（`host.exp.exponent:expo.modules.video:57.0.2`，repository=`local-maven-repo`），且**没有**
`shouldUsePublicationScriptPath`。Expo autolinking 的 `SettingsManager.configurePublication` 中
`evaluateShouldUsePublicationScript` 在无脚本路径时默认 `return true` → `shouldUsePublication=true` →
gradle 直接消费 **local-maven-repo 里的官方预编译 AAR**，`node_modules/expo-video/android` 源码（含所有补丁）
**完全不参与编译**——即 `DataSourceUtils.kt`（功能12）与 `VideoPlayer.kt`（功能13）源码补丁对 Android
来说都是死代码。此前「功能12 在 Android 已真实生效」的记录不成立（既有 debug APK 的 dex 里没有
`prefetch_concurrency` 标记）。

**强制源码编译**：在 `apps/mobile/package.json` 增加
```json
"expo": { "autolinking": { "android": { "buildFromSource": ["expo-video"] } } }
```
`expo-modules-autolinking resolve --platform android` 据此输出 `configuration.buildFromSource`；
Gradle `Configuration` 把每项转成正则匹配 `project.name`，命中即 `forceBuildFromSource=true` →
`shouldUsePublication=false` → expo-video 以源码项目参与编译。验证：`./gradlew projects` 出现
`Project ':expo-video'`（此前只有 `:expo-video-cache`）。

**验证补丁真正进入产物**：`assembleDebug` 后解包 `app-debug.apk` 的 dex，`segment_progress.json` /
`segmentStates` / `isMediaSegment` 字符串出现在 `classes13.dex` 即生效；此前 AAR/旧 APK 中均无这些标记
（`maxRequestsPerHost` 误报为 OkHttp 自身类名 `okhttp3/Dispatcher$maxRequestsPerHost$1`，非功能12 注入）。

**注意**：`./gradlew :expo-video:compileDebugKotlin` 在未 buildFromSource 时实际解析到
`:expo-video-cache` 任务（gradle 路径匹配错觉报 BUILD SUCCESSFUL），不能作为 expo-video 源码编译依据。

**编译要点**：Media3 1.9.0 的 `AnalyticsListener.LoadEventInfo/MediaLoadData` 实际位于
`androidx.media3.exoplayer.source` 包（不是 `AnalyticsListener` 内嵌类），override 签名必须写
`androidx.media3.exoplayer.source.LoadEventInfo` / `.MediaLoadData`，否则 Kotlin 报 overrides nothing。
