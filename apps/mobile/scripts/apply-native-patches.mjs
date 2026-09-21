// 功能12: 应用移动端「N 并发分片读取」所需的 node_modules 原生补丁。
// - Android: 给 expo-video 的 DataSourceUtils.kt 注入 maxRequestsPerHost（读 cacheDir/prefetch_concurrency）。
// - iOS: 给 expo-video-cache 暴露 maxConcurrency（best-effort，匹配不到则打印手动指引，不破坏原库）。
// 该脚本在 pnpm install 后（postinstall）自动运行，保证重装后补丁不丢。
// 任何异常都不抛出，避免阻断安装流程。

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function resolvePkg(name) {
  try {
    return dirname(require.resolve(`${name}/package.json`));
  } catch {
    return null;
  }
}

function walk(dir, ext, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    try {
      const st = statSync(p);
      if (st.isDirectory()) walk(p, ext, out);
      else if (p.endsWith(ext)) out.push(p);
    } catch {}
  }
  return out;
}

// ---------- Android: expo-video DataSourceUtils.kt ----------
function patchAndroid() {
  const pkgDir = resolvePkg('expo-video');
  if (!pkgDir) {
    console.log('[patch] expo-video 未安装，跳过 Android 补丁');
    return;
  }
  const file = join(pkgDir, 'android/src/main/java/expo/modules/video/utils/DataSourceUtils.kt');
  if (!existsSync(file)) {
    console.log('[patch] DataSourceUtils.kt 未找到，跳过 Android 补丁');
    return;
  }
  let content = readFileSync(file, 'utf8');
  if (content.includes('功能12')) {
    console.log('[patch] Android 已打补丁，跳过');
    return;
  }
  // 注入 import
  if (!content.includes('import okhttp3.Dispatcher')) {
    content = content.replace(
      'import okhttp3.OkHttpClient\n',
      'import okhttp3.OkHttpClient\nimport okhttp3.Dispatcher\nimport java.io.File\n'
    );
  }
  const origLine = '  val client = OkHttpClient.Builder().build()';
  if (!content.includes(origLine)) {
    console.log('[patch][Android] 未匹配到 OkHttpClient 构建行，需手动补丁（见 NATIVE_PATCHES.md）');
    return;
  }
  const patched = `  // 功能12: 移动端 N 并发分片读取。运行时并发数由 JS 写入 cacheDir/prefetch_concurrency（expo-file-system cacheDirectory）
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
    .build()`;
  content = content.replace(origLine, patched);
  writeFileSync(file, content);
  console.log('[patch] Android DataSourceUtils.kt 已打补丁');
}

// ---------- Android: VideoPlayer.kt 注入 AnalyticsListener，记录真实分片加载状态 ----------
function patchAndroidSegmentProgress() {
  const pkgDir = resolvePkg('expo-video');
  if (!pkgDir) {
    console.log('[patch] expo-video 未安装，跳过 Android 分片进度补丁');
    return;
  }
  const file = join(pkgDir, 'android/src/main/java/expo/modules/video/player/VideoPlayer.kt');
  if (!existsSync(file)) {
    console.log('[patch] VideoPlayer.kt 未找到，跳过 Android 分片进度补丁');
    return;
  }
  let content = readFileSync(file, 'utf8');
  if (content.includes('功能13')) {
    console.log('[patch] Android 分片进度已打补丁，跳过');
    return;
  }
  // 注入 import：java.io.File、org.json
  if (!content.includes('import java.io.File\n')) {
    content = content.replace(
      'import java.io.FileInputStream\n',
      'import java.io.FileInputStream\nimport java.io.File\nimport org.json.JSONArray\nimport org.json.JSONObject\n'
    );
  }
  // 在 analyticsListener 中追加分片状态跟踪（在 onVideoInputFormatChanged 结束、对象闭合之前注入）
  const anchor = '    override fun onVideoInputFormatChanged(eventTime: AnalyticsListener.EventTime, format: Format, decoderReuseEvaluation: DecoderReuseEvaluation?) {\n      currentVideoTrack = availableVideoTracks.firstOrNull { it.format?.id == format.id }\n      super.onVideoInputFormatChanged(eventTime, format, decoderReuseEvaluation)\n    }\n  }';
  if (!content.includes(anchor)) {
    console.log('[patch][Android] 未匹配到 analyticsListener 锚点，需手动补丁（见 NATIVE_PATCHES.md）');
    return;
  }
  const injected = `    override fun onVideoInputFormatChanged(eventTime: AnalyticsListener.EventTime, format: Format, decoderReuseEvaluation: DecoderReuseEvaluation?) {
      currentVideoTrack = availableVideoTracks.firstOrNull { it.format?.id == format.id }
      super.onVideoInputFormatChanged(eventTime, format, decoderReuseEvaluation)
    }

    // 功能13: 移动端「预读分片进度」- 以真实分片加载事件驱动（禁止伪造）。
    // 状态写入 cacheDir/segment_progress.json，JS 轮询读取渲染（与 prefetch_concurrency 同文件桥机制）。
    private val segmentStates = java.util.concurrent.ConcurrentHashMap<String, Int>()
    private val segmentProgress = java.util.concurrent.ConcurrentHashMap<String, Double>()
    private var lastSegmentFlush = 0L

    private fun isMediaSegment(uri: String?): Boolean {
      if (uri == null) return false
      val u = uri.lowercase()
      if (u.contains(".m3u8") || u.contains("init.mp4") || u.contains(".mpd")) return false
      return true
    }

    private fun flushSegmentStates() {
      val now = System.currentTimeMillis()
      if (now - lastSegmentFlush < 400) return
      lastSegmentFlush = now
      try {
        val arr = JSONArray()
        segmentStates.forEach { (uri, state) ->
          val o = JSONObject()
          o.put("url", uri)
          o.put("state", state) // 0=loading 1=done 2=error
          o.put("progress", segmentProgress[uri] ?: if (state == 1) 1.0 else 0.0)
          arr.put(o)
        }
        val root = JSONObject()
        root.put("updatedAt", now)
        root.put("segments", arr)
        val file = File(context.cacheDir, "segment_progress.json")
        file.writeText(root.toString())
      } catch (e: Exception) {
        // best-effort，不阻断播放
      }
    }

    override fun onLoadStarted(eventTime: AnalyticsListener.EventTime, loadEventInfo: androidx.media3.exoplayer.source.LoadEventInfo, mediaLoadData: androidx.media3.exoplayer.source.MediaLoadData) {
      if (isMediaSegment(loadEventInfo.uri?.toString())) {
        segmentStates[loadEventInfo.uri.toString()] = 0
        flushSegmentStates()
      }
      super.onLoadStarted(eventTime, loadEventInfo, mediaLoadData)
    }

    override fun onLoadCompleted(eventTime: AnalyticsListener.EventTime, loadEventInfo: androidx.media3.exoplayer.source.LoadEventInfo, mediaLoadData: androidx.media3.exoplayer.source.MediaLoadData) {
      if (isMediaSegment(loadEventInfo.uri?.toString())) {
        segmentStates[loadEventInfo.uri.toString()] = 1
        segmentProgress[loadEventInfo.uri.toString()] = 1.0
        flushSegmentStates()
      }
      super.onLoadCompleted(eventTime, loadEventInfo, mediaLoadData)
    }

    override fun onLoadError(eventTime: AnalyticsListener.EventTime, loadEventInfo: androidx.media3.exoplayer.source.LoadEventInfo, mediaLoadData: androidx.media3.exoplayer.source.MediaLoadData, error: java.io.IOException, wasCanceled: Boolean) {
      if (isMediaSegment(loadEventInfo.uri?.toString())) {
        segmentStates[loadEventInfo.uri.toString()] = 2
        flushSegmentStates()
      }
      super.onLoadError(eventTime, loadEventInfo, mediaLoadData, error, wasCanceled)
    }
  }`;
  content = content.replace(anchor, injected);
  writeFileSync(file, content);
  console.log('[patch] Android VideoPlayer.kt 已注入分片进度补丁');
}

// ---------- Android: expo-video PiP 窗口按视频真实比例 ----------
// 功能PiP: 让竖屏视频进入 PiP 时窗口也是竖屏。原实现 contentFit=cover 时用 View 尺寸（全屏横屏），
// PiP 窗口变横屏。补丁四点：
//   1) PictureInPictureUtils.kt 的 calculatePiPAspectRatio 优先用 player.videoSize 真实尺寸
//   2) PictureInPictureUtils.kt 的 applyRectHint 合并 aspectRatio，避免裸 rectHint 重置横屏
//   3) PictureInPictureManager.kt 的 enterPictureInPictureMode 携带 aspectRatio（不被空 params 覆盖），
//      applyPipParamsForView/findAndSetupPipCandidate 不清掉它
//   4) FullscreenPlayerActivity.kt 的 applyRectHint 同样带上 aspectRatio
function patchAndroidPipAspectRatio() {
  const pkgDir = resolvePkg('expo-video');
  if (!pkgDir) {
    console.log('[patch] expo-video 未安装，跳过 Android PiP 比例补丁');
    return;
  }

  // 1)+2) PictureInPictureUtils.kt
  const utilsFile = join(pkgDir, 'android/src/main/java/expo/modules/video/utils/PictureInPictureUtils.kt');
  if (existsSync(utilsFile)) {
    let content = readFileSync(utilsFile, 'utf8');
    const utilsPatched = content.includes('功能PiP');
    // 2a) calculatePiPAspectRatio 优先视频真实尺寸
    if (!content.includes('功能PiP')) {
      const orig = `internal fun calculatePiPAspectRatio(videoSize: VideoSize, viewWidth: Int, viewHeight: Int, contentFit: ContentFit): Rational {
  var aspectRatio = if (contentFit == ContentFit.CONTAIN) {
    Rational(videoSize.width, videoSize.height)
  } else {
    Rational(viewWidth, viewHeight)
  }`;
      if (!content.includes(orig)) {
        console.log('[patch][Android] 未匹配到 calculatePiPAspectRatio 锚点，需手动补丁（见 NATIVE_PATCHES.md）');
      } else {
        const patched = `internal fun calculatePiPAspectRatio(videoSize: VideoSize, viewWidth: Int, viewHeight: Int, contentFit: ContentFit): Rational {
  // 功能PiP: 始终优先使用视频真实尺寸，保证竖屏视频进入 PiP 时窗口也是竖屏，
  // 不受 contentFit=cover 时使用 View 尺寸（全屏横屏）的影响。
  var aspectRatio = if (videoSize.width > 0 && videoSize.height > 0) {
    Rational(videoSize.width, videoSize.height)
  } else if (contentFit == ContentFit.CONTAIN) {
    Rational(videoSize.width, videoSize.height)
  } else {
    Rational(viewWidth, viewHeight)
  }`;
        content = content.replace(orig, patched);
      }
    }
    // 2b) applyRectHint 合并 aspectRatio（裸 rectHint 会把竖屏比例重置为横屏）
    if (!content.includes('合并 rectHint 与 aspectRatio')) {
      const origRectHint = `internal fun applyRectHint(activity: Activity, rectHint: Rect) {
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && isPictureInPictureSupported(activity)) {
    runWithPiPMisconfigurationSoftHandling {
      activity.setPictureInPictureParams(PictureInPictureParams.Builder().setSourceRectHint(rectHint).build())
    }
  }
}`;
      if (!content.includes(origRectHint)) {
        console.log('[patch][Android] 未匹配到 applyRectHint 锚点，需手动补丁（见 NATIVE_PATCHES.md）');
      } else {
        const patchedRectHint = `internal fun applyRectHint(activity: Activity, rectHint: Rect, aspectRatio: Rational? = null) {
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && isPictureInPictureSupported(activity)) {
    val safeAspectRatio = aspectRatio?.takeIf { it.toFloat() in 0.41841..2.39 }
    runWithPiPMisconfigurationSoftHandling {
      // 功能PiP: 合并 rectHint 与 aspectRatio，避免裸设 rectHint 把竖屏比例重置为默认横屏
      val b = PictureInPictureParams.Builder().setSourceRectHint(rectHint)
      safeAspectRatio?.let { b.setAspectRatio(it) }
      activity.setPictureInPictureParams(b.build())
    }
  }
}`;
        content = content.replace(origRectHint, patchedRectHint);
      }
    }
    if (!utilsPatched && (content.includes('功能PiP') || content.includes('合并 rectHint 与 aspectRatio'))) {
      writeFileSync(utilsFile, content);
      console.log('[patch] Android PictureInPictureUtils.kt 已打补丁（PiP 按视频真实比例）');
    } else {
      console.log('[patch] Android PiP 比例(Utils)已打补丁，跳过');
    }
  }

  // 3) PictureInPictureManager.kt
  const mgrFile = join(pkgDir, 'android/src/main/java/expo/modules/video/managers/PictureInPictureManager.kt');
  if (existsSync(mgrFile)) {
    let content = readFileSync(mgrFile, 'utf8');
    if (content.includes('功能PiP')) {
      console.log('[patch] Android PiP 比例(Manager)已打补丁，跳过');
    } else {
    // 3a) enterPictureInPictureMode 带 aspectRatio
    const origEnter = `    currentPiPViewCandidate = WeakReference(videoView)
    applyPipParamsForView(videoView)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      mainActivity.enterPictureInPictureMode(PictureInPictureParams.Builder().build())`;
    if (!content.includes(origEnter)) {
      console.log('[patch][Android] 未匹配到 enterPictureInPictureMode 锚点，需手动补丁（见 NATIVE_PATCHES.md）');
      return;
    }
    const patchedEnter = `    currentPiPViewCandidate = WeakReference(videoView)
    applyPipParamsForView(videoView)

    // 功能PiP: 用视频真实 aspectRatio 进入 PiP，避免空 params 默认横屏
    val pipBuilder = PictureInPictureParams.Builder()
    videoView.pipParams.aspectRatio?.let {
      if (it.toFloat() in 0.41841..2.39) {
        pipBuilder.setAspectRatio(it)
      }
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      mainActivity.enterPictureInPictureMode(pipBuilder.build())`;
    content = content.replace(origEnter, patchedEnter);

    // 3b) findAndSetupPipCandidate 不清掉 aspectRatio
    const origCandidate = `    if (!newAutoEnter) {
      mainActivity.get()?.let {
        applyPiPParams(it, autoEnterPiP)
      }
    }`;
    const patchedCandidate = `    if (!newAutoEnter) {
      mainActivity.get()?.let {
        applyPiPParams(it, autoEnterPiP, currentPiPViewCandidate.get()?.pipParams?.aspectRatio)
      }
    }`;
    if (content.includes(origCandidate)) {
      content = content.replace(origCandidate, patchedCandidate);
    }

    // 3c) applyPipParamsForView 给 applyRectHint 传 aspectRatio
    const origForView = `    mainActivity.get()?.let {
      applyRectHint(it, calculateRectHint(view.playerView))
      applyPiPParams(it, autoEnterPiP, view.pipParams.aspectRatio)
    }`;
    const patchedForView = `    mainActivity.get()?.let {
      applyRectHint(it, calculateRectHint(view.playerView), view.pipParams.aspectRatio)
      applyPiPParams(it, autoEnterPiP, view.pipParams.aspectRatio)
    }`;
    if (content.includes(origForView)) {
      content = content.replace(origForView, patchedForView);
    }
    writeFileSync(mgrFile, content);
    console.log('[patch] Android PictureInPictureManager.kt 已打补丁（PiP 进入/保持视频比例）');
    }
  }

  // 4) FullscreenPlayerActivity.kt 的 applyRectHint 带上 aspectRatio
  const fsFile = join(pkgDir, 'android/src/main/java/expo/modules/video/FullscreenPlayerActivity.kt');
  if (existsSync(fsFile)) {
    let content = readFileSync(fsFile, 'utf8');
    const origFs = `playerView.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
      applyRectHint(this, calculateRectHint(playerView))
    }`;
    const patchedFs = `playerView.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
      val ar = playerView.player?.let { calculatePiPAspectRatio(it.videoSize, playerView.width, playerView.height, videoView.contentFit) }
      applyRectHint(this, calculateRectHint(playerView), ar)
    }`;
    if (content.includes(patchedFs)) {
      console.log('[patch] Android PiP 比例(Fullscreen)已打补丁，跳过');
    } else if (content.includes(origFs)) {
      content = content.replace(origFs, patchedFs);
      writeFileSync(fsFile, content);
      console.log('[patch] Android FullscreenPlayerActivity.kt 已打补丁（PiP 比例保持）');
    } else {
      console.log('[patch][Android] 未匹配到 FullscreenPlayerActivity anchor，跳过（不影响主路径）');
    }
  }
}

// ---------- iOS: expo-video-cache 暴露 maxConcurrency（best-effort）----------

// 功能13: 在 SessionRouter 内记录真实分片下载状态（didReceiveResponse 拿 total，didReceive 累加 received，
// didCompleteWithError 标记 done/error），节流写入 Library/Caches/segment_progress.json 供 JS 轮询渲染。
function patchIOSessionRouter(content) {
  // 1) 注入 import Foundation/JSON（已有 Foundation；iOS13+ 用 JSONEncoder 无需手动 JSON）
  // 2) SessionRouter 内注入状态字典与写入方法（挂在 NetworkDownloader.swift 的 SessionRouter class 内）
  const classAnchor = '// MARK: - URLSessionDataDelegate';
  if (!content.includes(classAnchor)) {
    console.log('[patch][iOS] 未匹配到 SessionRouter 锚点，跳过分片进度补丁（不影响功能12）');
    return content;
  }
  const injected = `    // 功能13: 预读分片进度 - 以真实下载器事件驱动（禁止伪造）。
    private struct SegState { var state: Int; var received: Int64; var total: Int64 }
    private var segStates = [String: SegState]()
    private var lastSegFlush: CFAbsoluteTime = 0

    private func segIsSegment(_ url: String) -> Bool {
      let u = url.lowercased()
      if u.contains(".m3u8") || u.contains("init.mp4") || u.contains(".mpd") { return false }
      return true
    }

    private func segTouch(_ url: String, received delta: Int64 = 0, total: Int64 = -1, state: Int? = nil) {
      guard segIsSegment(url) else { return }
      lock.lock()
      var st = segStates[url] ?? SegState(state: 0, received: 0, total: 0)
      st.received += delta
      if total >= 0 { st.total = total }
      if let s = state { st.state = s }
      segStates[url] = st
      lock.unlock()
      flushSegStates()
    }

    private func flushSegStates() {
      let now = CFAbsoluteTimeGetCurrent()
      if now - lastSegFlush < 0.6 { return }
      lastSegFlush = now
      lock.lock()
      let snapshot = segStates
      lock.unlock()
      // 下载回调线程外写文件，避免阻塞
      DispatchQueue.global(qos: .utility).async { [snapshot] in
        var items: [[String: Any]] = []
        for (url, st) in snapshot {
          let progress = st.total > 0 ? min(1.0, Double(st.received) / Double(st.total)) : (st.state == 1 ? 1.0 : 0.0)
          items.append(["url": url, "state": st.state, "progress": progress])
        }
        let root: [String: Any] = [
          "updatedAt": Date().timeIntervalSince1970 * 1000,
          "segments": items
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: root) else { return }
        guard let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return }
        let file = dir.appendingPathComponent("segment_progress.json")
        try? data.write(to: file, options: .atomic)
      }
    }

    // MARK: - URLSessionDataDelegate`;
  content = content.replace(classAnchor, injected);

  // 在 didReceive data 中累加字节并上报
  content = content.replace(
    `    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        let task = tasks[dataTask.taskIdentifier]
        lock.unlock()
        
        // Safe unwrapping
        if let task = task {
            task.delegate?.didReceiveData(task: task, data: data)
        }
    }`,
    `    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        let task = tasks[dataTask.taskIdentifier]
        lock.unlock()

        // 功能13: 累计已接收字节（真实下载进度）
        if let url = dataTask.originalRequest?.url?.absoluteString {
            segTouch(url, received: Int64(data.count))
        }
        
        // Safe unwrapping
        if let task = task {
            task.delegate?.didReceiveData(task: task, data: data)
        }
    }`
  );

  // 在 didReceive response 中记录 Content-Length
  content = content.replace(
    `    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        lock.lock()
        let task = tasks[dataTask.taskIdentifier]
        lock.unlock()
        `,
    `    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        lock.lock()
        let task = tasks[dataTask.taskIdentifier]
        lock.unlock()

        // 功能13: 记录 Content-Length（expectedContentLength）作为进度分母
        if let url = dataTask.originalRequest?.url?.absoluteString {
            segTouch(url, total: Int64(response.expectedContentLength))
        }
        `
  );

  // 在 didCompleteWithError 中标记 done/error
  content = content.replace(
    `    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let networkTask = tasks[task.taskIdentifier]
        lock.unlock()
        `,
    `    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let networkTask = tasks[task.taskIdentifier]
        lock.unlock()

        // 功能13: 完成/失败状态
        if let url = task.originalRequest?.url?.absoluteString {
            segTouch(url, state: error == nil ? 1 : 2)
        }
        `
  );
  return content;
}
function patchIOS() {
  const pkgDir = resolvePkg('expo-video-cache');
  if (!pkgDir) {
    console.log('[patch] expo-video-cache 未安装，跳过 iOS 补丁（安装后重跑本脚本即可）');
    return;
  }
  const nd = join(pkgDir, 'ios', 'NetworkDownloader.swift');
  const mod = join(pkgDir, 'ios', 'ExpoVideoCacheModule.swift');
  if (!existsSync(nd) || !existsSync(mod)) {
    console.log('[patch] expo-video-cache ios 源文件缺失，跳过 iOS 补丁');
    return;
  }
  let nContent = readFileSync(nd, 'utf8');
  let mContent = readFileSync(mod, 'utf8');
  // 功能12: NetworkDownloader 并发上限（幂等注入）
  if (!nContent.includes('static var maxConcurrency')) {
    nContent = nContent.replace(
      '    static let shared = NetworkDownloader()\n',
      '    static let shared = NetworkDownloader()\n    /// 功能12: 用户可控的并发分片下载上限（由 JS startServer 的第 4 个参数写入）\n    static var maxConcurrency: Int = 32\n'
    );
  }
  if (!nContent.includes('DispatchSemaphore(value: NetworkDownloader.maxConcurrency)')) {
    nContent = nContent.replace(
      'private let semaphore = DispatchSemaphore(value: 32)',
      'private let semaphore = DispatchSemaphore(value: NetworkDownloader.maxConcurrency)'
    );
  }
  if (!nContent.includes('config.httpMaximumConnectionsPerHost = NetworkDownloader.maxConcurrency')) {
    nContent = nContent.replace(
      'config.httpMaximumConnectionsPerHost = 32',
      'config.httpMaximumConnectionsPerHost = NetworkDownloader.maxConcurrency'
    );
  }
  // 功能13: SessionRouter 内注入分片状态记录（state 0=loading 1=done 2=error）
  if (!nContent.includes('功能13: 预读分片进度')) {
    nContent = patchIOSessionRouter(nContent);
  }
  // Module：startServer 增加 maxConcurrency 参数并写入 NetworkDownloader.maxConcurrency
  if (mContent.includes('AsyncFunction("startServer")') && !mContent.includes('maxConcurrency')) {
    mContent = mContent.replace(
      'AsyncFunction("startServer") { (port: Int?, maxCacheSize: Int?, headOnlyCache: Bool?) in',
      'AsyncFunction("startServer") { (port: Int?, maxCacheSize: Int?, headOnlyCache: Bool?, maxConcurrency: Int?) in\n            NetworkDownloader.maxConcurrency = maxConcurrency ?? 32'
    );
  }
  writeFileSync(nd, nContent);
  writeFileSync(mod, mContent);
  console.log('[patch] iOS expo-video-cache 已打补丁（NetworkDownloader + SessionRouter + ExpoVideoCacheModule）');
}

// ---------- iOS: 功能15 播放静默停排查 - expo-video-cache 数据链路打点 ----------
// 背景：播中「静默停」时 isPlaying=false 但无 error/loading。需区分「磁盘直读卡死」「Range 失配
// 等字节」「网络下载挂起」。打点追加写 Library/Caches/vc_trace.log（与 segment_progress.json 同目录，
// 可用 devicectl copy 拉取），JS play_trace.log 负责上层事件、此处负责下层字节流。
function patchIOSTrace() {
  const pkgDir = resolvePkg('expo-video-cache');
  if (!pkgDir) {
    console.log('[patch] expo-video-cache 未安装，跳过 iOS 数据链路打点');
    return;
  }
  const nd = join(pkgDir, 'ios', 'NetworkDownloader.swift');
  const ds = join(pkgDir, 'ios', 'DataSource.swift');
  const cch = join(pkgDir, 'ios', 'ClientConnectionHandler.swift');
  if (!existsSync(nd) || !existsSync(ds) || !existsSync(cch)) {
    console.log('[patch] expo-video-cache ios 源文件缺失，跳过 iOS 数据链路打点');
    return;
  }

  // 1) NetworkDownloader.swift：注入 VCTrace 打点器（线程安全追加写文件）
  let nContent = readFileSync(nd, 'utf8');
  if (!nContent.includes('final class VCTrace')) {
    const anchorNW = 'final class NetworkDownloader {';
    if (!nContent.includes(anchorNW)) {
      console.log('[patch][iOS trace] 未匹配到 NetworkDownloader 锚点，跳过打点器注入');
    } else {
      const vctrace = `// 功能15: 播放静默停排查 - 数据链路打点器（追加写 Library/Caches/vc_trace.log）
final class VCTrace {
  static let shared = VCTrace()
  private let queue = DispatchQueue(label: "com.videocache.vctrace")
  private let path: URL
  private init() {
    let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
    self.path = dir.appendingPathComponent("vc_trace.log")
  }
  func log(_ msg: String) {
    queue.async {
      let line = "\\(Self.ts()) \\(msg)\\n"
      if let h = try? FileHandle(forWritingTo: self.path) {
        h.seekToEndOfFile()
        h.write(line.data(using: .utf8)!)
        try? h.close()
      } else {
        try? line.data(using: .utf8)?.write(to: self.path, options: .atomic)
      }
    }
  }
  static func ts() -> String {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
    f.timeZone = TimeZone(abbreviation: "UTC")
    return f.string(from: Date())
  }
}

final class NetworkDownloader {`;
      nContent = nContent.replace(anchorNW, vctrace);
      writeFileSync(nd, nContent);
      console.log('[patch] iOS VCTrace 打点器已注入 NetworkDownloader.swift');
    }
  } else {
    console.log('[patch] iOS VCTrace 打点器已存在，跳过');
  }

  // 2) DataSource.swift：命中/网络/响应/完成打点 + 累计字节
  let dContent = readFileSync(ds, 'utf8');
  if (!dContent.includes('功能15')) {
    // 2a) 累计字节属性（含功能15 标记，保证幂等）
    dContent = dContent.replace(
      '    private var fileHandle: FileHandle?\n    private var isManifest: Bool\n    private let segmentLimit: Int',
      '    private var fileHandle: FileHandle?\n    private var isManifest: Bool\n    private let segmentLimit: Int\n    // 功能15: 累计已读/已下载字节数（打点用）\n    private var receivedBytes: Int64 = 0'
    );
    // 2b) start() 打点（磁盘命中 or 网络）
    dContent = dContent.replace(
      '    func start() {\n        if storage.exists(for: storageKey) {',
      '    func start() {\n        VCTrace.shared.log("DS.start hit=\\(storage.exists(for: storageKey)) manifest=\\(isManifest) key=\\(storageKey)")\n        if storage.exists(for: storageKey) {'
    );
    // 2c) serveFileFromDisk 完成打点（累计下发字节）
    dContent = dContent.replace(
      '        while true {\n            let data = handle.readData(ofLength: 64 * 1024)\n            if data.isEmpty { break }\n            delegate?.didReceiveData(data: data)\n        }\n        \n        try? handle.close()\n        delegate?.didComplete(error: nil)',
      '        while true {\n            let data = handle.readData(ofLength: 64 * 1024)\n            if data.isEmpty { break }\n            receivedBytes += Int64(data.count)\n            delegate?.didReceiveData(data: data)\n        }\n        \n        try? handle.close()\n        VCTrace.shared.log("DS.diskDone sent=\\(receivedBytes) key=\\(storageKey)")\n        delegate?.didComplete(error: nil)'
    );
    // 2d) didReceiveResponse 打点
    dContent = dContent.replace(
      '    func didReceiveResponse(task: NetworkTask, response: URLResponse) {\n        if let httpResponse = response as? HTTPURLResponse {\n            if (200...299).contains(httpResponse.statusCode) {',
      '    func didReceiveResponse(task: NetworkTask, response: URLResponse) {\n        if let httpResponse = response as? HTTPURLResponse {\n            VCTrace.shared.log("DS.resp \\(httpResponse.statusCode) len=\\(response.expectedContentLength) key=\\(storageKey)")\n            if (200...299).contains(httpResponse.statusCode) {'
    );
    // 2e) didReceiveData 累计
    dContent = dContent.replace(
      '    func didReceiveData(task: NetworkTask, data: Data) {\n        delegate?.didReceiveData(data: data)\n        if let handle = fileHandle {\n            try? handle.write(contentsOf: data)\n        }\n    }',
      '    func didReceiveData(task: NetworkTask, data: Data) {\n        receivedBytes += Int64(data.count)\n        delegate?.didReceiveData(data: data)\n        if let handle = fileHandle {\n            try? handle.write(contentsOf: data)\n        }\n    }'
    );
    // 2f) didComplete 打点
    dContent = dContent.replace(
      '        delegate?.didComplete(error: error)\n    }',
      '        VCTrace.shared.log("DS.done sent=\\(receivedBytes) err=\\(error?.localizedDescription ?? "nil") key=\\(storageKey)")\n        delegate?.didComplete(error: error)\n    }'
    );
    // 2g) sendRewrittenManifest 打点（重写后分片数）
    dContent = dContent.replace(
      '    private func sendRewrittenManifest(_ content: String) {\n        let rewritten = rewriteManifest(content, originalUrl: url)',
      '    private func sendRewrittenManifest(_ content: String) {\n        let rewritten = rewriteManifest(content, originalUrl: url)\n        VCTrace.shared.log("DS.manifest seg=\\(rewritten.components(separatedBy: "\\n").filter { $0.hasPrefix("http") }.count) key=\\(storageKey)")'
    );
    // 2h) serveFileFromDisk 起始打点（磁盘直读路径确认）
    dContent = dContent.replace(
      '        let fileSize = (try? FileManager.default.attributesOfItem(atPath: path.path)[.size] as? UInt64) ?? 0\n        \n        if fileSize == 0 {',
      '        let fileSize = (try? FileManager.default.attributesOfItem(atPath: path.path)[.size] as? UInt64) ?? 0\n        VCTrace.shared.log("DS.disk fileSize=\\(fileSize) key=\\(storageKey)")\n        \n        if fileSize == 0 {'
    );
    writeFileSync(ds, dContent);
    console.log('[patch] iOS DataSource.swift 已注入数据链路打点');
  } else {
    console.log('[patch] iOS DataSource.swift 打点已存在，跳过');
  }

  // 3) ClientConnectionHandler.swift：请求 Range / 下发字节打点
  let chContent = readFileSync(cch, 'utf8');
  if (!chContent.includes('功能15')) {
    chContent = chContent.replace(
      '    /// Buffer to accumulate incoming raw HTTP request bytes.\n    private var buffer = Data()',
      '    /// Buffer to accumulate incoming raw HTTP request bytes.\n    private var buffer = Data()\n    /// 功能15: 累计下发给播放器的字节数\n    private var sentToPlayer: Int64 = 0'
    );
    chContent = chContent.replace(
      '        var byteRange: Range<Int>? = nil\n        for line in lines {',
      '        var byteRange: Range<Int>? = nil\n        VCTrace.shared.log("CCH.req path=\\(path) hasRange=\\(lines.contains { $0.lowercased().hasPrefix("range:") })")\n        for line in lines {'
    );
    chContent = chContent.replace(
      '        dataSource?.delegate = self\n        dataSource?.start()',
      '        VCTrace.shared.log("CCH.start key url=\\(url.absoluteString) range=\\(byteRange?.description ?? "nil")")\n        dataSource?.delegate = self\n        dataSource?.start()'
    );
    chContent = chContent.replace(
      '    func didReceiveData(data: Data) {\n        connection.send(content: data, completion: .contentProcessed { _ in })\n    }',
      '    func didReceiveData(data: Data) {\n        sentToPlayer += Int64(data.count)\n        connection.send(content: data, completion: .contentProcessed { _ in })\n    }'
    );
    chContent = chContent.replace(
      '        if error != nil {\n            stop()\n        } else {\n            connection.send(content: nil, contentContext: .defaultStream, isComplete: true, completion: .contentProcessed { [weak self] _ in\n                self?.stop()\n            })\n        }',
      '        VCTrace.shared.log("CCH.done err=\\(error != nil) sent=\\(sentToPlayer)")\n        if error != nil {\n            stop()\n        } else {\n            connection.send(content: nil, contentContext: .defaultStream, isComplete: true, completion: .contentProcessed { [weak self] _ in\n                self?.stop()\n            })\n        }'
    );
    // 3c) CCH.headers 响应码打点（功能15 补充：200/206/404/403 直接可辨）
    chContent = chContent.replace(
      '    func didReceiveHeaders(headers: [String : String], status: Int) {\n        VCTrace.shared.log("CCH.headers status=\\(status) contentLength=\\(headers["Content-Length"] ?? "nil")")\n        var response = "HTTP/1.1 \\(status) \\(status == 200 ? "OK" : "Partial Content")\\r\\n"',
      '    func didReceiveHeaders(headers: [String : String], status: Int) {\n        VCTrace.shared.log("CCH.headers status=\\(status) contentLength=\\(headers["Content-Length"] ?? "nil")")\n        var response = "HTTP/1.1 \\(status) \\(status == 200 ? "OK" : "Partial Content")\\r\\n"'
    );
    writeFileSync(cch, chContent);
    console.log('[patch] iOS ClientConnectionHandler.swift 已注入数据链路打点');
  } else {
    console.log('[patch] iOS ClientConnectionHandler.swift 打点已存在，跳过');
  }

  // 4) expo-video: AVPlayer 自身状态打点（功能16，静默停直接看 reasonForWaitingToPlay）
  // 背景：供给链（功能15）已证明数据就绪，卡点只剩 AVPlayer 播控/解码。此打点输出
  // timeControlStatus 变化 + reason + currentTime + bufferedPosition + item 状态，可分辨
  // 「等数据(.toMinimizeStalls/.insufficientMediaData)」vs「速率评估卡住(.evaluatingBufferingRate)」
  // vs「seek/无item(.noItemToPlay)」。与功能15 同文件 vc_trace.log，便于对齐时序。
  const exdir = resolvePkg('expo-video');
  if (exdir && existsSync(join(exdir, 'ios', 'ExpoVideo.podspec'))) {
    const vob = join(exdir, 'ios', 'VideoPlayerObserver.swift');
    let voContent = readFileSync(vob, 'utf8');
    if (!voContent.includes('功能16')) {
      // 4a) 注入 descr 辅助函数（文件尾部 extension 之后）
      voContent = voContent.replace(
        "private extension AVPlayerItemAccessLogEvent {\n  // Matches the LogEvent to an existing VideoTrack based on the uri, or returns null if doesn't exist",
        "// 功能16: AVPlayer.TimeControlStatus 描述辅助（打点用）\nprivate func descr(_ s: AVPlayer.TimeControlStatus?) -> String {\n  switch s {\n  case .playing: return \"playing\"\n  case .paused: return \"paused\"\n  case .waitingToPlayAtSpecifiedRate: return \"waiting\"\n  case .none: return \"nil\"\n  @unknown default: return \"unknown\"\n  }\n}\n\nprivate extension AVPlayerItemAccessLogEvent {\n  // Matches the LogEvent to an existing VideoTrack based on the uri, or returns null if doesn't exist"
      );
      // 4b) timeControlStatus 打点（含 reason + 时间 + 缓冲 + item 状态）
      voContent = voContent.replace(
        "  private func onTimeControlStatusChanged(_ player: AVPlayer, _ change: NSKeyValueObservedChange<AVPlayer.TimeControlStatus>) {\n    // iOS changes timeControlStatus after an error, so we need to check for errors.",
        "  private func onTimeControlStatusChanged(_ player: AVPlayer, _ change: NSKeyValueObservedChange<AVPlayer.TimeControlStatus>) {\n    VCTraceExpo.shared.log(\"AVPlayer.tcs old=\\(descr(change.oldValue)) new=\\(descr(player.timeControlStatus)) reason=\\(player.reasonForWaitingToPlay?.rawValue ?? \"nil\") t=\\(player.currentTime().seconds) buf=\\(owner?.bufferedPosition ?? -1) rate=\\(player.rate) itemStatus=\\(player.currentItem?.status.rawValue ?? -1) bufEmpty=\\(player.currentItem?.isPlaybackBufferEmpty ?? false) likelyKeepUp=\\(player.currentItem?.isPlaybackLikelyToKeepUp ?? false)\")\n    // iOS changes timeControlStatus after an error, so we need to check for errors."
      );
      // 4c) bufferEmpty / keepUp 打点
      voContent = voContent.replace(
        "  private func onIsBufferEmptyChanged(_ playerItem: AVPlayerItem, _ change: NSKeyValueObservedChange<Bool>) {\n    if playerItem.isPlaybackBufferEmpty {",
        "  private func onIsBufferEmptyChanged(_ playerItem: AVPlayerItem, _ change: NSKeyValueObservedChange<Bool>) {\n    VCTraceExpo.shared.log(\"AVPlayer.bufEmpty now=\\(playerItem.isPlaybackBufferEmpty) t=\\(player?.currentTime().seconds ?? -1) buf=\\(owner?.bufferedPosition ?? -1)\")\n    if playerItem.isPlaybackBufferEmpty {"
      );
      voContent = voContent.replace(
        "  private func onPlayerLikelyToKeepUpChanged(_ playerItem: AVPlayerItem, _ change: NSKeyValueObservedChange<Bool>) {\n    if !playerItem.isPlaybackLikelyToKeepUp && playerItem.isPlaybackBufferEmpty {",
        "  private func onPlayerLikelyToKeepUpChanged(_ playerItem: AVPlayerItem, _ change: NSKeyValueObservedChange<Bool>) {\n    VCTraceExpo.shared.log(\"AVPlayer.keepUp now=\\(playerItem.isPlaybackLikelyToKeepUp) t=\\(player?.currentTime().seconds ?? -1) buf=\\(owner?.bufferedPosition ?? -1)\")\n    if !playerItem.isPlaybackLikelyToKeepUp && playerItem.isPlaybackBufferEmpty {"
      );
      // 4d) AVPlayerItem 失败时打点完整 NSError（domain/code/msg），区分
      //     「URL 无效」「代理连接拒绝(NSURLError)」「源自身 AVError」等失败类别
      voContent = voContent.replace(
        "    if newStatus == .error {\n      let playerItemError = (playerItem as? VideoPlayerItem)?.urlAsset.transportError ?? playerItem.error ?? error\n      error = PlayerItemLoadException(playerItemError?.localizedDescription)\n      status = .error",
        "    if newStatus == .error {\n      let playerItemError = (playerItem as? VideoPlayerItem)?.urlAsset.transportError ?? playerItem.error ?? error\n      error = PlayerItemLoadException(playerItemError?.localizedDescription)\n      VCTraceExpo.shared.log(\"AVPlayer.itemError domain=\\((playerItemError as NSError?)?.domain ?? \"nil\") code=\\((playerItemError as NSError?)?.code ?? -1) msg=\\(playerItemError?.localizedDescription ?? \"nil\") playerErrDomain=\\(player?.error as NSError? == nil ? \"nil\" : (player?.error as NSError?)!.domain) playerErrCode=\\(player?.error as NSError? == nil ? -1 : (player?.error as NSError?)!.code) t=\\(player?.currentTime().seconds ?? -1)\")\n      status = .error"
      );
      // 4e) 周期采样器（500ms），抓「声音断续但视频不断、无状态跃迁」时的内部抖动：
      //     item 时间基与实际播放时间的漂移（drift）、速率、loadedTimeRanges 水位
      if (!voContent.includes('AVPlayer.samp')) {
        voContent = voContent.replace(
          "  // 功能16 sampler: 500ms 周期采样，抓「声音断续但视频不断、无状态跃迁」时的内部抖动\n  private var samplerTimer: Timer?",
          "  // 功能16 sampler: 500ms 周期采样，抓「声音断续但视频不断、无状态跃迁」时的内部抖动\n  private var samplerTimer: Timer?"
        );
        // 注入 sampler 方法：追在 keepUp 打点函数之后（onPlayerLikelyToKeepUpChanged 方法体内结束 `}\n` 后）
        const keepUpTail = "      status = .readyToPlay\n    }\n  }\n\n  // 功能16 sampler:";
        if (voContent.includes(keepUpTail)) {
          voContent = voContent.replace(
            keepUpTail,
            "      status = .readyToPlay\n    }\n  }\n\n  // 功能16 sampler: 250ms 周期采样（抓无状态跃迁时内部抖动）\n  fileprivate func startSampler() {\n    guard samplerTimer == nil else { return }\n    let t = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in\n      guard let self = self else { return }\n      guard let p = self.player, let item = p.currentItem else { return }\n      let t = p.currentTime().seconds\n      let tb = item.timebase\n      let rate = tb.map { CMTimebaseGetRate($0) } ?? -1\n      let itemTime = tb.map { CMTimeGetSeconds(CMTimebaseGetTime($0)) } ?? -1\n      let drift = (itemTime.isFinite && t.isFinite) ? itemTime - t : -999\n      let loaded = item.loadedTimeRanges.last.map { CMTimeGetSeconds(CMTimeRangeGetEnd($0.timeRangeValue)) } ?? -1\n      VCTraceExpo.shared.log(\"AVPlayer.samp t=\\(t) buf=\\(loaded) itemT=\\(itemTime) drift=\\(String(format: \"%.3f\", drift)) rate=\\(rate) tcs=\\(descr(p.timeControlStatus)) itemStatus=\\(item.status.rawValue)\")\n    }\n    t.tolerance = 0.2\n    RunLoop.main.add(t, forMode: .common)\n    samplerTimer = t\n  }\n\n  fileprivate func stopSampler() {\n    samplerTimer?.invalidate()\n    samplerTimer = nil\n  }"
          );
        }
      }
      // 4f) 生命周期挂载：cleanup() 停止采样
      voContent = voContent.replace(
        "    invalidateCurrentPlayerItemObservers()\n    stopTimeUpdates()\n    stopSampler()",
        "    invalidateCurrentPlayerItemObservers()\n    stopTimeUpdates()\n    stopSampler()"
      );
      if (!voContent.includes('stopTimeUpdates()\n    stopSampler()')) {
        voContent = voContent.replace(
          "    invalidateCurrentPlayerItemObservers()\n    stopTimeUpdates()",
          "    invalidateCurrentPlayerItemObservers()\n    stopTimeUpdates()\n    stopSampler()"
        );
      }
      if (!voContent.includes('    startSampler()')) {
        voContent = voContent.replace(
          "    initializePlayerObservers()\n    self.videoSourceLoader?.registerListener(listener: self)",
          "    initializePlayerObservers()\n    self.videoSourceLoader?.registerListener(listener: self)\n    startSampler()"
        );
      }
      writeFileSync(vob, voContent);
      console.log('[patch] iOS expo-video VideoPlayerObserver.swift 已注入 AVPlayer 状态打点（功能16）');
    } else {
      console.log('[patch] iOS expo-video AVPlayer 打点已存在，跳过');
    }
    // 4d) VCTraceExpo 打点器类（内联进 VideoPlayerObserver.swift，因新增 .swift 文件不被 pod 编译识别）
    if (!voContent.includes('final class VCTraceExpo')) {
      voContent = voContent.replace(
        "// Copyright 2024-present 650 Industries. All rights reserved.\n\nimport Foundation\nimport ExpoModulesCore\nimport AVFoundation",
        "// Copyright 2024-present 650 Industries. All rights reserved.\n\nimport Foundation\nimport ExpoModulesCore\nimport AVFoundation\n\n" + VCE_TRACE_EXPO_CONTENT
      );
      console.log('[patch] iOS expo-video VCTraceExpo 已内联进 VideoPlayerObserver.swift');
    } else {
      console.log('[patch] iOS expo-video VCTraceExpo 已存在，跳过');
    }
    writeFileSync(vob, voContent);
  } else {
    console.log('[patch] expo-video 未找到，跳过 AVPlayer 状态打点');
  }

  // 5) 功能17: JS→native 命令层打点（VideoSourceLoader 加载队列 + VideoPlayer replace/seek）
  // 背景：功能16 只有 AVPlayer 被动状态，缺「用户操作命令」时间线（切源 replace、seek 目标、加载队列取消），
  // 无法把「t 归零」「item failed」对到具体操作。此处补齐命令入口全量记录。
  if (exdir && existsSync(join(exdir, 'ios', 'ExpoVideo.podspec'))) {
    // 5a) VideoSourceLoader.swift：load / cancel 打点
    const vsl = join(exdir, 'ios', 'VideoSourceLoader.swift');
    let vslContent = readFileSync(vsl, 'utf8');
    if (!vslContent.includes('功能17')) {
      vslContent = vslContent.replace(
        '    isLoading = true\n    if let currentTask {\n      currentTask.cancel()',
        '    isLoading = true\n    // 功能17: JS→native 命令层（VSL.load 入口）\n    VCTraceExpo.shared.log("VSL.load start uri=\\(videoSource.uri?.absoluteString ?? "nil") hadTask=\\(currentTask != nil)")\n    if let currentTask {\n      currentTask.cancel()\n      VCTraceExpo.shared.log("VSL.load cancelPrev uri=\\(currentSource?.uri?.absoluteString ?? "nil")")'
      );
      vslContent = vslContent.replace(
        '    isLoading = false\n    self.currentSource = nil\n    self.currentTask = nil\n    return loadingResult.value\n  }',
        '    // 功能17: VSL.load 完成\n    VCTraceExpo.shared.log("VSL.load finished cancelled=\\(loadingResult.isCancelled) item=\\(loadingResult.value == nil)")\n    isLoading = false\n    self.currentSource = nil\n    self.currentTask = nil\n    return loadingResult.value\n  }'
      );
      vslContent = vslContent.replace(
        '  func cancelCurrentTask() {\n    currentTask?.cancel()',
        '  func cancelCurrentTask() {\n    // 功能17: VSL.cancel 命令\n    VCTraceExpo.shared.log("VSL.cancel uri=\\(currentSource?.uri?.absoluteString ?? "nil")")\n    currentTask?.cancel()'
      );
      writeFileSync(vsl, vslContent);
      console.log('[patch] iOS VideoSourceLoader.swift 已注入命令层打点（功能17）');
    } else {
      console.log('[patch] iOS VideoSourceLoader.swift 命令层打点已存在，跳过');
    }

    // 5b) VideoPlayer.swift：replaceCurrentItem(sync/async) + currentTime setter 打点
    const vp = join(exdir, 'ios', 'VideoPlayer.swift');
    let vpContent = readFileSync(vp, 'utf8');
    if (!vpContent.includes('功能17')) {
      vpContent = vpContent.replace(
        '  func replaceCurrentItem(with videoSource: VideoSource?) throws {\n    dangerousPropertiesStore.ownerIsReplacing = true',
        '  func replaceCurrentItem(with videoSource: VideoSource?) throws {\n    // 功能17: VP.replaceSync 命令\n    VCTraceExpo.shared.log("VP.replaceSync uri=\\(videoSource?.uri?.absoluteString ?? "nil") t=\\(currentTime) oldUri=\\((ref.currentItem as? VideoPlayerItem)?.urlAsset.url.absoluteString ?? "nil")")\n    dangerousPropertiesStore.ownerIsReplacing = true'
      );
      vpContent = vpContent.replace(
        '  func replaceCurrentItem(with videoSource: VideoSource?) async throws {\n    guard let videoSource, videoSource.uri != nil else {',
        '  func replaceCurrentItem(with videoSource: VideoSource?) async throws {\n    // 功能17: VP.replaceAsync 命令\n    VCTraceExpo.shared.log("VP.replaceAsync uri=\\(videoSource?.uri?.absoluteString ?? "nil") t=\\(currentTime) oldUri=\\((ref.currentItem as? VideoPlayerItem)?.urlAsset.url.absoluteString ?? "nil")")\n    guard let videoSource, videoSource.uri != nil else {'
      );
      vpContent = vpContent.replace(
        '      let timeToSeek = CMTimeMakeWithSeconds(clampedTime, preferredTimescale: .max)\n\n      // AVPlayer can\'t apply the currentTime while the resource is loading',
        '      let timeToSeek = CMTimeMakeWithSeconds(clampedTime, preferredTimescale: .max)\n      // 功能17: VP.seek 命令\n      VCTraceExpo.shared.log("VP.seek target=\\(clampedTime) currentItemStatus=\\(ref.currentItem?.status.rawValue ?? -1)")\n\n      // AVPlayer can\'t apply the currentTime while the resource is loading'
      );
      writeFileSync(vp, vpContent);
      console.log('[patch] iOS VideoPlayer.swift 已注入命令层打点（功能17）');
    } else {
      console.log('[patch] iOS VideoPlayer.swift 命令层打点已存在，跳过');
    }
  }
}

const VCE_TRACE_EXPO_CONTENT = `// 功能16: 播放「静默停」排查 - AVPlayer 自身状态打点（追加写 Library/Caches/vc_trace.log）
// 直接观察 timeControlStatus + reasonForWaitingToPlay，可分辨「等数据(.toMinimizeStalls/
// .insufficientMediaData)」「速率评估卡住(.evaluatingBufferingRate)」「seek/无item(.noItemToPlay)」。
// 与功能15（expo-video-cache 分片供给）写同一文件，便于对齐时序。
final class VCTraceExpo {
  static let shared = VCTraceExpo()
  private let queue = DispatchQueue(label: "com.movieapp.vctraceexpo")
  private let path: URL
  private init() {
    let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
    self.path = dir.appendingPathComponent("vc_trace.log")
  }
  func log(_ msg: String) {
    queue.async {
      let line = "\\(Self.ts()) \\(msg)\\n"
      if let h = try? FileHandle(forWritingTo: self.path) {
        h.seekToEndOfFile()
        h.write(line.data(using: .utf8)!)
        try? h.close()
      } else {
        try? line.data(using: .utf8)?.write(to: self.path, options: .atomic)
      }
    }
  }
  static func ts() -> String {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
    f.timeZone = TimeZone(abbreviation: "UTC")
    return f.string(from: Date())
  }
}`;

// ---------- iOS: expo-video PiP 主线程补丁 ----------
// 根因：expo-modules AsyncFunction 默认在后台队列执行（expo.modules.AsyncFunctionQueue），
// AVPlayerViewController 的 startPictureInPicture 必须主线程调用，后台线程调用被 AVKit 静默忽略 → 点击 PiP 无效。
function patchIOSPictureInPicture() {
  const pkgDir = resolvePkg('expo-video');
  if (!pkgDir) {
    console.log('[patch] expo-video 未安装，跳过 iOS PiP 补丁');
    return;
  }
  const file = join(pkgDir, 'ios', 'OrientationAVPlayerViewController.swift');
  if (!existsSync(file)) {
    console.log('[patch] OrientationAVPlayerViewController.swift 缺失，跳过 iOS PiP 补丁');
    return;
  }
  let content = readFileSync(file, 'utf8');
  if (content.includes('功能14')) {
    console.log('[patch] iOS PiP 已打补丁，跳过');
    return;
  }
  const before = '  func startPictureInPicture() throws {\n    if isInPictureInPicture {\n      return\n    }\n    if !AVPictureInPictureController.isPictureInPictureSupported() {\n      throw PictureInPictureUnsupportedException()\n    }\n\n    let selectorName = "startPictureInPicture"';
  if (!content.includes(before)) {
    console.log('[patch][iOS PiP] 未匹配到 startPictureInPicture 函数体，需手动补丁（见 NATIVE_PATCHES.md）');
    return;
  }
  content = content.replace(
    before,
    '  func startPictureInPicture() throws {\n    if isInPictureInPicture {\n      return\n    }\n    if !AVPictureInPictureController.isPictureInPictureSupported() {\n      throw PictureInPictureUnsupportedException()\n    }\n\n    // 功能14: AsyncFunction 默认跑在后台队列，PiP 必须在主线程调用，否则被 AVKit 静默忽略\n    DispatchQueue.main.async { [weak self] in\n    let selectorName = "startPictureInPicture"'
  );
  content = content.replace(
    '    if self.responds(to: selectorToStartPictureInPicture) {\n      self.perform(selectorToStartPictureInPicture)\n    }\n  }\n\n  func stopPictureInPicture()',
    '    if self?.responds(to: selectorToStartPictureInPicture) == true {\n      self?.perform(selectorToStartPictureInPicture)\n    }\n    }\n  }\n\n  func stopPictureInPicture()'
  );
  writeFileSync(file, content);
  console.log('[patch] iOS expo-video PiP 已打补丁（主线程调度 startPictureInPicture）');
}

try {
  patchAndroid();
  patchAndroidSegmentProgress();
  patchAndroidPipAspectRatio();
  patchIOS();
  patchIOSPictureInPicture();
  patchIOSTrace();
} catch (e) {
  console.log('[patch] 原生补丁脚本异常（已忽略，不阻断安装）: ' + (e && e.message));
}
