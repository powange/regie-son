use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;
use tauri::Emitter;
use tokio::sync::Notify;

use crate::types::AudioFile;

pub const MAX_AUDIO_FILE_SIZE: u64 = 500 * 1024 * 1024; // 500 MB

pub fn parse_content_disposition_filename(disposition: &str) -> Option<String> {
    // RFC 6266: filename*=UTF-8''percent-encoded
    let lower = disposition.to_ascii_lowercase();
    if let Some(idx) = lower.find("filename*=utf-8''") {
        let rest = &disposition[idx + "filename*=utf-8''".len()..];
        let encoded = rest.split(';').next().unwrap_or(rest).trim();
        let decoded: String = {
            let bytes = encoded.as_bytes();
            let mut out = String::new();
            let mut i = 0;
            while i < bytes.len() {
                if bytes[i] == b'%' && i + 2 < bytes.len() {
                    if let Ok(s) = std::str::from_utf8(&bytes[i+1..i+3]) {
                        if let Ok(b) = u8::from_str_radix(s, 16) {
                            out.push(b as char);
                            i += 3;
                            continue;
                        }
                    }
                }
                out.push(bytes[i] as char);
                i += 1;
            }
            out
        };
        if !decoded.is_empty() { return Some(decoded); }
    }
    // Standard filename=
    disposition.split("filename=").nth(1)
        .map(|f| f.split(';').next().unwrap_or(f).trim_matches('"').trim_matches('\'').trim().to_string())
        .filter(|f| !f.is_empty())
}

#[derive(Serialize, Clone)]
struct YtDlpProgress { step: String }

fn silent_command(path: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(path);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

fn yt_dlp_target_name() -> &'static str {
    #[cfg(target_os = "windows")] { "yt-dlp.exe" }
    #[cfg(not(target_os = "windows"))] { "yt-dlp" }
}

fn yt_dlp_asset_name() -> &'static str {
    #[cfg(target_os = "windows")] { "yt-dlp.exe" }
    #[cfg(target_os = "macos")] { "yt-dlp_macos" }
    #[cfg(target_os = "linux")] { "yt-dlp_linux" }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))] { "yt-dlp" }
}

fn find_yt_dlp_sidecar() -> PathBuf {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidate = exe_dir.join(yt_dlp_target_name());
            if candidate.exists() { return candidate; }
        }
    }
    PathBuf::from("yt-dlp")
}

fn find_yt_dlp_with_app(app: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;
    if let Ok(dir) = app.path().app_data_dir() {
        let candidate = dir.join(yt_dlp_target_name());
        if candidate.exists() { return candidate; }
    }
    find_yt_dlp_sidecar()
}

// ===== Cancellation =====

struct CancelToken {
    cancelled: AtomicBool,
    notify: Notify,
}

impl CancelToken {
    fn new() -> Self { Self { cancelled: AtomicBool::new(false), notify: Notify::new() } }
    fn is_cancelled(&self) -> bool { self.cancelled.load(Ordering::Relaxed) }
    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
        self.notify.notify_waiters();
    }
    async fn wait(&self) {
        if self.is_cancelled() { return; }
        self.notify.notified().await;
    }
}

fn cancel_registry() -> &'static Mutex<HashMap<String, Arc<CancelToken>>> {
    static R: OnceLock<Mutex<HashMap<String, Arc<CancelToken>>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(HashMap::new()))
}

struct DownloadGuard {
    id: String,
    token: Arc<CancelToken>,
}

impl DownloadGuard {
    fn new(id: String) -> Self {
        let token = Arc::new(CancelToken::new());
        cancel_registry().lock().unwrap().insert(id.clone(), token.clone());
        Self { id, token }
    }
}

impl Drop for DownloadGuard {
    fn drop(&mut self) {
        cancel_registry().lock().unwrap().remove(&self.id);
    }
}

#[tauri::command]
pub fn cancel_download(id: String) {
    if let Some(token) = cancel_registry().lock().unwrap().get(&id) {
        token.cancel();
    }
}

fn cleanup_partial_files(musiques_dir: &Path, id: &str) {
    if let Ok(entries) = fs::read_dir(musiques_dir) {
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().starts_with(id) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}

#[tauri::command]
pub async fn download_youtube_audio(url: String, project_path: String, download_id: String, app: tauri::AppHandle) -> Result<AudioFile, String> {
    let guard = DownloadGuard::new(download_id);
    let yt_dlp = find_yt_dlp_with_app(&app);

    let check = silent_command(&yt_dlp).arg("--version").output();
    if check.is_err() || !check.unwrap().status.success() {
        return Err("yt-dlp est introuvable dans cette installation.".into());
    }

    let _ = app.emit("yt-dlp-progress", YtDlpProgress { step: "Récupération des informations de la vidéo…".into() });

    let title_out = silent_command(&yt_dlp)
        .args([
            "--print", "%(title)s",
            "--skip-download",
            "--no-warnings",
            "--no-playlist",
            &url,
        ])
        .output()
        .map_err(|e| format!("Erreur yt-dlp : {}", e))?;

    let title = if title_out.status.success() {
        String::from_utf8_lossy(&title_out.stdout)
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty() && !l.starts_with("WARNING:") && !l.starts_with("ERROR:"))
            .last()
            .unwrap_or("")
            .to_string()
    } else {
        String::new()
    };
    let title_display = if title.is_empty() { "YouTube audio".to_string() } else { title.clone() };

    let _ = app.emit("yt-dlp-progress", YtDlpProgress { step: format!("Téléchargement de « {} »…", title_display) });

    let id = uuid::Uuid::new_v4().to_string();
    let musiques_dir = PathBuf::from(&project_path).join("musiques");
    let output_template = musiques_dir.join(format!("{}.%(ext)s", id)).to_string_lossy().to_string();

    let mut cmd = tokio::process::Command::new(&yt_dlp);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.args([
        "-f", "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
        "-o", &output_template,
        "--no-playlist",
        &url,
    ]).kill_on_drop(true);

    let download_result = tokio::select! {
        r = cmd.output() => r,
        _ = guard.token.wait() => {
            cleanup_partial_files(&musiques_dir, &id);
            return Err("Téléchargement annulé.".into());
        }
    };

    let download = download_result.map_err(|e| format!("Erreur de téléchargement : {}", e))?;

    if !download.status.success() {
        let stderr = String::from_utf8_lossy(&download.stderr).to_string();
        cleanup_partial_files(&musiques_dir, &id);
        return Err(format!("Erreur yt-dlp : {}", stderr.lines().last().unwrap_or(&stderr)));
    }

    // Trouver le fichier créé (l'extension peut varier si ffmpeg est absent)
    let entry = fs::read_dir(&musiques_dir)
        .map_err(|e| format!("Erreur : {}", e))?
        .filter_map(|e| e.ok())
        .find(|e| e.file_name().to_string_lossy().starts_with(&id))
        .ok_or("Fichier introuvable après téléchargement")?;

    let filename = entry.file_name().to_string_lossy().to_string();
    let ext = Path::new(&filename).extension().unwrap_or_default().to_string_lossy();
    let display_title = if title.is_empty() { "YouTube audio".to_string() } else { title };
    let original_name = format!("{}.{}", display_title, ext);

    Ok(AudioFile { id, filename, original_name, volume: 100.0, start_time: None, end_time: None, fade_in: None, fade_out: None, cue: None })
}

#[tauri::command]
pub async fn download_audio_from_url(url: String, project_path: String, download_id: String) -> Result<AudioFile, String> {
    use std::io::Write;

    let guard = DownloadGuard::new(download_id);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Erreur client HTTP : {}", e))?;

    let mut response = tokio::select! {
        r = client.get(&url).send() => r.map_err(|e| format!("Erreur de téléchargement : {}", e))?,
        _ = guard.token.wait() => return Err("Téléchargement annulé.".into()),
    };

    if !response.status().is_success() {
        return Err(format!("Erreur HTTP {} : {}", response.status().as_u16(), url));
    }

    if let Some(len) = response.content_length() {
        if len > MAX_AUDIO_FILE_SIZE {
            return Err(format!(
                "Fichier trop volumineux ({} Mo). Limite : {} Mo.",
                len / (1024 * 1024),
                MAX_AUDIO_FILE_SIZE / (1024 * 1024)
            ));
        }
    }

    let content_type = response.headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let content_disposition = response.headers()
        .get("content-disposition")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let original_name = parse_content_disposition_filename(&content_disposition)
        .or_else(|| {
            url.split('?').next()
               .and_then(|u| u.split('/').last())
               .filter(|f| !f.is_empty())
               .map(|f| f.to_string())
        })
        .unwrap_or_else(|| "audio".to_string());

    let ext = Path::new(&original_name).extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
        .filter(|e| e.len() > 1)
        .or_else(|| {
            let ct = content_type.split(';').next().unwrap_or("").trim();
            match ct {
                "audio/mpeg" | "audio/mp3"  => Some(".mp3".into()),
                "audio/ogg"                 => Some(".ogg".into()),
                "audio/wav"                 => Some(".wav".into()),
                "audio/flac"                => Some(".flac".into()),
                "audio/aac"                 => Some(".aac".into()),
                "audio/mp4"                 => Some(".m4a".into()),
                _                           => Some(".mp3".into()),
            }
        })
        .unwrap_or_else(|| ".mp3".into());

    let id = uuid::Uuid::new_v4().to_string();
    let new_filename = format!("{}{}", id, ext);
    let dest = PathBuf::from(&project_path).join("musiques").join(&new_filename);

    let mut file = fs::File::create(&dest)
        .map_err(|e| format!("Impossible de créer le fichier : {}", e))?;
    let mut total: u64 = 0;
    loop {
        let chunk_result = tokio::select! {
            r = response.chunk() => r,
            _ = guard.token.wait() => {
                drop(file);
                let _ = fs::remove_file(&dest);
                return Err("Téléchargement annulé.".into());
            }
        };
        let chunk = match chunk_result {
            Ok(Some(c)) => c,
            Ok(None) => break,
            Err(e) => {
                drop(file);
                let _ = fs::remove_file(&dest);
                return Err(format!("Erreur de lecture : {}", e));
            }
        };
        total += chunk.len() as u64;
        if total > MAX_AUDIO_FILE_SIZE {
            drop(file);
            let _ = fs::remove_file(&dest);
            return Err(format!(
                "Fichier trop volumineux (limite : {} Mo).",
                MAX_AUDIO_FILE_SIZE / (1024 * 1024)
            ));
        }
        if let Err(e) = file.write_all(&chunk) {
            drop(file);
            let _ = fs::remove_file(&dest);
            return Err(format!("Erreur d'écriture : {}", e));
        }
    }

    Ok(AudioFile { id, filename: new_filename, original_name, volume: 100.0, start_time: None, end_time: None, fade_in: None, fade_out: None, cue: None })
}

#[tauri::command]
pub async fn get_yt_dlp_version(app: tauri::AppHandle) -> Result<String, String> {
    let yt_dlp = find_yt_dlp_with_app(&app);
    let out = silent_command(&yt_dlp).arg("--version").output()
        .map_err(|e| format!("yt-dlp introuvable : {}", e))?;
    if !out.status.success() {
        return Err("yt-dlp ne démarre pas correctement.".into());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[tauri::command]
pub async fn update_yt_dlp(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    use std::io::Write;

    let dir = app.path().app_data_dir()
        .map_err(|e| format!("Impossible de déterminer le dossier de données : {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir : {}", e))?;
    let target_path = dir.join(yt_dlp_target_name());
    let tmp_path = target_path.with_extension("download");

    let url = format!(
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/{}",
        yt_dlp_asset_name()
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Erreur client HTTP : {}", e))?;

    let mut response = client.get(&url).send().await
        .map_err(|e| format!("Erreur de téléchargement : {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Erreur HTTP {} lors du téléchargement", response.status().as_u16()));
    }

    let mut file = fs::File::create(&tmp_path)
        .map_err(|e| format!("Impossible de créer {} : {}", tmp_path.display(), e))?;

    while let Some(chunk) = response.chunk().await
        .map_err(|e| format!("Erreur de lecture : {}", e))?
    {
        file.write_all(&chunk).map_err(|e| format!("Erreur d'écriture : {}", e))?;
    }
    drop(file);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&tmp_path)
            .map_err(|e| format!("metadata : {}", e))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&tmp_path, perms)
            .map_err(|e| format!("chmod : {}", e))?;
    }

    let version_check = silent_command(&tmp_path).arg("--version").output();
    let ok = version_check.as_ref().map(|o| o.status.success()).unwrap_or(false);
    if !ok {
        let _ = fs::remove_file(&tmp_path);
        return Err("Le binaire téléchargé n'est pas exécutable sur ce système.".into());
    }
    let version = String::from_utf8_lossy(&version_check.unwrap().stdout).trim().to_string();

    fs::rename(&tmp_path, &target_path)
        .map_err(|e| format!("Impossible de remplacer l'ancien binaire : {}", e))?;

    Ok(version)
}
