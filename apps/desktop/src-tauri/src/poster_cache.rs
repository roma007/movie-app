use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::video_fetch::http_client;

const CACHE_DIR: &str = "bg-cache";

/// 大分类页背景图缓存目录（app_data_dir()/bg-cache）。
/// 文件名规则由 TS 层决定：bg_{mediaId}.{ext}，与视频 id 强关联，便于查找与去重。
/// 采集开始时由 clear_poster_cache 清空，保证新数据下不展示旧图。
fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?
        .join(CACHE_DIR);
    fs::create_dir_all(&dir).map_err(|e| format!("创建缓存目录失败: {e}"))?;
    Ok(dir)
}

fn safe_filename(filename: &str) -> Result<PathBuf, String> {
    let name = Path::new(filename)
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty() && !s.starts_with('.') && s.contains('.'))
        .ok_or_else(|| format!("非法缓存文件名: {filename}"))?;
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(format!("非法缓存文件名: {filename}"));
    }
    Ok(PathBuf::from(name))
}

/// 查询缓存文件是否存在，存在返回绝对路径（不触发任何网络请求）。
/// 用于区分「本地视频图（命中缓存）」与「网络视频图（需下载）」。
#[tauri::command]
pub async fn poster_cache_path(app: AppHandle, filename: String) -> Option<String> {
    let file_path = app
        .path()
        .app_data_dir()
        .ok()?
        .join(CACHE_DIR)
        .join(safe_filename(&filename).ok()?);
    if file_path.is_file() {
        Some(file_path.to_string_lossy().into_owned())
    } else {
        None
    }
}

/// 下载分类页背景图并落盘到缓存目录；文件已存在则直接返回路径（幂等）。
/// @returns 本地绝对路径
#[tauri::command]
pub async fn download_poster(
    app: AppHandle,
    url: String,
    filename: String,
) -> Result<String, String> {
    let dir = cache_dir(&app)?;
    let file_path = dir.join(safe_filename(&filename)?);

    if file_path.exists() {
        return Ok(file_path.to_string_lossy().into_owned());
    }

    let resp = http_client()
        .get(&url)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("海报下载请求失败: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("海报下载失败，HTTP {}", resp.status()));
    }

    let bytes = resp.bytes().await.map_err(|e| format!("海报下载读取失败: {e}"))?;
    if bytes.is_empty() {
        return Err("海报下载内容为空".into());
    }

    fs::write(&file_path, &bytes).map_err(|e| format!("海报写入失败: {e}"))?;

    Ok(file_path.to_string_lossy().into_owned())
}

/// 清空全部缓存背景图，返回删除的文件数量。
#[tauri::command]
pub async fn clear_poster_cache(app: AppHandle) -> Result<usize, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?
        .join(CACHE_DIR);

    if !dir.exists() {
        return Ok(0);
    }

    let mut removed = 0usize;
    let entries = fs::read_dir(&dir).map_err(|e| format!("读取缓存目录失败: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            match fs::remove_file(&path) {
                Ok(_) => removed += 1,
                Err(e) => eprintln!("[poster_cache] 删除失败 {:?}: {e}", path),
            }
        }
    }
    Ok(removed)
}
