//! 云端同步：与 vault-sync 服务交互。
//!
//! 零知识：本模块只上传 Envelope（密文），服务端永远看不到明文和主密码。
//! 冲突策略：乐观锁版本号。push 时带 baseVersion，服务端不匹配返回 409。

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncAccount {
    pub server: String,
    pub token: String,
    pub user: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct VersionInfo {
    pub exists: bool,
    pub version: u64,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct PullResult {
    pub exists: bool,
    pub blob: String,
    pub version: u64,
}

#[derive(Deserialize, Debug)]
struct PushResp {
    version: u64,
}

#[derive(Deserialize, Debug)]
struct ApiErr {
    #[serde(default)]
    msg: String,
}

#[derive(Deserialize, Debug)]
struct AuthResp {
    token: String,
    #[serde(default)]
    user: Option<UserInfo>,
}

#[derive(Deserialize, Debug)]
struct UserInfo {
    #[serde(default)]
    username: String,
}

fn client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(25))
        .connect_timeout(Duration::from_secs(10))
        .user_agent(concat!("Vault/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败：{e}"))
}

fn base(server: &str) -> String {
    server.trim_end_matches('/').to_string()
}

async fn err_body(resp: reqwest::Response) -> String {
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if let Ok(e) = serde_json::from_str::<ApiErr>(&text) {
        if !e.msg.is_empty() { return e.msg; }
    }
    match status.as_u16() {
        401 => "未登录或登录已过期".into(),
        409 => "云端有更新的版本".into(),
        _ => format!("服务端返回 {status}"),
    }
}

/// 登录或注册。register=true 走 /register，否则 /login。
pub async fn login(server: String, username: String, password: String, register: bool) -> Result<SyncAccount, String> {
    let c = client()?;
    let path = if register { "/api/auth/register" } else { "/api/auth/login" };
    let url = format!("{}{}", base(&server), path);
    let resp = c.post(&url)
        .json(&serde_json::json!({ "username": username, "password": password }))
        .send().await
        .map_err(|e| format!("连接失败：{}", net_err(&e)))?;
    if !resp.status().is_success() { return Err(err_body(resp).await); }
    let r: AuthResp = resp.json().await.map_err(|_| "响应格式错误".to_string())?;
    Ok(SyncAccount {
        server: base(&server),
        token: r.token,
        user: r.user.map(|u| u.username).unwrap_or_else(|| username.to_string()),
    })
}

fn net_err(e: &reqwest::Error) -> String {
    if e.is_connect() { "无法连接服务器，检查网络或服务端地址".into() }
    else if e.is_timeout() { "连接超时".into() }
    else { e.to_string() }
}

/// 只查版本（不拉 blob）
pub async fn version(acct: SyncAccount) -> Result<VersionInfo, String> {
    let c = client()?;
    let resp = c.get(format!("{}/api/sync/version", base(&acct.server)))
        .bearer_auth(&acct.token)
        .header("X-Client", client_name())
        .send().await
        .map_err(|e| net_err(&e))?;
    if !resp.status().is_success() { return Err(err_body(resp).await); }
    resp.json().await.map_err(|_| "响应格式错误".to_string())
}

/// 拉取密文
pub async fn pull(acct: SyncAccount) -> Result<PullResult, String> {
    let c = client()?;
    let resp = c.get(format!("{}/api/sync/pull", base(&acct.server)))
        .bearer_auth(&acct.token)
        .header("X-Client", client_name())
        .send().await
        .map_err(|e| net_err(&e))?;
    if !resp.status().is_success() { return Err(err_body(resp).await); }
    resp.json().await.map_err(|_| "响应格式错误".to_string())
}

/// 推送密文。Ok(version) 是服务端新版本号；Err 以 "CONFLICT:" 开头表示冲突。
pub async fn push(acct: SyncAccount, blob: String, base_version: u64) -> Result<u64, String> {
    let c = client()?;
    let resp = c.post(format!("{}/api/sync/push", base(&acct.server)))
        .bearer_auth(&acct.token)
        .header("X-Client", client_name())
        .json(&serde_json::json!({ "blob": blob, "baseVersion": base_version }))
        .send().await
        .map_err(|e| net_err(&e))?;
    if resp.status().as_u16() == 409 { return Err("CONFLICT:云端有更新的版本".into()); }
    if !resp.status().is_success() { return Err(err_body(resp).await); }
    let text = resp.text().await.map_err(|e| net_err(&e))?;
    let r: PushResp = serde_json::from_str(&text).map_err(|e| format!("响应格式错误：{e} / {text}"))?;
    Ok(r.version)
}

/// 最近同步记录（服务端 JSON 数组的原始 serde_json::Value）
pub async fn logs(acct: SyncAccount, limit: u32) -> Result<serde_json::Value, String> {
    let c = client()?;
    let resp = c.get(format!("{}/api/sync/logs?limit={}", base(&acct.server), limit.min(100)))
        .bearer_auth(&acct.token)
        .send().await
        .map_err(|e| net_err(&e))?;
    if !resp.status().is_success() { return Err(err_body(resp).await); }
    resp.json().await.map_err(|_| "响应格式错误".to_string())
}

pub fn client_name() -> String {
    let os = if cfg!(target_os = "macos") { "macOS" }
        else if cfg!(target_os = "windows") { "Windows" }
        else if cfg!(target_os = "linux") { "Linux" }
        else { "unknown" };
    let host = std::env::var("HOSTNAME").or_else(|_| std::env::var("COMPUTERNAME")).unwrap_or_default();
    if host.is_empty() { os.to_string() } else { format!("{os}·{}", host.chars().take(16).collect::<String>()) }
}
