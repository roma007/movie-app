mod video_fetch;
mod window_state;

use tauri::{Manager, WindowEvent};
use tauri_plugin_http::init as init_http;

/// 数据库 schema 现由 TypeScript 层（tauriSqlProvider.ts）管理，
/// 不再使用 tauri-plugin-sql 的 Rust 迁移机制。
/// schema 定义位于 packages/core/src/db/schema.ts（两端共享）。

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
            window_state::get_window_state,
            window_state::set_window_remember
        ]);

    #[cfg(desktop)]
    let app = app.plugin(tauri_plugin_global_shortcut::Builder::new().build());

    app
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
