use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::time::Duration;
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const LOOPBACK_REDIRECT: &str = "http://127.0.0.1:3847/auth/callback";
const SERVICE: &str = "open-pages";
const TOKEN_ACCOUNT: &str = "github-token";
const SESSION_ACCOUNT: &str = "github-session";
const OAUTH_CALLBACK_TIMEOUT: Duration = Duration::from_secs(300);

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

fn base64_url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn create_pkce_pair() -> (String, String) {
    let mut raw = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut raw);
    let verifier = base64_url(&raw);
    let challenge = base64_url(&Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
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

fn wait_for_callback(expected_state: &str) -> Result<String, String> {
    let listener = TcpListener::bind("127.0.0.1:3847").map_err(|e| {
        format!("OAuth loopback 127.0.0.1:3847 is busy: {e}")
    })?;
    listener
        .set_nonblocking(false)
        .map_err(|e| e.to_string())?;
    let (mut stream, _) = listener
        .accept()
        .map_err(|e| format!("OAuth callback failed: {e}"))?;
    let mut buf = [0u8; 4096];
    let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
    let request = String::from_utf8_lossy(&buf[..n]);
    let path = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or_else(|| "Invalid OAuth callback".to_string())?;
    let url = url::Url::parse(&format!("http://127.0.0.1:3847{path}")).map_err(|e| e.to_string())?;
    let code = url
        .query_pairs()
        .find(|(k, _)| k == "code")
        .map(|(_, v)| v.into_owned());
    let state = url
        .query_pairs()
        .find(|(k, _)| k == "state")
        .map(|(_, v)| v.into_owned());
    let oauth_error = url
        .query_pairs()
        .find(|(k, _)| k == "error")
        .map(|(_, v)| v.into_owned());
    let oauth_error_description = url
        .query_pairs()
        .find(|(k, _)| k == "error_description")
        .map(|(_, v)| v.into_owned());
    let html = if code.is_some() && state.as_deref() == Some(expected_state) {
        "<html><body style=\"font:16px/1.5 system-ui;padding:32px\">已登录 GitHub，可以关闭此窗口回到 Open Pages。</body></html>"
    } else {
        "<html><body style=\"font:16px/1.5 system-ui;padding:32px\">登录失败，请回到 Open Pages 重试。</body></html>"
    };
    let _ = stream.write_all(
        format!(
            "HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{html}",
            html.len()
        )
        .as_bytes(),
    );
    if state.as_deref() != Some(expected_state) {
        return Err("OAuth state mismatch".into());
    }
    if let Some(error) = oauth_error {
        return Err(oauth_error_description.unwrap_or(error));
    }
    code.ok_or_else(|| "OAuth callback missing code".into())
}

pub async fn login(open_url: impl FnOnce(&str) -> Result<(), String>) -> Result<GitHubSession, String> {
    let client_id = client_id();
    if client_id.is_empty() {
        return Err("GITHUB_CLIENT_ID is not set".into());
    }
    let (verifier, challenge) = create_pkce_pair();
    let state = {
        let mut raw = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut raw);
        base64_url(&raw)
    };
    let authorize = format!(
        "https://github.com/login/oauth/authorize?client_id={}&redirect_uri={}&scope={}&state={}&code_challenge={}&code_challenge_method=S256",
        urlencoding::encode(&client_id),
        urlencoding::encode(LOOPBACK_REDIRECT),
        urlencoding::encode("repo read:user"),
        urlencoding::encode(&state),
        urlencoding::encode(&challenge),
    );
    open_url(&authorize)?;
    let code = tokio::time::timeout(
        OAUTH_CALLBACK_TIMEOUT,
        tokio::task::spawn_blocking({
            let state = state.clone();
            move || wait_for_callback(&state)
        }),
    )
    .await
    .map_err(|_| "OAuth login timed out; complete authorization in the browser or try again".to_string())?
    .map_err(|e| e.to_string())??;

    let client = reqwest::Client::new();
    let token_res = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "client_id": client_id,
            "code": code,
            "redirect_uri": LOOPBACK_REDIRECT,
            "code_verifier": verifier,
            "grant_type": "authorization_code",
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<TokenResponse>()
        .await
        .map_err(|e| e.to_string())?;
    let token = token_res
        .access_token
        .ok_or_else(|| token_res.error_description.or(token_res.error).unwrap_or_else(|| "GitHub OAuth exchange failed".into()))?;

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
