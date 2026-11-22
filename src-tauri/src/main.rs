#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tauri::{Manager, State};

/// 主密码派生迭代次数（OWASP 2023 建议 PBKDF2-SHA256 >= 600000）
const ITERATIONS: u32 = 600_000;
/// 附加认证数据，防止密文被替换到其他用途
const AAD: &[u8] = b"local-vault::v1";
const EMPTY_VAULT: &str = "{\"version\":1,\"items\":[],\"settings\":{}}";
/// 自动备份保留份数
const KEEP_BACKUPS: usize = 12;
/// 备份文件名前缀，用于识别/裁剪时避免误伤别的文件
const BACKUP_PREFIX: &str = "vault-";

struct AppState {
    vault_path: PathBuf,
    backup_dir: PathBuf,
    data_dir: PathBuf,
    key: Mutex<Option<[u8; 32]>>,
}

/// 明文偏好文件（只存备份目录路径，不含任何密码信息）
#[derive(Serialize, Deserialize, Default, Clone)]
struct Prefs {
    #[serde(default)]
    extra_backup_dir: Option<String>,
}

#[derive(Serialize)]
struct BackupConfig {
    primary: String,
    extra: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct KdfInfo {
    algo: String,
    iterations: u32,
    salt: String,
}

#[derive(Serialize, Deserialize)]
struct Envelope {
    version: u32,
    kdf: KdfInfo,
    iv: String,
    data: String,
}

#[derive(Serialize)]
struct Status {
    exists: bool,
    path: String,
    backup_dir: String,
}

#[derive(Serialize)]
struct BackupInfo {
    name: String,
    size: u64,
    modified: u64,
    /// "primary" | "extra"
    dir: String,
    dir_path: String,
}

#[derive(Serialize)]
struct FoundBackup {
    path: String,
    name: String,
    size: u64,
    modified: u64,
    source: String,
}

fn derive_key(password: &str, salt: &[u8], iterations: u32) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, iterations, &mut key);
    key
}

fn encrypt_with(key: &[u8; 32], salt_b64: &str, iterations: u32, plaintext: &[u8]) -> Result<Envelope, String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut iv = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut iv);
    let ct = cipher
        .encrypt(Nonce::from_slice(&iv), Payload { msg: plaintext, aad: AAD })
        .map_err(|_| "加密失败".to_string())?;
    Ok(Envelope {
        version: 1,
        kdf: KdfInfo {
            algo: "PBKDF2-HMAC-SHA256".to_string(),
            iterations,
            salt: salt_b64.to_string(),
        },
        iv: B64.encode(iv),
        data: B64.encode(ct),
    })
}

fn decrypt_with(key: &[u8; 32], env: &Envelope) -> Result<Vec<u8>, String> {
    let iv = B64.decode(&env.iv).map_err(|_| "密文格式错误".to_string())?;
    let ct = B64.decode(&env.data).map_err(|_| "密文格式错误".to_string())?;
    if iv.len() != 12 {
        return Err("密文格式错误".to_string());
    }
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    cipher
        .decrypt(Nonce::from_slice(&iv), Payload { msg: &ct, aad: AAD })
        .map_err(|_| "主密码不正确，或数据文件已损坏".to_string())
}

fn read_envelope(path: &Path) -> Result<Envelope, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("读取数据文件失败：{e}"))?;
    serde_json::from_str(&raw).map_err(|_| "数据文件格式不正确".to_string())
}

/// 原子写入：先写临时文件并 fsync，再 rename 覆盖，避免断电写坏
fn write_atomic(path: &Path, env: &Envelope) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(env).map_err(|e| format!("序列化失败：{e}"))?;
    let tmp = path.with_extension("dat.tmp");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("写入失败：{e}"))?;
        f.write_all(&json).map_err(|e| format!("写入失败：{e}"))?;
        f.sync_all().map_err(|e| format!("写入失败：{e}"))?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("写入失败：{e}"))?;
    Ok(())
}

/// 当前时间戳：YYYYMMDD-HHMMSS
fn now_stamp() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{:04}{:02}{:02}-{:02}{:02}{:02}",
        y,
        m,
        d,
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/* ---------------- 备份位置 ---------------- */

fn home_dir() -> Option<PathBuf> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
        .map(PathBuf::from)
}

/// 展开 ~ 前缀（只做这一种，够用且不会被 shell 注入）
fn expand_path(raw: &str) -> PathBuf {
    let s = raw.trim();
    if s == "~" {
        return home_dir().unwrap_or_default();
    }
    if let Some(rest) = s.strip_prefix("~/").or_else(|| s.strip_prefix("~\\")) {
        return home_dir().unwrap_or_default().join(rest);
    }
    PathBuf::from(s)
}

fn prefs_file(data_dir: &Path) -> PathBuf {
    data_dir.join("prefs.json")
}

fn read_prefs(data_dir: &Path) -> Prefs {
    fs::read_to_string(prefs_file(data_dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_prefs(data_dir: &Path, p: &Prefs) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(p).map_err(|e| format!("保存设置失败：{e}"))?;
    fs::write(prefs_file(data_dir), json).map_err(|e| format!("保存设置失败：{e}"))
}

/// 额外备份目录（已展开、去空）
fn extra_backup_dir(state: &AppState) -> Option<PathBuf> {
    let raw = read_prefs(&state.data_dir).extra_backup_dir?;
    if raw.trim().is_empty() {
        return None;
    }
    let p = expand_path(&raw);
    if p == state.backup_dir || p.as_os_str().is_empty() {
        return None;
    }
    Some(p)
}

/// 所有生效的备份目录：("primary"|"extra", 路径)
fn backup_dirs(state: &AppState) -> Vec<(String, PathBuf)> {
    let mut v = vec![("primary".to_string(), state.backup_dir.clone())];
    if let Some(p) = extra_backup_dir(state) {
        v.push(("extra".to_string(), p));
    }
    v
}

/// 允许「从这里恢复」的目录白名单：备份目录 + 桌面 + 文稿
fn allowed_restore_dirs(state: &AppState) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = backup_dirs(state).into_iter().map(|(_, p)| p).collect();
    if let Some(home) = home_dir() {
        v.push(home.join("Desktop"));
        v.push(home.join("Documents"));
        v.push(home.join("Documents").join("Vault Backups"));
    }
    v
}

/// 取某个备份位置上的一份备份，顺便做路径穿越校验
fn resolve_backup(state: &AppState, name: &str, dir_key: &str) -> Result<PathBuf, String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") || !name.ends_with(".dat") {
        return Err("备份名称不合法".to_string());
    }
    let dirs = backup_dirs(state);
    let (_, base) = dirs
        .iter()
        .find(|(k, _)| k == dir_key)
        .ok_or("备份位置不存在")?;
    let p = base.join(name);
    if !p.is_file() {
        return Err("备份不存在".to_string());
    }
    Ok(p)
}

/// 裁剪某个备份目录里的旧备份，并按天补一份当天快照
fn backup_into(dir: &Path, src: &Path, today: &str, stamp: &str) {
    let _ = fs::create_dir_all(dir);
    let mut files: Vec<(SystemTime, PathBuf)> = fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    if !name.starts_with(BACKUP_PREFIX) || !name.ends_with(".dat") {
                        return None;
                    }
                    let t = e
                        .metadata()
                        .and_then(|m| m.modified())
                        .unwrap_or(UNIX_EPOCH);
                    Some((t, e.path()))
                })
                .collect()
        })
        .unwrap_or_default();

    let has_today = files
        .iter()
        .any(|(_, p)| p.file_name().map(|n| n.to_string_lossy().contains(today)).unwrap_or(false));
    if !has_today {
        let target = dir.join(format!("{BACKUP_PREFIX}{stamp}.dat"));
        if fs::copy(src, &target).is_ok() {
            if let Ok(m) = fs::metadata(&target) {
                files.push((m.modified().unwrap_or(UNIX_EPOCH), target));
            }
        }
    }

    // 只保留最近 KEEP_BACKUPS 份
    if files.len() > KEEP_BACKUPS {
        files.sort_by_key(|(t, _)| *t);
        let drop_count = files.len() - KEEP_BACKUPS;
        for (_, p) in files.into_iter().take(drop_count) {
            let _ = fs::remove_file(p);
        }
    }
}

/// 保存时顺带做一次按天自动备份（内置目录 + 自定义目录各一份），并清理旧的
fn auto_backup(state: &AppState) {
    if !state.vault_path.exists() {
        return;
    }
    let stamp = now_stamp();
    let today = &stamp[..8];
    for (_, dir) in backup_dirs(state) {
        backup_into(&dir, &state.vault_path, today, &stamp);
    }
}

#[tauri::command]
fn vault_status(state: State<'_, AppState>) -> Status {
    Status {
        exists: state.vault_path.exists(),
        path: state.vault_path.display().to_string(),
        backup_dir: state.backup_dir.display().to_string(),
    }
}

#[tauri::command]
fn create_vault(password: String, state: State<'_, AppState>) -> Result<String, String> {
    if password.chars().count() < 6 {
        return Err("主密码至少 6 位".to_string());
    }
    if state.vault_path.exists() {
        return Err("密码库已存在".to_string());
    }
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    let salt_b64 = B64.encode(salt);
    let key = derive_key(&password, &salt, ITERATIONS);
    let env = encrypt_with(&key, &salt_b64, ITERATIONS, EMPTY_VAULT.as_bytes())?;
    write_atomic(&state.vault_path, &env)?;
    *state.key.lock().map_err(|_| "内部状态异常".to_string())? = Some(key);
    Ok(EMPTY_VAULT.to_string())
}

#[tauri::command]
fn unlock(password: String, state: State<'_, AppState>) -> Result<String, String> {
    let env = read_envelope(&state.vault_path)?;
    let salt = B64
        .decode(&env.kdf.salt)
        .map_err(|_| "数据文件格式不正确".to_string())?;
    let iterations = env.kdf.iterations.clamp(100_000, 2_000_000);
    let key = derive_key(&password, &salt, iterations);
    let plain = decrypt_with(&key, &env)?;
    let text = String::from_utf8(plain).map_err(|_| "数据内容损坏".to_string())?;
    *state.key.lock().map_err(|_| "内部状态异常".to_string())? = Some(key);
    Ok(text)
}

#[tauri::command]
fn lock(state: State<'_, AppState>) {
    if let Ok(mut k) = state.key.lock() {
        if let Some(bytes) = k.as_mut() {
            // 主动擦除内存中的密钥
            for b in bytes.iter_mut() {
                *b = 0;
            }
        }
        *k = None;
    }
}

#[tauri::command]
fn save_vault(data: String, state: State<'_, AppState>) -> Result<(), String> {
    let guard = state.key.lock().map_err(|_| "内部状态异常".to_string())?;
    let key = guard.as_ref().ok_or("尚未解锁")?;
    let env_old = read_envelope(&state.vault_path)?;
    auto_backup(&state);
    let env = encrypt_with(key, &env_old.kdf.salt, env_old.kdf.iterations, data.as_bytes())?;
    write_atomic(&state.vault_path, &env)
}

#[tauri::command]
fn change_password(new_password: String, state: State<'_, AppState>) -> Result<(), String> {
    if new_password.chars().count() < 6 {
        return Err("主密码至少 6 位".to_string());
    }
    let mut guard = state.key.lock().map_err(|_| "内部状态异常".to_string())?;
    let old_key = *guard.as_ref().ok_or("尚未解锁")?;
    let env = read_envelope(&state.vault_path)?;
    let plain = decrypt_with(&old_key, &env)?;

    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    let salt_b64 = B64.encode(salt);
    let new_key = derive_key(&new_password, &salt, ITERATIONS);
    let new_env = encrypt_with(&new_key, &salt_b64, ITERATIONS, &plain)?;
    auto_backup(&state);
    write_atomic(&state.vault_path, &new_env)?;
    *guard = Some(new_key);
    Ok(())
}

#[tauri::command]
fn export_backup(state: State<'_, AppState>) -> Result<String, String> {
    if !state.vault_path.exists() {
        return Err("还没有可导出的数据".to_string());
    }
    let name = format!("vault-backup-{}.dat", now_stamp());
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "无法定位用户目录".to_string())?;
    let desktop = PathBuf::from(&home).join("Desktop");
    let dir = if desktop.is_dir() {
        desktop
    } else {
        PathBuf::from(home)
    };
    let target = dir.join(&name);
    fs::copy(&state.vault_path, &target).map_err(|e| format!("导出失败：{e}"))?;
    Ok(target.display().to_string())
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let u = url.trim();
    let lower = u.to_lowercase();
    // 只放行 http/https，避免被构造成执行任意命令
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("只支持 http/https 链接".to_string());
    }
    if u.contains('\n') || u.contains('\r') || u.contains('\0') {
        return Err("链接格式不正确".to_string());
    }

    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open").arg(u).status();

    #[cfg(target_os = "windows")]
    let status = std::process::Command::new("cmd")
        .args(["/C", "start", "", u])
        .status();

    #[cfg(all(unix, not(target_os = "macos")))]
    let status = std::process::Command::new("xdg-open").arg(u).status();

    match status {
        Ok(s) if s.success() => Ok(()),
        Ok(_) => Err("没能打开浏览器".to_string()),
        Err(e) => Err(format!("打开失败：{e}")),
    }
}

#[tauri::command]
fn list_backups(state: State<'_, AppState>) -> Vec<BackupInfo> {
    let mut list: Vec<BackupInfo> = Vec::new();
    for (key, dir) in backup_dirs(&state) {
        let dir_path = dir.display().to_string();
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for e in rd.filter_map(|e| e.ok()) {
            let name = e.file_name().to_string_lossy().to_string();
            if !name.starts_with(BACKUP_PREFIX) || !name.ends_with(".dat") {
                continue;
            }
            let Ok(meta) = e.metadata() else { continue };
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            list.push(BackupInfo {
                name,
                size: meta.len(),
                modified,
                dir: key.clone(),
                dir_path: dir_path.clone(),
            });
        }
    }
    list.sort_by(|a, b| b.modified.cmp(&a.modified));
    list
}

#[tauri::command]
fn delete_backup(name: String, dir: String, state: State<'_, AppState>) -> Result<(), String> {
    let p = resolve_backup(&state, &name, &dir)?;
    fs::remove_file(&p).map_err(|e| format!("删除失败：{e}"))
}

/// 覆盖主文件前，先给当前内容留一份快照，避免恢复选错就再也回不去
fn snapshot_before_restore(state: &AppState) {
    if !state.vault_path.exists() {
        return;
    }
    if let Ok(bytes) = fs::read(&state.vault_path) {
        if bytes.len() < 200 {
            return; // 空库不值得留
        }
    }
    let stamp = now_stamp();
    let target = state
        .backup_dir
        .join(format!("{BACKUP_PREFIX}{stamp}-before-restore.dat"));
    let _ = fs::create_dir_all(&state.backup_dir);
    let _ = fs::copy(&state.vault_path, target);
}

#[tauri::command]
fn restore_backup(name: String, dir: String, state: State<'_, AppState>) -> Result<(), String> {
    let src = resolve_backup(&state, &name, &dir)?;
    read_envelope(&src)?;
    snapshot_before_restore(&state);
    let tmp = state.vault_path.with_extension("dat.restore");
    fs::copy(&src, &tmp).map_err(|e| format!("恢复失败：{e}"))?;
    fs::rename(&tmp, &state.vault_path).map_err(|e| format!("恢复失败：{e}"))?;
    lock(state);
    Ok(())
}

/* ---------------- 备份位置管理 ---------------- */

#[tauri::command]
fn backup_config(state: State<'_, AppState>) -> BackupConfig {
    BackupConfig {
        primary: state.backup_dir.display().to_string(),
        extra: extra_backup_dir(&state).map(|p| p.display().to_string()),
    }
}

#[tauri::command]
fn set_backup_dir(path: Option<String>, state: State<'_, AppState>) -> Result<BackupConfig, String> {
    let mut prefs = read_prefs(&state.data_dir);
    match path {
        Some(raw) if !raw.trim().is_empty() => {
            let p = expand_path(&raw);
            if p == state.backup_dir {
                return Err("这就是内置备份目录，换一个位置更有意义".to_string());
            }
            fs::create_dir_all(&p).map_err(|e| format!("无法创建目录：{e}"))?;
            if !p.is_dir() {
                return Err("这不是一个有效目录".to_string());
            }
            // 真写一次，确认权限
            let probe = p.join(".vault-write-test");
            fs::write(&probe, b"ok").map_err(|e| format!("这个目录不可写：{e}"))?;
            let _ = fs::remove_file(&probe);
            prefs.extra_backup_dir = Some(p.display().to_string());
            // 立刻补一份，别等下次保存
            if state.vault_path.exists() {
                let stamp = now_stamp();
                let today = stamp[..8].to_string();
                backup_into(&p, &state.vault_path, &today, &stamp);
            }
        }
        _ => prefs.extra_backup_dir = None,
    }
    write_prefs(&state.data_dir, &prefs)?;
    Ok(backup_config(state))
}

/// 系统原生「选择文件夹」对话框
#[tauri::command]
fn pick_backup_dir() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("osascript")
            .args(["-e", "POSIX path of (choose folder with prompt \"选择备份目录\")"])
            .output()
            .map_err(|e| format!("无法打开选择框：{e}"))?;
        if !out.status.success() {
            return Ok(None); // 用户取消
        }
        let s = String::from_utf8_lossy(&out.stdout).trim().trim_end_matches('/').to_string();
        return Ok(if s.is_empty() { None } else { Some(s) });
    }

    #[cfg(target_os = "windows")]
    {
        let script = "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = '选择备份目录'; if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath }";
        let out = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", script])
            .output()
            .map_err(|e| format!("无法打开选择框：{e}"))?;
        if !out.status.success() {
            return Ok(None);
        }
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        return Ok(if s.is_empty() { None } else { Some(s) });
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Err("当前系统不支持目录选择，请手动填写路径".to_string())
    }
}

/// 在文件管理器里打开某个备份目录
#[tauri::command]
fn reveal_dir(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let p = expand_path(&path);
    let canon = fs::canonicalize(&p).unwrap_or_else(|_| p.clone());
    let known = allowed_restore_dirs(&state)
        .into_iter()
        .any(|d| fs::canonicalize(&d).map(|c| c == canon).unwrap_or(false));
    if !known {
        return Err("只能打开备份相关目录".to_string());
    }
    if !canon.is_dir() {
        return Err("目录不存在".to_string());
    }

    #[cfg(target_os = "macos")]
    let st = std::process::Command::new("open").arg(&canon).status();
    #[cfg(target_os = "windows")]
    let st = std::process::Command::new("explorer").arg(&canon).status();
    #[cfg(all(unix, not(target_os = "macos")))]
    let st = std::process::Command::new("xdg-open").arg(&canon).status();

    match st {
        Ok(s) if s.success() => Ok(()),
        Ok(_) => Err("没能打开目录".to_string()),
        Err(e) => Err(format!("打开失败：{e}")),
    }
}

/// 首次运行探测：主文件不存在时，找找历史备份还在不在
#[tauri::command]
fn probe_backups(state: State<'_, AppState>) -> Vec<FoundBackup> {
    let mut dirs: Vec<(String, PathBuf)> = backup_dirs(&state)
        .into_iter()
        .map(|(k, p)| {
            let label = if k == "extra" { "自定义备份目录" } else { "内置备份目录" };
            (label.to_string(), p)
        })
        .collect();
    if let Some(home) = home_dir() {
        dirs.push(("文稿/Vault Backups".to_string(), home.join("Documents").join("Vault Backups")));
        dirs.push(("桌面".to_string(), home.join("Desktop")));
        dirs.push(("下载".to_string(), home.join("Downloads")));
    }

    let mut out: Vec<FoundBackup> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for (label, dir) in dirs {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for e in rd.filter_map(|e| e.ok()) {
            let name = e.file_name().to_string_lossy().to_string();
            if !name.starts_with("vault") || !name.ends_with(".dat") {
                continue;
            }
            let Ok(meta) = e.metadata() else { continue };
            if !meta.is_file() || meta.len() < 200 {
                continue; // 空文件或坏文件，恢复也没用
            }
            let path = e.path().display().to_string();
            if seen.contains(&path) {
                continue;
            }
            seen.push(path.clone());
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            out.push(FoundBackup {
                path,
                name,
                size: meta.len(),
                modified,
                source: label.clone(),
            });
        }
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out.truncate(20);
    out
}

/// 从任意白名单目录里的 .dat 恢复（首次运行救数据用）
#[tauri::command]
fn restore_from_path(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let p = expand_path(&path);
    if !p.is_file() {
        return Err("备份不存在".to_string());
    }
    let name = p
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    if !name.starts_with("vault") || !name.ends_with(".dat") || name.contains("..") {
        return Err("这不是一份备份文件".to_string());
    }
    let parent = p.parent().ok_or("路径不合法")?.to_path_buf();
    let canon_parent = fs::canonicalize(&parent).unwrap_or(parent);
    let allowed = allowed_restore_dirs(&state)
        .into_iter()
        .any(|d| fs::canonicalize(&d).map(|c| c == canon_parent).unwrap_or(false));
    if !allowed {
        return Err("只能从备份目录、桌面或文稿恢复".to_string());
    }

    read_envelope(&p)?;
    snapshot_before_restore(&state);
    let tmp = state.vault_path.with_extension("dat.restore");
    fs::copy(&p, &tmp).map_err(|e| format!("恢复失败：{e}"))?;
    fs::rename(&tmp, &state.vault_path).map_err(|e| format!("恢复失败：{e}"))?;
    lock(state);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SALT: [u8; 16] = [7u8; 16];

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let key = derive_key("correct horse battery", &SALT, 10_000);
        let env = encrypt_with(&key, &B64.encode(SALT), 10_000, "机密内容 🔐".as_bytes()).unwrap();
        let out = decrypt_with(&key, &env).unwrap();
        assert_eq!(String::from_utf8(out).unwrap(), "机密内容 🔐");
    }

    #[test]
    fn wrong_password_is_rejected() {
        let k1 = derive_key("password-a", &SALT, 10_000);
        let k2 = derive_key("password-b", &SALT, 10_000);
        let env = encrypt_with(&k1, &B64.encode(SALT), 10_000, b"secret").unwrap();
        assert!(decrypt_with(&k2, &env).is_err());
    }

    #[test]
    fn tampered_ciphertext_is_rejected() {
        let key = derive_key("pw", &SALT, 10_000);
        let mut env = encrypt_with(&key, &B64.encode(SALT), 10_000, b"secret").unwrap();
        let mut raw = B64.decode(&env.data).unwrap();
        raw[0] ^= 0x01;
        env.data = B64.encode(&raw);
        assert!(decrypt_with(&key, &env).is_err());
    }

    #[test]
    fn every_encryption_uses_fresh_iv() {
        let key = derive_key("pw", &SALT, 10_000);
        let a = encrypt_with(&key, "salt", 10_000, b"same plaintext").unwrap();
        let b = encrypt_with(&key, "salt", 10_000, b"same plaintext").unwrap();
        assert_ne!(a.iv, b.iv);
        assert_ne!(a.data, b.data);
    }

    #[test]
    fn stamp_has_expected_shape() {
        let s = now_stamp();
        assert_eq!(s.len(), 15);
        assert_eq!(&s[8..9], "-");
        assert_eq!(&s[0..2], "20");
    }

    #[test]
    fn civil_date_conversion_is_sane() {
        // 1970-01-01 起算
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        // 2024-02-29（闰日）
        assert_eq!(civil_from_days(19782), (2024, 2, 29));
    }

    #[test]
    fn backup_keeps_one_per_day() {
        let tmp = std::env::temp_dir().join(format!("vault-bk-{}", now_stamp()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let src = tmp.join("src.dat");
        fs::write(&src, vec![b'x'; 300]).unwrap();
        let dir = tmp.join("bk");

        backup_into(&dir, &src, "20261122", "20261122-100000");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        // 同一天第二次保存不该再写一份
        backup_into(&dir, &src, "20261122", "20261122-180000");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn backup_prunes_down_to_keep_limit() {
        let tmp = std::env::temp_dir().join(format!("vault-prune-{}", now_stamp()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let src = tmp.join("src.dat");
        fs::write(&src, vec![b'x'; 300]).unwrap();
        let dir = tmp.join("bk");
        fs::create_dir_all(&dir).unwrap();
        for i in 1..=30 {
            let name = format!("vault-202601{:02}-{:02}0000.dat", (i % 28) + 1, i % 24);
            fs::write(dir.join(name), vec![b'x'; 300]).unwrap();
        }
        assert!(fs::read_dir(&dir).unwrap().count() > KEEP_BACKUPS);
        backup_into(&dir, &src, "20991231", "20991231-000000");
        assert!(fs::read_dir(&dir).unwrap().count() <= KEEP_BACKUPS + 1);

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn expand_path_handles_tilde() {
        let home = home_dir().unwrap();
        assert_eq!(expand_path("~/Documents/x"), home.join("Documents/x"));
        assert_eq!(expand_path("~"), home);
        assert_eq!(expand_path("/tmp"), PathBuf::from("/tmp"));
    }
}

#[tauri::command]
fn export_text(content: String, filename: String) -> Result<String, String> {
    let safe: String = filename
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let name = if safe.trim().is_empty() {
        "export.txt".to_string()
    } else {
        safe
    };
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "无法定位用户目录".to_string())?;
    let desktop = PathBuf::from(&home).join("Desktop");
    let dir = if desktop.is_dir() {
        desktop
    } else {
        PathBuf::from(home)
    };
    let target = dir.join(name);
    fs::write(&target, content.as_bytes()).map_err(|e| format!("写入失败：{e}"))?;
    Ok(target.display().to_string())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("无法定位数据目录：{e}"))?;
            fs::create_dir_all(&dir)?;
            let backup_dir = dir.join("backups");
            fs::create_dir_all(&backup_dir)?;
            app.manage(AppState {
                vault_path: dir.join("vault.dat"),
                backup_dir,
                data_dir: dir,
                key: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vault_status,
            create_vault,
            unlock,
            lock,
            save_vault,
            change_password,
            export_backup,
            list_backups,
            restore_backup,
            delete_backup,
            backup_config,
            set_backup_dir,
            pick_backup_dir,
            reveal_dir,
            probe_backups,
            restore_from_path,
            export_text,
            open_url
        ])
        .run(tauri::generate_context!())
        .expect("应用启动失败");
}
