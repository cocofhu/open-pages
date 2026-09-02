mod github_auth;

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

static APP: OnceLock<AppHandle> = OnceLock::new();
static RUNTIME: Mutex<Option<Child>> = Mutex::new(None);
static CONTROL_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
static CONTROL_PORT: Mutex<u16> = Mutex::new(3848);

/// Windows gives every child process its own console, which flashes a black
/// window over the app each time we probe for Node or open a browser.
fn hidden_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// A system-wide proxy (VPN clients set one) otherwise swallows requests to the
/// local runtime and surfaces as "error sending request".
fn control_client() -> Result<&'static reqwest::Client, String> {
    if let Some(client) = CONTROL_CLIENT.get() {
        return Ok(client);
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|error| error.to_string())?;
    let _ = CONTROL_CLIENT.set(client);
    CONTROL_CLIENT
        .get()
        .ok_or_else(|| "failed to create control client".to_string())
}

fn control_port() -> u16 {
    CONTROL_PORT.lock().map(|port| *port).unwrap_or(3848)
}

fn set_control_port(port: u16) {
    if let Ok(mut slot) = CONTROL_PORT.lock() {
        *slot = port;
    }
}

fn control_origin() -> String {
    format!("http://127.0.0.1:{}", control_port())
}

fn reserve_port(preferred: u16) -> u16 {
    let bind = |port: u16| TcpListener::bind(("127.0.0.1", port));
    let listener = bind(preferred).or_else(|_| bind(0));
    match listener.and_then(|bound| bound.local_addr().map(|addr| (bound, addr.port()))) {
        Ok((bound, port)) => {
            drop(bound);
            port
        }
        Err(_) => preferred,
    }
}

fn runtime_healthy(port: u16) -> bool {
    let Ok(addr) = format!("127.0.0.1:{port}").parse() else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(250)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(400)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(400)));
    if stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut buf = [0u8; 512];
    let Ok(n) = stream.read(&mut buf) else {
        return false;
    };
    let text = String::from_utf8_lossy(&buf[..n]);
    text.contains("\"ok\"") && text.contains("200")
}

fn kill_child(child: &mut Child) {
    #[cfg(windows)]
    {
        let pid = child.id().to_string();
        let _ = hidden_command("taskkill")
            .args(["/PID", &pid, "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthUser {
    guest_id: String,
    login: Option<String>,
    name: Option<String>,
    avatar_url: Option<String>,
    github_enabled: bool,
}

fn app_handle() -> Result<&'static AppHandle, String> {
    APP.get().ok_or_else(|| "desktop app is not ready".into())
}

fn dev_runtime_script() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../runtime/host.ts")
}

fn dev_desktop_dir() -> Result<PathBuf, String> {
    dev_runtime_script()
        .parent()
        .and_then(|p| p.parent())
        .map(Path::to_path_buf)
        .ok_or_else(|| "invalid runtime path".into())
}

fn search_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            dirs.push(dir.to_path_buf());
        }
    }
    if let Ok(resource) = app.path().resource_dir() {
        dirs.push(resource.clone());
        if let Some(parent) = resource.parent() {
            dirs.push(parent.to_path_buf());
            dirs.push(parent.join("MacOS"));
        }
    }
    if let Ok(resolved) = app.path().resolve("runtime-bundle", BaseDirectory::Resource) {
        if let Some(parent) = resolved.parent() {
            dirs.push(parent.to_path_buf());
        }
    }
    dirs
}

fn bundled_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    for dir in search_dirs(app) {
        let candidate = dir.join("runtime-bundle");
        if candidate.join("runtime/host.js").exists() || candidate.join("runtime/host.ts").exists()
        {
            return Ok(candidate);
        }
    }
    Err("desktop runtime bundle missing next to the app (runtime-bundle/runtime/host.js)".into())
}

fn node_sidecar_name() -> &'static str {
    if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "node-x86_64-pc-windows-msvc.exe"
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "node-aarch64-apple-darwin"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "node-x86_64-apple-darwin"
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "node-x86_64-unknown-linux-gnu"
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        "node-aarch64-unknown-linux-gnu"
    } else {
        "node"
    }
}

fn resolve_node_binary(app: &AppHandle) -> Result<PathBuf, String> {
    let names = [node_sidecar_name(), "node.exe", "node"];
    for dir in search_dirs(app) {
        for name in names {
            let candidate = dir.join(name);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }
    if command_exists("node") {
        return Ok(PathBuf::from("node"));
    }
    Err("Node.js runtime not found next to the app. Reinstall Open Pages 0.1.1 or later.".into())
}

fn open_in_browser(app: &AppHandle, url: &str) -> Result<(), String> {
    if app.opener().open_url(url, None::<&str>).is_ok() {
        return Ok(());
    }
    let mut command = if cfg!(target_os = "windows") {
        let mut cmd = hidden_command("rundll32.exe");
        cmd.args(["url.dll,FileProtocolHandler", url]);
        cmd
    } else if cfg!(target_os = "macos") {
        let mut cmd = hidden_command("open");
        cmd.arg(url);
        cmd
    } else {
        let mut cmd = hidden_command("xdg-open");
        cmd.arg(url);
        cmd
    };
    command
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("failed to open browser: {error}"))?;
    Ok(())
}

fn command_exists(name: &str) -> bool {
    let program = if cfg!(windows) { "where" } else { "which" };
    hidden_command(program)
        .arg(name)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn runtime_entry(bundle_dir: &Path) -> PathBuf {
    let js = bundle_dir.join("runtime/host.js");
    if js.exists() {
        js
    } else {
        bundle_dir.join("runtime/host.ts")
    }
}

/// The runtime's own stderr is the only clue when it dies on startup, so the
/// release build tees it to a log file and replays the tail into the error the
/// UI shows.
fn runtime_log_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_log_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("runtime.log"))
}

fn runtime_log_tail(path: &Path) -> Option<String> {
    const MAX_LINES: usize = 16;
    let text = std::fs::read_to_string(path).ok()?;
    let trimmed = text.trim_end();
    if trimmed.is_empty() {
        return None;
    }
    let lines: Vec<&str> = trimmed.lines().collect();
    let cause = lines.iter().rev().find(|line| {
        line.contains("Cannot find package")
            || line.contains("Cannot find module")
            || line.contains("ERR_MODULE_NOT_FOUND")
            || line.contains("ERR_UNSUPPORTED")
    });
    let tail = lines[lines.len().saturating_sub(MAX_LINES)..].join("\n");
    let prefix = cause
        .filter(|line| !tail.contains(*line))
        .map(|line| format!("{line}\n"))
        .unwrap_or_default();
    Some(format!("{prefix}{tail}\n(full log: {})", path.display()))
}

fn spawn_runtime(mut child: Child, log_path: Option<PathBuf>, port: u16) -> Result<(), String> {
    for _ in 0..150 {
        if runtime_healthy(port) {
            let mut slot = RUNTIME.lock().map_err(|error| error.to_string())?;
            *slot = Some(child);
            set_control_port(port);
            return Ok(());
        }
        if let Ok(Some(status)) = child.try_wait() {
            let detail = log_path.as_deref().and_then(runtime_log_tail);
            return Err(match detail {
                Some(detail) => {
                    format!("desktop runtime exited before becoming ready ({status})\n{detail}")
                }
                None => format!("desktop runtime exited before becoming ready ({status})"),
            });
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    kill_child(&mut child);
    let detail = log_path.as_deref().and_then(runtime_log_tail);
    Err(match detail {
        Some(detail) => format!("desktop runtime did not become ready on 127.0.0.1:{port}\n{detail}"),
        None => format!("desktop runtime did not become ready on 127.0.0.1:{port}"),
    })
}

fn start_runtime_dev() -> Result<(), String> {
    let script = dev_runtime_script();
    if !script.exists() {
        return Err(format!("desktop runtime missing: {}", script.display()));
    }
    let desktop_dir = dev_desktop_dir()?;
    let child = hidden_command("pnpm")
        .args(["exec", "tsx", script.to_string_lossy().as_ref()])
        .current_dir(&desktop_dir)
        .env("OPEN_PAGES_CONTROL_PORT", "3848")
        .env("OPEN_PAGES_PREVIEW_PORT", "8788")
        .env("OPEN_PAGES_PREVIEW_ORIGIN", "http://127.0.0.1:8788")
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| format!("failed to start desktop runtime: {error}"))?;
    spawn_runtime(child, None, 3848)
}

fn start_runtime_release(app: &AppHandle) -> Result<(), String> {
    let bundle_dir = bundled_runtime_dir(app)?;
    let script = runtime_entry(&bundle_dir);
    if !script.exists() {
        return Err(format!("desktop runtime missing: {}", script.display()));
    }
    let node = resolve_node_binary(app)?;
    let log_path = runtime_log_path(app);
    let (stdout, stderr) = match log_path
        .as_deref()
        .and_then(|path| std::fs::File::create(path).ok())
    {
        Some(file) => match file.try_clone() {
            Ok(clone) => (Stdio::from(file), Stdio::from(clone)),
            Err(_) => (Stdio::null(), Stdio::from(file)),
        },
        None => (Stdio::null(), Stdio::null()),
    };
    let control = reserve_port(3848);
    let mut preview = reserve_port(8788);
    if preview == control {
        preview = reserve_port(0);
    }
    let child = hidden_command(node)
        .arg(&script)
        .current_dir(&bundle_dir)
        .env("OPEN_PAGES_CONTROL_PORT", control.to_string())
        .env("OPEN_PAGES_PREVIEW_PORT", preview.to_string())
        .env(
            "OPEN_PAGES_PREVIEW_ORIGIN",
            format!("http://127.0.0.1:{preview}"),
        )
        .env("NODE_ENV", "production")
        .stdout(stdout)
        .stderr(stderr)
        .spawn()
        .map_err(|error| format!("failed to start desktop runtime: {error}"))?;
    spawn_runtime(child, log_path, control)
}

fn start_runtime() -> Result<(), String> {
    let mut slot = RUNTIME.lock().map_err(|error| error.to_string())?;
    if let Some(child) = slot.as_mut() {
        let still_running = child.try_wait().ok().flatten().is_none();
        if still_running && runtime_healthy(control_port()) {
            return Ok(());
        }
        if still_running {
            kill_child(child);
        }
        *slot = None;
    }
    drop(slot);

    if cfg!(debug_assertions) {
        start_runtime_dev()
    } else {
        start_runtime_release(app_handle()?)
    }
}

fn stop_runtime() {
    if let Ok(mut slot) = RUNTIME.lock() {
        if let Some(mut child) = slot.take() {
            kill_child(&mut child);
        }
    }
}

fn runtime_failure_detail(error: impl std::fmt::Display) -> String {
    let log = app_handle()
        .ok()
        .and_then(runtime_log_path)
        .as_deref()
        .and_then(runtime_log_tail);
    match log {
        Some(log) => format!("{error}\n{log}"),
        None => error.to_string(),
    }
}

struct ControlError {
    message: String,
    /// Only a runtime we could not reach is worth restarting for. Once it has
    /// replied, a restart produces the same answer and the caller ends up
    /// reading it twice, as in "Not signed in retried: Not signed in".
    retryable: bool,
}

impl ControlError {
    fn answered(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            retryable: false,
        }
    }

    fn unreachable(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            retryable: true,
        }
    }
}

async fn send_control(
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, ControlError> {
    let token = github_auth::stored_token();
    let client = control_client().map_err(|error| ControlError::answered(error))?;
    let mut req = client.request(method, format!("{}{path}", control_origin()));
    if let Some(token) = token {
        req = req.bearer_auth(token);
    }
    if let Some(body) = body {
        req = req.json(&body);
    }
    let response = req.send().await.map_err(|error| {
        ControlError::unreachable(runtime_failure_detail(format!(
            "无法连接本地生成服务 {}（{error}）",
            control_origin()
        )))
    })?;
    let status = response.status();
    let value = response.json::<Value>().await.unwrap_or(Value::Null);
    if !status.is_success() {
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(ControlError::answered(github_auth::CREDENTIALS_REJECTED));
        }
        let error = value
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or(status.as_str());
        return Err(ControlError::answered(error));
    }
    Ok(value)
}

async fn control_request(
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    start_runtime().map_err(runtime_failure_detail)?;
    match send_control(method.clone(), path, body.clone()).await {
        Ok(value) => Ok(value),
        Err(first) if !first.retryable => Err(first.message),
        Err(first) => {
            stop_runtime();
            start_runtime().map_err(runtime_failure_detail)?;
            send_control(method, path, body)
                .await
                .map_err(|retry| format!("{}\nretried: {}", first.message, retry.message))
        }
    }
}

fn current_user() -> AuthUser {
    let session = github_auth::stored_session();
    AuthUser {
        guest_id: "desktop".into(),
        login: session.login,
        name: session.name,
        avatar_url: session.avatar_url,
        github_enabled: session.github_enabled,
    }
}

#[tauri::command]
async fn github_login(app: tauri::AppHandle) -> Result<AuthUser, String> {
    if github_auth::client_id().is_empty() {
        return Err(
            "GitHub Client ID is missing in this build. Reinstall a release built with OPEN_PAGES_GITHUB_CLIENT_ID, or set GITHUB_CLIENT_ID before launching.".into(),
        );
    }
    let emitter = app.clone();
    let session = github_auth::login(
        |url| open_in_browser(&app, url),
        move |user_code, verification_uri| {
            let _ = emitter.emit(
                "github-device-code",
                serde_json::json!({ "userCode": user_code, "verificationUri": verification_uri }),
            );
        },
    )
    .await?;
    Ok(AuthUser {
        guest_id: "desktop".into(),
        login: session.login,
        name: session.name,
        avatar_url: session.avatar_url,
        github_enabled: session.github_enabled,
    })
}

#[tauri::command]
fn github_logout() -> Result<AuthUser, String> {
    github_auth::logout()?;
    Ok(current_user())
}

#[tauri::command]
fn github_get_session() -> AuthUser {
    current_user()
}

#[tauri::command]
async fn preview_site(payload: Value) -> Result<Value, String> {
    control_request(reqwest::Method::POST, "/preview", Some(payload)).await
}

#[tauri::command]
async fn publish_site(payload: Value) -> Result<Value, String> {
    github_auth::require_token()?;
    let session = github_auth::stored_session();
    let login = session
        .login
        .ok_or_else(|| github_auth::SIGNED_OUT.to_string())?;
    let mut body = payload;
    if let Some(obj) = body.as_object_mut() {
        obj.insert("owner".into(), Value::String(login));
    }
    control_request(reqwest::Method::POST, "/publish", Some(body)).await
}

#[tauri::command]
async fn list_repos() -> Result<Value, String> {
    github_auth::require_token()?;
    control_request(reqwest::Method::GET, "/repos", None).await
}

#[tauri::command]
async fn create_repo(name: String) -> Result<Value, String> {
    github_auth::require_token()?;
    control_request(
        reqwest::Method::POST,
        "/repos",
        Some(serde_json::json!({ "name": name })),
    )
    .await
}

#[tauri::command]
async fn check_repo_publish(owner: String, repo: String, site_id: String) -> Result<Value, String> {
    github_auth::require_token()?;
    control_request(
        reqwest::Method::GET,
        &format!("/repos/{owner}/{repo}/publish-check?siteId={site_id}"),
        None,
    )
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let _ = APP.set(app.handle().clone());
            if let Err(error) = start_runtime() {
                eprintln!("{error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            github_login,
            github_logout,
            github_get_session,
            preview_site,
            publish_site,
            list_repos,
            create_repo,
            check_repo_publish
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                stop_runtime();
            }
        });
}
