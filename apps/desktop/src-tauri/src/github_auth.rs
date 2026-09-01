use std::fs;
use std::io::Write;
use std::net::TcpListener;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};

pub const LOOPBACK_REDIRECT: &str = "http://127.0.0.1:3847/auth/callback";
const SERVICE: &str = "open-pages";
const TOKEN_ACCOUNT: &str = "github-token";
const SESSION_ACCOUNT: &str = "github-session";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubSession {
    pub login: Option<String>,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub github_enabled: bool,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Deserialize)]
struct GitHubUser {
    login: String,
    name: Option<String>,
    avatar_url: String,
}

fn secrets_path() -> PathBuf {
    dirs_home().join(".open-pages").join("secrets.json")
}

fn dirs_home() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn file_store_get(account: &str) -> Option<String> {
    let raw = fs::read_to_string(secrets_path()).ok()?;
    let map: serde_json::Value = serde_json::from_str(&raw).ok()?;
    map.get(account)?.as_str().map(str::to_string)
}

fn file_store_set(account: &str, value: &str) -> Result<(), String> {
    let path = secrets_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut map = fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&raw).ok())
        .unwrap_or_default();
    map.insert(account.to_string(), serde_json::Value::String(value.to_string()));
    fs::write(&path, serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn file_store_delete(account: &str) -> Result<(), String> {
    let path = secrets_path();
    let Ok(raw) = fs::read_to_string(&path) else {
        return Ok(());
    };
    let mut map: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&raw).unwrap_or_default();
    map.remove(account);
    fs::write(&path, serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(())
}

fn store_secret(account: &str, value: &str) -> Result<(), String> {
    if let Ok(entry) = keyring::Entry::new(SERVICE, account) {
        if entry.set_password(value).is_ok() {
            let _ = file_store_delete(account);
            return Ok(());
        }
    }
    file_store_set(account, value)
}

fn read_secret(account: &str) -> Option<String> {
    if let Ok(entry) = keyring::Entry::new(SERVICE, account) {
        if let Ok(value) = entry.get_password() {
            return Some(value);
        }
    }
    file_store_get(account)
}

fn delete_secret(account: &str) -> Result<(), String> {
    if let Ok(entry) = keyring::Entry::new(SERVICE, account) {
        let _ = entry.delete_credential();
    }
    file_store_delete(account)
}

pub fn client_id() -> String {
    if let Ok(id) = std::env::var("GITHUB_CLIENT_ID") {
        if !id.is_empty() {
            return id;
        }
    }
    if let Ok(id) = std::env::var("OPEN_PAGES_GITHUB_CLIENT_ID") {
        if !id.is_empty() {
            return id;
        }
    }
    option_env!("OPEN_PAGES_EMBEDDED_GITHUB_CLIENT_ID")
        .filter(|id| !id.is_empty())
        .unwrap_or("")
        .to_string()
}

pub fn github_enabled() -> bool {
    !client_id().is_empty()
}

pub fn stored_token() -> Option<String> {
    read_secret(TOKEN_ACCOUNT)
}

pub fn stored_session() -> GitHubSession {
    let stored = read_secret(SESSION_ACCOUNT)
        .and_then(|raw| serde_json::from_str::<GitHubSession>(&raw).ok());
    GitHubSession {
        login: stored.as_ref().and_then(|s| s.login.clone()),
        name: stored.as_ref().and_then(|s| s.name.clone()),
        avatar_url: stored.as_ref().and_then(|s| s.avatar_url.clone()),
        github_enabled: github_enabled(),
    }
}

pub fn logout() -> Result<(), String> {
    delete_secret(TOKEN_ACCOUNT)?;
    delete_secret(SESSION_ACCOUNT)?;
    Ok(())
}

#[derive(Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: Option<u64>,
}

fn serve_device_page(listener: &TcpListener, user_code: &str, verification_uri: &str) {
    if let Ok((mut stream, _)) = listener.accept() {
        let html = format!(
            "<html><body style=\"font:18px/1.6 system-ui;padding:32px\">\
             <p>在 GitHub 输入此代码完成登录：</p>\
             <p style=\"font:32px/1.2 ui-monospace,monospace;letter-spacing:0.08em\"><strong>{user_code}</strong></p>\
             <p><a href=\"{verification_uri}\">打开 GitHub 设备登录</a></p>\
             <p>完成后回到 Open Pages。</p>\
             </body></html>"
        );
        let _ = stream.write_all(
            format!(
                "HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{html}",
                html.len()
            )
            .as_bytes(),
        );
    }
}

pub async fn login(mut open_url: impl FnMut(&str) -> Result<(), String>) -> Result<GitHubSession, String> {
    let client_id = client_id();
    if client_id.is_empty() {
        return Err("GITHUB_CLIENT_ID is not set".into());
    }

    let client = reqwest::Client::new();
    let device = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "client_id": client_id,
            "scope": "repo read:user",
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<DeviceCodeResponse>()
        .await
        .map_err(|e| format!("GitHub device login failed: {e}"))?;

    let listener = TcpListener::bind("127.0.0.1:3847").ok();
    if let Some(listener) = &listener {
        let _ = listener.set_nonblocking(true);
    }
    let _ = open_url("http://127.0.0.1:3847/");
    open_url(&device.verification_uri)?;

    let mut interval = Duration::from_secs(device.interval.unwrap_or(5).max(5));
    let deadline = Instant::now() + Duration::from_secs(device.expires_in.min(900));
    let token = loop {
        if let Some(listener) = &listener {
            serve_device_page(listener, &device.user_code, &device.verification_uri);
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "GitHub device login expired. Enter code {} at {} and try again.",
                device.user_code, device.verification_uri
            ));
        }
        tokio::time::sleep(interval).await;
        let token_res = client
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .json(&serde_json::json!({
                "client_id": client_id,
                "device_code": device.device_code,
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            }))
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json::<TokenResponse>()
            .await
            .map_err(|e| e.to_string())?;
        if let Some(token) = token_res.access_token {
            break token;
        }
        match token_res.error.as_deref() {
            Some("authorization_pending") | None => {}
            Some("slow_down") => interval += Duration::from_secs(5),
            Some("expired_token") => return Err("GitHub device login expired. Try again.".into()),
            Some("access_denied") => return Err("GitHub login was denied.".into()),
            Some(_) => {
                return Err(token_res
                    .error_description
                    .or(token_res.error)
                    .unwrap_or_else(|| "GitHub OAuth exchange failed".into()));
            }
        }
    };

    let user = client
        .get("https://api.github.com/user")
        .header("Accept", "application/vnd.github+json")
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", "open-pages")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<GitHubUser>()
        .await
        .map_err(|e| e.to_string())?;

    let session = GitHubSession {
        login: Some(user.login.clone()),
        name: Some(user.name.unwrap_or(user.login)),
        avatar_url: Some(user.avatar_url),
        github_enabled: true,
    };
    store_secret(TOKEN_ACCOUNT, &token)?;
    store_secret(
        SESSION_ACCOUNT,
        &serde_json::to_string(&session).map_err(|e| e.to_string())?,
    )?;
    Ok(session)
}
