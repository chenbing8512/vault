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

struct AppState {
    vault_path: PathBuf,
    backup_dir: PathBuf,
    key: Mutex<Option<[u8; 32]>>,
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

/// 保存时顺带做一次按天自动备份，并清理旧的
fn auto_backup(state: &AppState) {
    if !state.vault_path.exists() {
        return;
    }
    let stamp = now_stamp();
    let today = &stamp[..8];
    let dir = &state.backup_dir;
    let has_today = fs::read_dir(dir)
        .ok()
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .any(|e| e.file_name().to_string_lossy().contains(today))
        })
        .unwrap_or(false);
    if !has_today {
        let target = dir.join(format!("vault-{stamp}.dat"));
        let _ = fs::copy(&state.vault_path, &target);
    }
    // 只保留最近 KEEP_BACKUPS 份
    let mut files: Vec<(SystemTime, PathBuf)> = fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| {
                    let t = e
                        .metadata()
                        .and_then(|m| m.modified())
                        .unwrap_or(UNIX_EPOCH);
                    (t, e.path())
                })
                .collect()
        })
        .unwrap_or_default();
    if files.len() > KEEP_BACKUPS {
        files.sort_by_key(|(t, _)| *t);
        let drop_count = files.len() - KEEP_BACKUPS;
        for (_, p) in files.into_iter().take(drop_count) {
            let _ = fs::remove_file(p);
        }
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
fn list_backups(state: State<'_, AppState>) -> Vec<BackupInfo> {
    let mut list: Vec<BackupInfo> = fs::read_dir(&state.backup_dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter_map(|e| {
                    let meta = e.metadata().ok()?;
                    let modified = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    Some(BackupInfo {
                        name: e.file_name().to_string_lossy().to_string(),
                        size: meta.len(),
                        modified,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    list.sort_by(|a, b| b.modified.cmp(&a.modified));
    list
}

#[tauri::command]
fn restore_backup(name: String, state: State<'_, AppState>) -> Result<(), String> {
    // 只允许备份目录内的文件名，避免路径穿越
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("备份名称不合法".to_string());
    }
    let src = state.backup_dir.join(&name);
    if !src.exists() {
        return Err("备份不存在".to_string());
    }
    read_envelope(&src)?;
    let tmp = state.vault_path.with_extension("dat.restore");
    fs::copy(&src, &tmp).map_err(|e| format!("恢复失败：{e}"))?;
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
            restore_backup
        ])
        .run(tauri::generate_context!())
        .expect("应用启动失败");
}
