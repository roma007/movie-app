use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;

use reqwest::Client;
use serde_json::json;
use tauri::ipc::{InvokeResponseBody, Response};
use tauri::{AppHandle, Manager};

const USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

const LOG_FILE_NAME: &str = "video_fetch.log";
static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

fn init_log_path(app: &AppHandle) {
    LOG_PATH.get_or_init(|| {
        app.path()
            .app_log_dir()
            .unwrap_or_else(|_| std::env::temp_dir())
            .join(LOG_FILE_NAME)
    });
}

fn log_line(msg: &str) {
    let Some(path) = LOG_PATH.get() else { return };
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{}", msg);
    }
}

/// 仅允许 http/https，拒绝 file:/data:/ftp: 等非网络协议。
fn ensure_http_url(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("非法 URL: {}", e))?;
    match parsed.scheme() {
        "http" | "https" => Ok(()),
        scheme => Err(format!("不支持的协议: {}://", scheme)),
    }
}

/// 日志脱敏：只保留 scheme://host[:port]/path，截断 query 与 fragment（签名 token 常位于 query）。
fn redact_url(url: &str) -> String {
    match reqwest::Url::parse(url) {
        Ok(u) => {
            let mut s = format!("{}://{}", u.scheme(), u.host_str().unwrap_or(""));
            if let Some(port) = u.port() {
                s.push_str(&format!(":{}", port));
            }
            s.push_str(u.path());
            s
        }
        Err(_) => url.to_string(),
    }
}

fn is_sensitive_header(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.contains("token")
        || n.contains("secret")
        || n.contains("apikey")
        || n.contains("api_key")
        || matches!(
            n.as_str(),
            "authorization"
                | "proxy-authorization"
                | "cookie"
                | "set-cookie"
                | "x-api-key"
                | "x-access-token"
        )
}

fn redact_headers(headers: &HashMap<String, String>) -> HashMap<String, String> {
    headers
        .iter()
        .map(|(k, v)| {
            let value = if is_sensitive_header(k) { "***".to_string() } else { v.clone() };
            (k.clone(), value)
        })
        .collect()
}

/// 递归输出完整的错误链（reqwest 的错误只打 `to_string()` 只能看到顶层
/// "error sending request for url (...)"，真正的 DNS/connect/TLS 原因在 source() 链上）。
fn log_err(msg: &str, e: &dyn std::error::Error) {
    let mut s = format!("{}: {}", msg, e);
    let mut src = e.source();
    while let Some(cause) = src {
        s.push_str(&format!("\n    caused by: {}", cause));
        src = cause.source();
    }
    log_line(&s);
}

/// 全局常驻连接池客户端。
/// 所有视频相关请求共享同一 reqwest::Client，从而复用 TCP/TLS 连接（keep-alive），
/// 避免每次分片请求都重新握手（plugin-http 的 fetch 每次新建 client，无复用）。
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
    app: AppHandle,
    url: String,
    headers: Option<HashMap<String, String>>,
    range: Option<String>,
) -> Result<Response, String> {
    init_log_path(&app);
    ensure_http_url(&url)?;

    let mut req = http_client().get(&url).timeout(Duration::from_secs(60));

    if let Some(ref headers) = headers {
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
        let redacted = headers.as_ref().map(redact_headers);
        log_err(
            &format!(
                "[video_fetch] 请求失败 {} (headers={:?})",
                redact_url(&url),
                redacted
            ),
            &e,
        );
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
        log_err(&format!("[video_fetch] 响应读取失败 {}", redact_url(&url)), &e);
        e.to_string()
    })?;

    log_line(&format!(
        "[video_fetch] {}: status={} body_len={}",
        redact_url(&url),
        status,
        bytes.len()
    ));

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
pub async fn prewarm(app: AppHandle, url: String) {
    init_log_path(&app);
    let start = std::time::Instant::now();
    if ensure_http_url(&url).is_err() {
        return;
    }
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
            log_line(&format!(
                "[prewarm] {}: ok({}) {}ms",
                redact_url(&url),
                status,
                start.elapsed().as_millis()
            ));
        }
        Err(e) => {
            log_err(&format!(
                "[prewarm] {}: fail {}ms",
                redact_url(&url),
                start.elapsed().as_millis()
            ), &e);
        }
    }
}
