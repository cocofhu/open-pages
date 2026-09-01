mod github_auth;

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri_plugin_opener::OpenerExt;

const CONTROL_ORIGIN: &str = "http://127.0.0.1:3848";

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

fn runtime_script() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../runtime/host.ts")
}

fn start_runtime() -> Result<(), String> {
    let mut slot = RUNTIME.lock().map_err(|e| e.to_string())?;
    if let Some(child) = slot.as_mut() {
        if child.try_wait().ok().flatten().is_none() {
            return Ok(());
        }
    }
    let script = runtime_script();
    if !script.exists() {
        return Err(format!("desktop runtime missing: {}", script.display()));
    }
    let desktop_dir = script
        .parent()
        .and_then(|p| p.parent())
        .ok_or("invalid runtime path")?;
    let child = Command::new("pnpm")
        .args(["exec", "tsx", script.to_string_lossy().as_ref()])
        .current_dir(desktop_dir)
        .env("OPEN_PAGES_CONTROL_PORT", "3848")
        .env("OPEN_PAGES_PREVIEW_PORT", "8788")
        .env("OPEN_PAGES_PREVIEW_ORIGIN", "http://127.0.0.1:8788")
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("failed to start desktop runtime: {e}"))?;
    wait_for_health()?;
    *slot = Some(child);
    Ok(())
}

fn wait_for_health() -> Result<(), String> {
    for _ in 0..50 {
        if std::net::TcpStream::connect_timeout(
            &"127.0.0.1:3848"
                .parse::<std::net::SocketAddr>()
                .map_err(|e| e.to_string())?,
            Duration::from_millis(150),
        )
        .is_ok()
        {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Err("desktop runtime did not become ready".into())
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
    let response = req.send().await.map_err(|e| e.to_string())?;
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
    let session = github_auth::login(|url| {
        app.opener()
            .open_url(url, None::<&str>)
            .map_err(|e| e.to_string())
    })
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
    if let Err(error) = start_runtime() {
        eprintln!("{error}");
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
