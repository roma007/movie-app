use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

const STATE_FILE: &str = "window-state.json";
const DEFAULT_WIDTH: u32 = 1200;
const DEFAULT_HEIGHT: u32 = 800;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct WindowState {
    pub remember: bool,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            remember: true,
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            x: 0,
            y: 0,
        }
    }
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(STATE_FILE))
}

fn load_state(app: &AppHandle) -> Option<WindowState> {
    let path = state_path(app).ok()?;
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

fn save_state(app: &AppHandle, state: &WindowState) -> Result<(), String> {
    let path = state_path(app)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}

fn window_geometry(window: &WebviewWindow) -> (u32, u32, i32, i32) {
    let size = window
        .outer_size()
        .unwrap_or(PhysicalSize::new(DEFAULT_WIDTH, DEFAULT_HEIGHT));
    let pos = window
        .outer_position()
        .unwrap_or(PhysicalPosition::new(0, 0));
    (size.width, size.height, pos.x, pos.y)
}

fn is_visible_on_screen(app: &AppHandle, x: i32, y: i32, width: u32, height: u32) -> bool {
    let (r_left, r_top) = (x as i64, y as i64);
    let (r_right, r_bottom) = (x as i64 + width as i64, y as i64 + height as i64);
    match app.available_monitors() {
        Ok(monitors) => monitors.iter().any(|m| {
            let pos = m.position();
            let size = m.size();
            let (m_left, m_top) = (pos.x as i64, pos.y as i64);
            let (m_right, m_bottom) = (pos.x as i64 + size.width as i64, pos.y as i64 + size.height as i64);
            r_left < m_right && r_right > m_left && r_top < m_bottom && r_bottom > m_top
        }),
        Err(_) => true,
    }
}

/// 启动时恢复窗口大小和位置（在窗口显示前调用）。
pub fn apply_on_startup(app: &AppHandle) {
    let Some(state) = load_state(app) else { return };
    if !state.remember {
        return;
    }
    let Some(window) = app.get_webview_window("main") else { return };
    let _ = window.set_size(PhysicalSize::new(state.width, state.height));
    if is_visible_on_screen(app, state.x, state.y, state.width, state.height) {
        let _ = window.set_position(PhysicalPosition::new(state.x, state.y));
    }
}

/// 窗口关闭时保存当前几何（保留 remember 标志）。
pub fn save_on_close(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    let mut state = load_state(app).unwrap_or_default();
    let (width, height, x, y) = window_geometry(&window);
    state.width = width;
    state.height = height;
    state.x = x;
    state.y = y;
    let _ = save_state(app, &state);
}

#[tauri::command]
pub fn get_window_state(app: AppHandle) -> WindowState {
    load_state(&app).unwrap_or_default()
}

#[tauri::command]
pub fn set_window_remember(
    app: AppHandle,
    window: WebviewWindow,
    remember: bool,
) -> Result<(), String> {
    let mut state = load_state(&app).unwrap_or_default();
    state.remember = remember;
    if remember {
        let (width, height, x, y) = window_geometry(&window);
        state.width = width;
        state.height = height;
        state.x = x;
        state.y = y;
    }
    save_state(&app, &state)
}
