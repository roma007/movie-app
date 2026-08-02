use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::OnceLock;
use std::time::Duration;

use reqwest::Client;
use serde_json::json;
use tauri::ipc::{InvokeResponseBody, Response};

const USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

const LOG_FILE: &str = "/tmp/video_fetch.log";

fn log_line(msg: &str) {
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(LOG_FILE) {
        let _ = writeln!(f, "{}", msg);
    }
}

/// 全局常驻连接池客户端。
/// 所有视频相关请求共享同一 reqwest::Client，从而复用 TCP/TLS 连接（keep-alive），
/// 避免每次分片请求都重新握手（plugin-http 的 fetch 每次新建 client，无复用）。
/// `pub(crate)` 供 poster_cache 复用下载海报。
pub(crate) static HTTP_CLIENT: OnceLock<Client> = OnceLock::new();

pub(crate) fn http_client() -> &'static Client {
    HTTP_CLIENT.get_or_init(|| {
        Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(Duration::from_secs(15))
            .pool_idle_timeout(Duration::from_secs(60))
            .pool_max_idle_per_host(8)
            .gzip(true)
            .build()
            .expect("failed to build video fetch client")
    })
}

/// 通过常驻连接池发起视频资源请求。
/// - `headers`: 附加请求头（如 Referer 反盗链头）。
/// - `range`: 字节区间（`bytes=a-b`），用于 mp4 / BYTERANGE 分片。
///
/// 返回原始字节帧（经 IPC 以二进制传输，避免大 base64 字符串在 JSON 序列化中丢字段）：
///   [status: u16 LE][headers_json_len: u32 LE][headers_json][body 原始字节]
#[tauri::command]
pub async fn video_fetch(
    url: String,
    headers: Option<HashMap<String, String>>,
    range: Option<String>,
) -> Result<Response, String> {
    let mut req = http_client().get(&url).timeout(Duration::from_secs(60));

    if let Some(headers) = headers {
        for (name, value) in headers {
            let Ok(name) = reqwest::header::HeaderName::from_bytes(name.as_bytes()) else {
                continue;
            };
            let Ok(value) = reqwest::header::HeaderValue::from_str(&value) else {
                continue;
            };
            req = req.header(name, value);
        }
    }
    if let Some(range) = range {
        req = req.header(reqwest::header::RANGE, range);
    }

    let resp = req.send().await.map_err(|e| {
        log_line(&format!("[video_fetch] 请求失败 {}: {}", url, e));
        e.to_string()
    })?;

    let status = resp.status().as_u16();

    let mut resp_headers = HashMap::new();
    for (name, value) in resp.headers() {
        if let Ok(v) = value.to_str() {
            resp_headers.insert(name.to_string(), v.to_string());
        }
    }

    let bytes = resp.bytes().await.map_err(|e| {
        log_line(&format!("[video_fetch] 响应读取失败 {}: {}", url, e));
        e.to_string()
    })?;

    log_line(&format!("[video_fetch] {}: status={} body_len={}", url, status, bytes.len()));

    let headers_json = json!(resp_headers).to_string().into_bytes();
    let mut frame = Vec::with_capacity(2 + 4 + headers_json.len() + bytes.len());
    frame.extend_from_slice(&status.to_le_bytes());
    frame.extend_from_slice(&(headers_json.len() as u32).to_le_bytes());
    frame.extend_from_slice(&headers_json);
    frame.extend_from_slice(&bytes);

    Ok(Response::new(InvokeResponseBody::Raw(frame)))
}

/// 预热源域名连接：向该 URL 发起一个 Range 小请求，使连接池提前建立到其 host
/// 的 keep-alive 连接，后续该 host 的清单/分片请求免握手。失败静默不影响播放。
#[tauri::command]
pub async fn prewarm(url: String) {
    let start = std::time::Instant::now();
    let mut req = http_client()
        .get(&url)
        .header(reqwest::header::RANGE, "bytes=0-0")
        .timeout(Duration::from_secs(10));
    if let Ok(parsed) = reqwest::Url::parse(&url) {
        let origin = parsed.origin().ascii_serialization();
        if !origin.is_empty() {
            req = req.header(reqwest::header::REFERER, origin);
        }
    }
    match req.send().await {
        Ok(resp) => {
            let status = resp.status();
            let _ = resp.bytes().await;
            log_line(&format!("[prewarm] {}: ok({}) {}ms", url, status, start.elapsed().as_millis()));
        }
        Err(e) => {
            log_line(&format!(
                "[prewarm] {}: fail {} {}ms",
                url,
                e,
                start.elapsed().as_millis()
            ));
        }
    }
}
