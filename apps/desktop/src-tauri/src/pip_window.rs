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

        // 4) contentView 圆角遮罩：把 WKWebView（含视频合成层）裁成圆角。
        if let Some(content_view) = ns_window.contentView() {
            content_view.setWantsLayer(true);
            if let Some(layer) = content_view.layer() {
                let layer = layer.as_ref() as *const AnyObject as *mut AnyObject;
                let _: () = msg_send![layer, setCornerRadius: 10.0_f64];
                let _: () = msg_send![layer, setMasksToBounds: true];
                println!("[pip_style] mask/corner/osShadow 完成, 含红绿灯隐藏");
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
