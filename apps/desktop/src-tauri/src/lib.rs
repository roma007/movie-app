mod video_fetch;
mod pip_window;
mod window_state;

use tauri::{Manager, WindowEvent};
use tauri_plugin_http::init as init_http;

/// 数据库 schema 现由 TypeScript 层（tauriSqlProvider.ts）管理，
/// 不再使用 tauri-plugin-sql 的 Rust 迁移机制。
/// schema 定义位于 packages/core/src/db/schema.ts（两端共享）。

/// 获取指定路径所在文件系统可用字节数（主键 INTEGER 迁移预检用，
/// 避免大规模重建期间磁盘写爆）。跨平台基于 fs2::free_space。
#[tauri::command]
fn disk_free_bytes(path: String) -> Result<u64, String> {
    fs2::free_space(&path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(init_http())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            // 窗口以 visible:false 创建，恢复几何后再显示，避免尺寸跳变
            window_state::apply_on_startup(app.handle());
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                window_state::save_on_close(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            video_fetch::video_fetch,
            video_fetch::prewarm,
            video_fetch::log_line,
            window_state::get_window_state,
            window_state::set_window_remember,
            pip_window::style_pip_window,
            pip_window::animate_pip_appear,
            pip_window::show_pip,
            disk_free_bytes
        ]);

    #[cfg(desktop)]
    let app = app.plugin(tauri_plugin_global_shortcut::Builder::new().build());

    app
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
