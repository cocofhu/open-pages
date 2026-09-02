use std::fs;
use std::io::Write;
use std::net::TcpListener;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};

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

fn github_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("OpenPages-Desktop/0.1.7")
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

fn json_u64(value: &serde_json::Value, key: &str) -> Option<u64> {
    value.get(key).and_then(|v| {
        v.as_u64()
            .or_else(|| v.as_i64().and_then(|n| u64::try_from(n).ok()))
            .or_else(|| v.as_str()?.parse().ok())
    })
}

fn error_code(value: &serde_json::Value) -> Option<String> {
    value
        .get("error")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

fn error_text(value: &serde_json::Value) -> Option<String> {
    value
        .get("error_description")
        .and_then(serde_json::Value::as_str)
        .or_else(|| value.get("message").and_then(serde_json::Value::as_str))
        .map(str::to_string)
        .filter(|text| !text.is_empty())
        .or_else(|| error_code(value))
}

/// Device flow is off by default on OAuth apps, and GitHub then answers with a
/// generic error, so spell the fix out instead of leaking the raw payload.
fn device_flow_error(status: reqwest::StatusCode, value: &serde_json::Value) -> String {
    let detail = error_text(value).unwrap_or_else(|| format!("HTTP {status}"));
    format!(
        "{detail}。请在 GitHub Developer settings → OAuth Apps → 该应用中勾选 Enable Device Flow。"
    )
}

/// Returns the parsed body even for error payloads: the device flow reports
/// `authorization_pending` as a normal 200 response the caller has to poll on.
async fn github_json(
    response: reqwest::Response,
) -> Result<(reqwest::StatusCode, serde_json::Value), String> {
    let status = response.status();
    let raw = response
        .text()
        .await
        .map_err(|e| format!("GitHub 响应读取失败: {e}"))?;
    match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(value) => Ok((status, value)),
        Err(_) => {
            let snippet: String = raw.replace('\n', " ").chars().take(160).collect();
            Err(format!("GitHub 返回了非 JSON 响应（{status}）：{snippet}"))
        }
    }
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

pub async fn login(
    mut open_url: impl FnMut(&str) -> Result<(), String>,
    mut on_code: impl FnMut(&str, &str),
) -> Result<GitHubSession, String> {
    let client_id = client_id();
    if client_id.is_empty() {
        return Err("GITHUB_CLIENT_ID is not set".into());
    }

    let client = github_client()?;
    // GitHub's device endpoints only accept form bodies. JSON is ignored and the
    // response is HTML / {"error":"Not Found"}, which used to surface as
    // "error decoding response body".
    let response = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[("client_id", client_id.as_str()), ("scope", "repo read:user")])
        .send()
        .await
        .map_err(|e| format!("无法连接 GitHub 设备登录接口: {e}"))?;
    let (status, device_json) = github_json(response).await?;
    let Some(device_code) = device_json
        .get("device_code")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
    else {
        return Err(device_flow_error(status, &device_json));
    };
    let user_code = device_json
        .get("user_code")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_string();
    let verification_uri = device_json
        .get("verification_uri")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("https://github.com/login/device")
        .to_string();
    let verification_complete = device_json
        .get("verification_uri_complete")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let expires_in = json_u64(&device_json, "expires_in").unwrap_or(900);
    let interval_secs = json_u64(&device_json, "interval").unwrap_or(5).max(5);

    on_code(&user_code, &verification_uri);

    let listener = TcpListener::bind("127.0.0.1:3847").ok();
    if let Some(listener) = &listener {
        let _ = listener.set_nonblocking(true);
    }
    let _ = open_url("http://127.0.0.1:3847/");
    open_url(verification_complete.as_deref().unwrap_or(&verification_uri))?;

    let mut interval = Duration::from_secs(interval_secs);
    let deadline = Instant::now() + Duration::from_secs(expires_in.min(900));
    let token = loop {
        if Instant::now() >= deadline {
            return Err(format!(
                "GitHub device login expired. Enter code {} at {} and try again.",
                user_code, verification_uri
            ));
        }
        // Keep serving the code page while waiting instead of once per interval.
        let wake = Instant::now() + interval;
        while Instant::now() < wake {
            if let Some(listener) = &listener {
                serve_device_page(listener, &user_code, &verification_uri);
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        let response = client
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .form(&[
                ("client_id", client_id.as_str()),
                ("device_code", device_code.as_str()),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await
            .map_err(|e| format!("无法连接 GitHub 换票接口: {e}"))?;
        let (status, token_json) = github_json(response).await?;
        if let Some(token) = token_json
            .get("access_token")
            .and_then(serde_json::Value::as_str)
        {
            break token.to_string();
        }
        match error_code(&token_json).as_deref() {
            Some("authorization_pending") => {}
            Some("slow_down") => interval += Duration::from_secs(5),
            Some("expired_token") => return Err("GitHub 登录码已过期，请重新登录。".into()),
            Some("access_denied") => return Err("GitHub 登录被拒绝。".into()),
            Some("unauthorized_client") | Some("unsupported_grant_type") => {
                return Err(device_flow_error(status, &token_json));
            }
            Some(_) => {
                return Err(error_text(&token_json)
                    .unwrap_or_else(|| "GitHub OAuth exchange failed".into()));
            }
            None => {
                return Err(error_text(&token_json)
                    .unwrap_or_else(|| format!("GitHub 未返回访问令牌（{status}）")));
            }
        }
    };

    let response = client
        .get("https://api.github.com/user")
        .header("Accept", "application/vnd.github+json")
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| format!("无法读取 GitHub 用户信息: {e}"))?;
    let (status, user_json) = github_json(response).await?;
    let Some(login) = user_json
        .get("login")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
    else {
        return Err(
            error_text(&user_json).unwrap_or_else(|| format!("GitHub 用户信息获取失败（{status}）"))
        );
    };
    let name = user_json
        .get("name")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| login.clone());
    let avatar_url = user_json
        .get("avatar_url")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_string();

    let session = GitHubSession {
        login: Some(login),
        name: Some(name),
        avatar_url: Some(avatar_url),
        github_enabled: true,
    };
    store_secret(TOKEN_ACCOUNT, &token)?;
    store_secret(
        SESSION_ACCOUNT,
        &serde_json::to_string(&session).map_err(|e| e.to_string())?,
    )?;
    Ok(session)
}
