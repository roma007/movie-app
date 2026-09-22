//! macOS 下 pip 窗口的「圆角 + 贴合阴影 + 无白边」原生处理。
//!
//! 机制（借鉴社区验证方案 cloudworxx/tauri-plugin-mac-rounded-corners）：
//!   让窗口被系统视作「透明标题栏的圆角窗口」：
//!   - styleMask 加 NSTitledWindowMask + NSFullSizeContentViewWindowMask（内容
//!     延伸到整个窗口，配合透明标题栏、隐藏标题）。
//!   - setTitlebarAppearsTransparent + setTitleVisibility(Hidden)：标题栏透明隐藏。
//!   - setHasShadow(true)：系统就能针对这种圆角标题栏窗口投射贴合圆角的阴影
//!     （而不是无边框窗口的矩形白边）。
//!   - 隐藏红绿灯（标准窗口按钮）：PIP 不需要系统标题栏按钮。
//!   - setOpaque(false) + clear 背景 + contentView layer 圆角 mask：圆角 + 透背景。
//! 结果：无白边 + 圆角 + 贴合阴影三者同时成立。

/// 对指定窗口应用圆角 + 贴合阴影（仅 macOS）。
#[cfg(target_os = "macos")]
pub fn apply_pip_style(window: &tauri::WebviewWindow) -> Result<(), String> {
    use objc2::msg_send;
    use objc2::runtime::{AnyObject, Bool, NSObject};
    use objc2_app_kit::{NSColor, NSWindow, NSWindowStyleMask, NSWindowTitleVisibility};

    let ptr = window.ns_window().map_err(|e| {
        eprintln!("[pip_style] ns_window 获取失败: {e}");
        e.to_string()
    })?;
    let ns_window: &NSWindow = unsafe { &*(ptr as *const NSWindow) };

    unsafe {
        // 1) 标题栏形态：让系统把它当透明标题栏窗口（阴影贴合圆角的关键）。
        let style = ns_window.styleMask();
        let mask = NSWindowStyleMask::Titled
            | NSWindowStyleMask::Closable
            | NSWindowStyleMask::Miniaturizable
            | NSWindowStyleMask::Resizable
            | NSWindowStyleMask::FullSizeContentView;
        ns_window.setStyleMask(style | mask);
        ns_window.setTitlebarAppearsTransparent(true);
        ns_window.setTitleVisibility(NSWindowTitleVisibility::Hidden);

        // 2) 透明 + 系统投影（贴合圆角，非矩形白边）。
        ns_window.setOpaque(false);
        let clear = NSColor::clearColor();
        ns_window.setBackgroundColor(Some(&clear));
        ns_window.setHasShadow(true);

        // 3) 隐藏系统红绿灯（PIP 无标题栏按钮）。
        for tag in [0i64, 1, 2] {
            let b: *mut NSObject = msg_send![ns_window, standardWindowButton: tag];
            if !b.is_null() {
                let _: () = msg_send![b, setHidden: Bool::YES];
            }
        }

        // 4) contentView 圆角遮罩：把 WKWebView（含视频合成层）裁成大圆角。
        if let Some(content_view) = ns_window.contentView() {
            content_view.setWantsLayer(true);
            if let Some(layer) = content_view.layer() {
                let layer = layer.as_ref() as *const AnyObject as *mut AnyObject;
                let _: () = msg_send![layer, setCornerRadius: 16.0_f64];
                let _: () = msg_send![layer, setMasksToBounds: true];
                println!("[pip_style] mask/corner/osShadow 完成, radius=16pt, 含红绿灯隐藏");
            } else {
                eprintln!("[pip_style] contentView.layer() 返回 None");
            }
        } else {
            eprintln!("[pip_style] contentView() 返回 None");
        }
    }

    Ok(())
}

/// windows/其它平台：无操作。
#[cfg(not(target_os = "macos"))]
pub fn apply_pip_style(_window: &tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}

/// 供 JS 调用的命令：给当前 pip 窗口套用圆角 + 贴合阴影。
#[tauri::command]
pub fn style_pip_window(window: tauri::WebviewWindow) -> Result<(), String> {
    apply_pip_style(&window)
}

/// pip 弹出动画：把窗口从 `from` 矩形平滑移动+缩放到 `to` 矩形（macOS，原生 NSAnimationContext）。
///
/// 坐标均为「逻辑点、屏幕左上原点」的全局坐标（与 Tauri/JS 一致）；
/// `screen_h` = 主屏幕逻辑高度（JS 侧从 availableMonitors 取，避免 Rust 侧主线程限制），
/// 内部换算为 macOS NSWindow 的「屏幕左下原点」坐标。
/// 时长含源码地控制在 ~350ms，ease-out 曲线 → 原生 PiP 感。
#[cfg(target_os = "macos")]
fn animate_pip_from_to(
    window: &tauri::WebviewWindow,
    from: [f64; 4],
    to: [f64; 4],
    screen_h: f64,
    duration_s: f64,
) -> Result<(), String> {
    use objc2_app_kit::{NSAnimatablePropertyContainer, NSAnimationContext, NSWindow};
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    use objc2_quartz_core::{CAMediaTimingFunction, kCAMediaTimingFunctionEaseOut};

    let ptr = window.ns_window().map_err(|e| {
        eprintln!("[pip_anim] ns_window 获取失败: {e}");
        e.to_string()
    })?;
    let ns_window: &NSWindow = unsafe { &*(ptr as *const NSWindow) };

    // macOS 全局坐标原点在屏幕左下；Tauri 在左上。y 换算：y_ns = screenH - (y_top + h)。
    let sh = if screen_h > 100.0 { screen_h } else { 900.0 };

    let (fx, fy, fw, fh) = (from[0], sh - from[1] - from[3], from[2], from[3]);
    let (tx, ty, tw, th) = (to[0], sh - to[1] - to[3], to[2], to[3]);
    let frect = NSRect::new(NSPoint::new(fx, fy), NSSize::new(fw, fh));
    let trect = NSRect::new(NSPoint::new(tx, ty), NSSize::new(tw, th));

    // 先归位到 from（确保动画起点准确，避免残留上次位置）
    ns_window.setFrame_display(frect, false);

    // begin/end grouping + animator 代理上的 setFrame → 按上下文时长/曲线做帧动画
    NSAnimationContext::beginGrouping();
    let ctx = NSAnimationContext::currentContext();
    ctx.setDuration(duration_s);
    let timing = unsafe {
        CAMediaTimingFunction::functionWithName(&kCAMediaTimingFunctionEaseOut)
    };
    ctx.setTimingFunction(Some(&timing));
    let animator = ns_window.animator();
    animator.setFrame_display(trect, true);
    NSAnimationContext::endGrouping();

    println!(
        "[pip_anim] from=({:.0},{:.0} {:.0}x{:.0}) → to=({:.0},{:.0} {:.0}x{:.0}) {:.0}ms ease-out screenH={:.0}",
        from[0], from[1], from[2], from[3], to[0], to[1], to[2], to[3], duration_s * 1000.0, sh
    );
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn animate_pip_from_to(
    _window: &tauri::WebviewWindow,
    _from: [f64; 4],
    _to: [f64; 4],
    _screen_h: f64,
    _duration_s: f64,
) -> Result<(), String> {
    Ok(())
}

/// 供 JS 调用的命令：pip 弹出动画（仅 macOS 生效，Windows 走 JS 端 rAF 插值）。
#[tauri::command]
pub fn animate_pip_appear(
    window: tauri::WebviewWindow,
    from: Vec<f64>,
    to: Vec<f64>,
    screen_h: f64,
    duration_ms: u32,
) -> Result<(), String> {
    if from.len() != 4 || to.len() != 4 {
        return Err("from/to 必须是 4 元素数组 [x,y,w,h]".to_string());
    }
    let f = [from[0], from[1], from[2], from[3]];
    let t = [to[0], to[1], to[2], to[3]];
    animate_pip_from_to(&window, f, t, screen_h, duration_ms as f64 / 1000.0)
}

/// 供 JS 调用的命令：强制把 pip 窗口显示到最前（JS 侧 `win.show()` 静默失效时的兜底）。
///
/// 场景：常驻隐藏窗口 precreate 后，个别 macOS 版本对「visible:false 创建的窗口」调用
/// JS `show()` 可能不生效；此处直接走原生 `NSWindow` 同一系统调用，并补聚焦 + 置顶，
/// 尽力确保窗口真的弹出来。
#[tauri::command]
pub fn show_pip(window: tauri::WebviewWindow) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    println!("[pip_anim] show_pip 原生命令执行成功");
    Ok(())
}
