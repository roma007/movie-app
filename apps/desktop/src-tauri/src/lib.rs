use tauri_plugin_http::init as init_http;

/// 数据库 schema 现由 TypeScript 层（tauriSqlProvider.ts）管理，
/// 不再使用 tauri-plugin-sql 的 Rust 迁移机制。
/// schema 定义位于 packages/core/src/db/schema.ts（两端共享）。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(init_http())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
