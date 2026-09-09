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
    '    if self.responds(to: selectorToStartPictureInPicture) {\n      self.perform(selectorToStartPictureInPicture)\n    }\n    }\n  }\n\n  func stopPictureInPicture()'
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
} catch (e) {
  console.log('[patch] 原生补丁脚本异常（已忽略，不阻断安装）: ' + (e && e.message));
}
