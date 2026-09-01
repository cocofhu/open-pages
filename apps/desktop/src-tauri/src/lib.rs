mod github_auth;

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const CONTROL_ORIGIN: &str = "http://127.0.0.1:3848";

static APP: OnceLock<AppHandle> = OnceLock::new();
static RUNTIME: Mutex<Option<Child>> = Mutex::new(None);

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

fn bundled_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("runtime-bundle", BaseDirectory::Resource)
        .map_err(|error| format!("desktop runtime bundle missing: {error}"))
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
    let name = node_sidecar_name();
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(name));
        }
    }
    if let Ok(resource) = app.path().resource_dir() {
        candidates.push(resource.join(name));
        if let Some(parent) = resource.parent() {
            candidates.push(parent.join(name));
            candidates.push(parent.join("MacOS").join(name));
        }
    }
    if let Some(found) = candidates.into_iter().find(|path| path.exists()) {
        return Ok(found);
    }
    if command_exists("node") {
        return Ok(PathBuf::from("node"));
    }
    Err("Node.js runtime not found. Reinstall Open Pages 0.1.1 or later.".into())
}

fn open_in_browser(app: &AppHandle, url: &str) -> Result<(), String> {
    if app.opener().open_url(url, None::<&str>).is_ok() {
        return Ok(());
    }
    let mut command = if cfg!(target_os = "windows") {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "start", "", url]);
        cmd
    } else if cfg!(target_os = "macos") {
        let mut cmd = Command::new("open");
        cmd.arg(url);
        cmd
    } else {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(url);
        cmd
    };
    command
        .spawn()
        .map_err(|error| format!("failed to open browser: {error}"))?;
    Ok(())
}

fn command_exists(name: &str) -> bool {
    let program = if cfg!(windows) { "where" } else { "which" };
    Command::new(program)
        .arg(name)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn tsx_entry(bundle_dir: &Path) -> PathBuf {
    bundle_dir.join("node_modules/tsx/dist/cli.mjs")
}

fn spawn_runtime(mut child: Child) -> Result<(), String> {
    for _ in 0..50 {
        if std::net::TcpStream::connect_timeout(
            &"127.0.0.1:3848"
                .parse::<std::net::SocketAddr>()
                .map_err(|error| error.to_string())?,
            Duration::from_millis(150),
        )
        .is_ok()
        {
            let mut slot = RUNTIME.lock().map_err(|error| error.to_string())?;
            *slot = Some(child);
            return Ok(());
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!("desktop runtime exited before becoming ready ({status})"));
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    let _ = child.kill();
    Err("desktop runtime did not become ready".into())
}

fn start_runtime_dev() -> Result<(), String> {
    let script = dev_runtime_script();
    if !script.exists() {
        return Err(format!("desktop runtime missing: {}", script.display()));
    }
    let desktop_dir = dev_desktop_dir()?;
    let child = Command::new("pnpm")
        .args(["exec", "tsx", script.to_string_lossy().as_ref()])
        .current_dir(&desktop_dir)
        .env("OPEN_PAGES_CONTROL_PORT", "3848")
        .env("OPEN_PAGES_PREVIEW_PORT", "8788")
        .env("OPEN_PAGES_PREVIEW_ORIGIN", "http://127.0.0.1:8788")
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| format!("failed to start desktop runtime: {error}"))?;
    spawn_runtime(child)
}

fn start_runtime_release(app: &AppHandle) -> Result<(), String> {
    let bundle_dir = bundled_runtime_dir(app)?;
    let script = bundle_dir.join("runtime/host.ts");
    if !script.exists() {
        return Err(format!("desktop runtime missing: {}", script.display()));
    }
    let node = resolve_node_binary(app)?;
    let tsx = tsx_entry(&bundle_dir);
    if !tsx.exists() {
        return Err(format!("desktop runtime missing tsx: {}", tsx.display()));
    }
    let child = Command::new(node)
        .arg(&tsx)
        .arg(&script)
        .current_dir(&bundle_dir)
        .env("OPEN_PAGES_CONTROL_PORT", "3848")
        .env("OPEN_PAGES_PREVIEW_PORT", "8788")
        .env("OPEN_PAGES_PREVIEW_ORIGIN", "http://127.0.0.1:8788")
        .env("NODE_ENV", "production")
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| format!("failed to start desktop runtime: {error}"))?;
    spawn_runtime(child)
}

fn start_runtime() -> Result<(), String> {
    let mut slot = RUNTIME.lock().map_err(|error| error.to_string())?;
    if let Some(child) = slot.as_mut() {
        if child.try_wait().ok().flatten().is_none() {
            return Ok(());
        }
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
            let _ = child.kill();
        }
    }
}

async fn control_request(
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    start_runtime()?;
    let token = github_auth::stored_token();
    let client = reqwest::Client::new();
    let mut req = client.request(method, format!("{CONTROL_ORIGIN}{path}"));
    if let Some(token) = token {
        req = req.bearer_auth(token);
    }
    if let Some(body) = body {
        req = req.json(&body);
    }
    let response = req.send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    let value = response.json::<Value>().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let error = value
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or(status.as_str());
        return Err(error.to_string());
    }
    Ok(value)
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
    let session = github_auth::login(|url| open_in_browser(&app, url)).await?;
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
    if github_auth::stored_token().is_none() {
        return Err("Not signed in".into());
    }
    let session = github_auth::stored_session();
    let login = session.login.ok_or_else(|| "Not signed in".to_string())?;
    let mut body = payload;
    if let Some(obj) = body.as_object_mut() {
        obj.insert("owner".into(), Value::String(login));
    }
    control_request(reqwest::Method::POST, "/publish", Some(body)).await
}

#[tauri::command]
async fn list_repos() -> Result<Value, String> {
    control_request(reqwest::Method::GET, "/repos", None).await
}

#[tauri::command]
async fn create_repo(name: String) -> Result<Value, String> {
    control_request(
        reqwest::Method::POST,
        "/repos",
        Some(serde_json::json!({ "name": name })),
    )
    .await
}

#[tauri::command]
async fn check_repo_publish(owner: String, repo: String, site_id: String) -> Result<Value, String> {
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
