use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;
use tauri::Emitter;
use tokio::sync::Notify;

use crate::error::{fail, missing, AppError, AppResult};
use crate::types::AudioFile;

pub const MAX_AUDIO_FILE_SIZE: u64 = 500 * 1024 * 1024; // 500 MB

pub(crate) const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

/// Client for downloads of any size. A whole-request timeout would fail a
/// large file on a slow link while it is still progressing: only an
/// unreachable server or a stalled transfer (60 s without a byte) gives up.
pub(crate) fn download_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(fail("cloud.httpClientFailed"))
}

// Percent-decoding works on bytes: "%C3%A9" is one UTF-8 "é", not two
// Latin-1 characters.
fn percent_decode(encoded: &str) -> String {
    let bytes = encoded.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Some(b) = std::str::from_utf8(&bytes[i + 1..i + 3])
                .ok()
                .and_then(|h| u8::from_str_radix(h, 16).ok())
            {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// The display name is only ever shown, but keep it to a bare name.
fn bare_name(name: &str) -> Option<String> {
    let last = name.rsplit(['/', '\\']).next().unwrap_or(name).trim();
    (!last.is_empty()).then(|| last.to_string())
}

pub fn parse_content_disposition_filename(disposition: &str) -> Option<String> {
    // RFC 6266: filename*=UTF-8''percent-encoded
    let lower = disposition.to_ascii_lowercase();
    if let Some(idx) = lower.find("filename*=utf-8''") {
        let rest = &disposition[idx + "filename*=utf-8''".len()..];
        let encoded = rest.split(';').next().unwrap_or(rest).trim();
        if let Some(name) = bare_name(&percent_decode(encoded)) {
            return Some(name);
        }
    }
    // Standard filename=
    disposition
        .split("filename=")
        .nth(1)
        .map(|f| {
            f.split(';')
                .next()
                .unwrap_or(f)
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .trim()
                .to_string()
        })
        .and_then(|f| bare_name(&f))
}

fn filename_from_url(url: &str) -> Option<String> {
    let path = url.split(['?', '#']).next()?;
    let last = path.split('/').next_back()?;
    bare_name(&percent_decode(last))
}

// Extensions a downloaded file may keep. Anything else (".php", "a:b", which
// would create an NTFS alternate stream) is replaced by what the bytes say.
const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "ogg", "oga", "opus", "wav", "flac", "aac", "m4a", "mp4", "wma", "webm", "aif", "aiff",
];

fn audio_extension(name: &str) -> Option<String> {
    let ext = Path::new(name).extension()?.to_str()?.to_ascii_lowercase();
    AUDIO_EXTENSIONS
        .contains(&ext.as_str())
        .then(|| format!(".{}", ext))
}

/// Recognises an audio container from its first bytes.
fn sniff_audio(head: &[u8]) -> Option<&'static str> {
    let at = |offset: usize, magic: &[u8]| head.get(offset..offset + magic.len()) == Some(magic);
    if at(0, b"ID3") {
        Some(".mp3")
    } else if head.len() >= 2 && head[0] == 0xFF && head[1] & 0xE0 == 0xE0 {
        // MPEG frame sync; layer bits 00 mean an ADTS AAC stream.
        Some(if head[1] & 0x06 == 0 { ".aac" } else { ".mp3" })
    } else if at(0, b"OggS") {
        Some(".ogg")
    } else if at(0, b"fLaC") {
        Some(".flac")
    } else if at(0, b"RIFF") && at(8, b"WAVE") {
        Some(".wav")
    } else if at(0, b"FORM") && (at(8, b"AIFF") || at(8, b"AIFC")) {
        Some(".aiff")
    } else if at(4, b"ftyp") {
        Some(".m4a")
    } else if at(0, &[0x1A, 0x45, 0xDF, 0xA3]) {
        Some(".webm")
    } else if at(0, &[0x30, 0x26, 0xB2, 0x75, 0x8E, 0x66, 0xCF, 0x11]) {
        Some(".wma")
    } else {
        None
    }
}

fn is_textual_content_type(content_type: &str) -> bool {
    content_type.starts_with("text/")
        || matches!(
            content_type,
            "application/json" | "application/xml" | "application/xhtml+xml"
        )
}

// A pasted link reaches yt-dlp as an argument: anything but a plain http(s)
// URL is refused, and callers also pass it after "--" so that a value such as
// `--exec=...` can never be read as an option.
fn validate_http_url(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim();
    match reqwest::Url::parse(trimmed) {
        Ok(url) if matches!(url.scheme(), "http" | "https") && url.host().is_some() => {
            Ok(trimmed.to_string())
        }
        _ => Err(AppError::new("download.invalidUrl")),
    }
}

#[derive(Serialize, Clone)]
struct YtDlpProgress {
    step: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
}

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
    #[cfg(target_os = "windows")]
    {
        "yt-dlp.exe"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "yt-dlp"
    }
}

fn yt_dlp_asset_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "yt-dlp.exe"
    }
    #[cfg(target_os = "macos")]
    {
        "yt-dlp_macos"
    }
    #[cfg(target_os = "linux")]
    {
        "yt-dlp_linux"
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        "yt-dlp"
    }
}

fn find_yt_dlp_sidecar() -> PathBuf {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidate = exe_dir.join(yt_dlp_target_name());
            if candidate.exists() {
                return candidate;
            }
        }
    }
    PathBuf::from("yt-dlp")
}

fn find_yt_dlp_with_app(app: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;
    if let Ok(dir) = app.path().app_data_dir() {
        let candidate = dir.join(yt_dlp_target_name());
        if candidate.exists() {
            return candidate;
        }
    }
    find_yt_dlp_sidecar()
}

// ===== Cancellation =====

struct CancelToken {
    cancelled: AtomicBool,
    notify: Notify,
}

impl CancelToken {
    fn new() -> Self {
        Self {
            cancelled: AtomicBool::new(false),
            notify: Notify::new(),
        }
    }
    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }
    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
        self.notify.notify_waiters();
    }
    async fn wait(&self) {
        if self.is_cancelled() {
            return;
        }
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
        cancel_registry()
            .lock()
            .unwrap()
            .insert(id.clone(), token.clone());
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
pub async fn download_youtube_audio(
    url: String,
    project_path: String,
    download_id: String,
    app: tauri::AppHandle,
) -> AppResult<AudioFile> {
    let url = validate_http_url(&url)?;
    let guard = DownloadGuard::new(download_id);
    let yt_dlp = find_yt_dlp_with_app(&app);

    let check = silent_command(&yt_dlp).arg("--version").output();
    if check.is_err() || !check.unwrap().status.success() {
        return Err(AppError::new("download.ytDlpMissing"));
    }

    let _ = app.emit(
        "yt-dlp-progress",
        YtDlpProgress {
            step: "fetchingInfo",
            title: None,
        },
    );

    let title_out = silent_command(&yt_dlp)
        .args([
            "--print",
            "%(title)s",
            "--skip-download",
            "--no-warnings",
            "--no-playlist",
            "--",
            &url,
        ])
        .output()
        .map_err(fail("download.ytDlpFailed"))?;

    let title = if title_out.status.success() {
        String::from_utf8_lossy(&title_out.stdout)
            .lines()
            .map(|l| l.trim())
            .rfind(|l| !l.is_empty() && !l.starts_with("WARNING:") && !l.starts_with("ERROR:"))
            .unwrap_or("")
            .to_string()
    } else {
        String::new()
    };
    let title_display = if title.is_empty() {
        "YouTube audio".to_string()
    } else {
        title.clone()
    };

    let _ = app.emit(
        "yt-dlp-progress",
        YtDlpProgress {
            step: "downloading",
            title: Some(title_display.clone()),
        },
    );

    let id = uuid::Uuid::new_v4().to_string();
    let musiques_dir = PathBuf::from(&project_path).join("musiques");
    let output_template = musiques_dir
        .join(format!("{}.%(ext)s", id))
        .to_string_lossy()
        .to_string();

    let mut cmd = tokio::process::Command::new(&yt_dlp);
    // tokio's Command has creation_flags built in, no CommandExt needed.
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    cmd.args([
        "-f",
        "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
        "-o",
        &output_template,
        "--no-playlist",
        "--",
        &url,
    ])
    .kill_on_drop(true);

    let download_result = tokio::select! {
        r = cmd.output() => r,
        _ = guard.token.wait() => {
            cleanup_partial_files(&musiques_dir, &id);
            return Err(AppError::new("download.cancelled"));
        }
    };

    let download = download_result.map_err(fail("download.failed"))?;

    if !download.status.success() {
        let stderr = String::from_utf8_lossy(&download.stderr).to_string();
        cleanup_partial_files(&musiques_dir, &id);
        return Err(
            AppError::new("download.ytDlpFailed").detail(stderr.lines().last().unwrap_or(&stderr))
        );
    }

    // Trouver le fichier créé (l'extension peut varier si ffmpeg est absent)
    let entry = fs::read_dir(&musiques_dir)
        .map_err(fail("download.unexpected"))?
        .filter_map(|e| e.ok())
        .find(|e| e.file_name().to_string_lossy().starts_with(&id))
        .ok_or_else(missing("download.fileNotFoundAfter"))?;

    let filename = entry.file_name().to_string_lossy().to_string();
    let ext = Path::new(&filename)
        .extension()
        .unwrap_or_default()
        .to_string_lossy();
    let display_title = if title.is_empty() {
        "YouTube audio".to_string()
    } else {
        title
    };
    let original_name = format!("{}.{}", display_title, ext);

    Ok(AudioFile {
        id,
        filename,
        original_name,
        volume: 100.0,
        start_time: None,
        end_time: None,
        fade_in: None,
        fade_out: None,
        cue: None,
    })
}

async fn next_chunk(
    response: &mut reqwest::Response,
    token: &CancelToken,
) -> AppResult<Option<bytes::Bytes>> {
    tokio::select! {
        r = response.chunk() => r.map_err(fail("io.readFailed")),
        _ = token.wait() => Err(AppError::new("download.cancelled")),
    }
}

#[tauri::command]
pub async fn download_audio_from_url(
    url: String,
    project_path: String,
    download_id: String,
) -> AppResult<AudioFile> {
    use std::io::Write;

    let url = validate_http_url(&url)?;
    let guard = DownloadGuard::new(download_id);

    let client = download_client()?;

    let mut response = tokio::select! {
        r = client.get(&url).send() => r.map_err(fail("download.failed"))?,
        _ = guard.token.wait() => return Err(AppError::new("download.cancelled")),
    };

    if !response.status().is_success() {
        return Err(AppError::new("download.httpStatus")
            .with("status", response.status().as_u16())
            .with("url", &url));
    }

    if let Some(len) = response.content_length() {
        if len > MAX_AUDIO_FILE_SIZE {
            return Err(AppError::new("download.fileTooLarge")
                .with("size", len / (1024 * 1024))
                .with("limit", MAX_AUDIO_FILE_SIZE / (1024 * 1024)));
        }
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();

    // A Google Drive or Dropbox share link answers with an HTML page: saved
    // as .mp3 it would only fail on the night of the show.
    if is_textual_content_type(&content_type) {
        return Err(AppError::new("download.notAudio").detail(&content_type));
    }

    let content_disposition = response
        .headers()
        .get("content-disposition")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let original_name = parse_content_disposition_filename(&content_disposition)
        .or_else(|| filename_from_url(&url))
        .unwrap_or_else(|| "audio".to_string());

    // Nothing is written before the first bytes say what the file is.
    let mut head: Vec<u8> = Vec::new();
    let mut finished = false;
    while head.len() < 16 {
        match next_chunk(&mut response, &guard.token).await? {
            Some(chunk) => head.extend_from_slice(&chunk),
            None => {
                finished = true;
                break;
            }
        }
    }
    let sniffed = sniff_audio(&head);
    if sniffed.is_none() && !content_type.starts_with("audio/") {
        return Err(AppError::new("download.notAudio").detail(&content_type));
    }

    let ext = audio_extension(&original_name)
        .or_else(|| sniffed.map(String::from))
        .unwrap_or_else(|| {
            match content_type.as_str() {
                "audio/ogg" => ".ogg",
                "audio/wav" | "audio/x-wav" | "audio/wave" => ".wav",
                "audio/flac" | "audio/x-flac" => ".flac",
                "audio/aac" => ".aac",
                "audio/mp4" | "audio/x-m4a" => ".m4a",
                "audio/webm" => ".webm",
                _ => ".mp3",
            }
            .to_string()
        });

    let id = uuid::Uuid::new_v4().to_string();
    let new_filename = format!("{}{}", id, ext);
    let dest = TempFile::new(
        PathBuf::from(&project_path)
            .join("musiques")
            .join(&new_filename),
    );

    let mut file = fs::File::create(&dest.path).map_err(fail("download.createFileFailed"))?;
    let mut total = head.len() as u64;
    file.write_all(&head).map_err(fail("io.writeFailed"))?;
    if !finished {
        while let Some(chunk) = next_chunk(&mut response, &guard.token).await? {
            total += chunk.len() as u64;
            if total > MAX_AUDIO_FILE_SIZE {
                return Err(AppError::new("download.fileTooLargeLimit")
                    .with("limit", MAX_AUDIO_FILE_SIZE / (1024 * 1024)));
            }
            file.write_all(&chunk).map_err(fail("io.writeFailed"))?;
        }
    }
    drop(file);
    dest.keep();

    Ok(AudioFile {
        id,
        filename: new_filename,
        original_name,
        volume: 100.0,
        start_time: None,
        end_time: None,
        fade_in: None,
        fade_out: None,
        cue: None,
    })
}

#[tauri::command]
pub async fn get_yt_dlp_version(app: tauri::AppHandle) -> AppResult<String> {
    let yt_dlp = find_yt_dlp_with_app(&app);
    let out = silent_command(&yt_dlp)
        .arg("--version")
        .output()
        .map_err(fail("download.ytDlpNotFound"))?;
    if !out.status.success() {
        return Err(AppError::new("download.ytDlpBroken"));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

const YT_DLP_RELEASES: &str = "https://github.com/yt-dlp/yt-dlp/releases";
const YT_DLP_LATEST_API: &str = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const MAX_YT_DLP_SIZE: u64 = 200 * 1024 * 1024;

#[derive(serde::Deserialize)]
struct Release {
    tag_name: String,
}

// yt-dlp tags are dates ("2025.09.26"): anything else is not a tag we can
// put in a download URL.
fn is_plausible_tag(tag: &str) -> bool {
    !tag.is_empty()
        && tag.len() <= 64
        && tag
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}

/// Hash of `asset` in the release's SHA2-256SUMS (`<hex>  <name>` per line).
fn expected_sha256(sums: &str, asset: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let name = parts.next()?.trim_start_matches('*');
        (name == asset && hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()))
            .then(|| hash.to_ascii_lowercase())
    })
}

fn installed_yt_dlp_version(app: &tauri::AppHandle) -> Option<String> {
    let out = silent_command(find_yt_dlp_with_app(app))
        .arg("--version")
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

// Removes a download on every early return: a failed or cancelled transfer
// must not leave a half-written file (or an unverified binary) behind.
struct TempFile {
    path: PathBuf,
    keep: bool,
}

impl TempFile {
    fn new(path: PathBuf) -> Self {
        Self { path, keep: false }
    }

    fn keep(mut self) {
        self.keep = true;
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        if !self.keep {
            let _ = fs::remove_file(&self.path);
        }
    }
}

async fn fetch_ok(client: &reqwest::Client, url: &str) -> AppResult<reqwest::Response> {
    let response = client
        .get(url)
        .header(reqwest::header::USER_AGENT, "regie-son")
        .send()
        .await
        .map_err(fail("download.failed"))?;
    if !response.status().is_success() {
        return Err(
            AppError::new("download.httpStatusUpdate").with("status", response.status().as_u16())
        );
    }
    Ok(response)
}

#[tauri::command]
pub async fn update_yt_dlp(app: tauri::AppHandle) -> AppResult<String> {
    use sha2::{Digest, Sha256};
    use std::io::Write;
    use tauri::Manager;

    // The launch-time update and the Settings button may overlap: the second
    // waits, then finds the binary already current.
    static UPDATE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _lock = UPDATE_LOCK.lock().await;

    let client = download_client()?;

    // A few hundred bytes instead of the whole binary on every launch.
    let tag = fetch_ok(&client, YT_DLP_LATEST_API)
        .await?
        .json::<Release>()
        .await
        .map_err(fail("download.releaseInfoInvalid"))?
        .tag_name;
    if !is_plausible_tag(&tag) {
        return Err(AppError::new("download.releaseInfoInvalid").detail(&tag));
    }
    if let Some(current) = installed_yt_dlp_version(&app) {
        if current == tag {
            return Ok(current);
        }
    }

    let dir = app
        .path()
        .app_data_dir()
        .map_err(fail("download.dataDirUnknown"))?;
    fs::create_dir_all(&dir).map_err(fail("io.createDirFailed"))?;
    let target_path = dir.join(yt_dlp_target_name());

    // Both files come from the same tag: "latest" could move between the two
    // requests. The binary is run below, and then preferred over the signed
    // sidecar, so it must match the published checksum first.
    let asset = yt_dlp_asset_name();
    let sums = fetch_ok(
        &client,
        &format!("{YT_DLP_RELEASES}/download/{tag}/SHA2-256SUMS"),
    )
    .await?
    .text()
    .await
    .map_err(fail("io.readFailed"))?;
    let expected = expected_sha256(&sums, asset).ok_or_else(missing("download.checksumMissing"))?;

    let mut response = fetch_ok(
        &client,
        &format!("{YT_DLP_RELEASES}/download/{tag}/{asset}"),
    )
    .await?;
    let tmp = TempFile::new(dir.join(format!("yt-dlp-{}.download", uuid::Uuid::new_v4())));
    let mut file = fs::File::create(&tmp.path).map_err(|e| {
        AppError::new("download.createPathFailed")
            .with("path", tmp.path.display())
            .detail(e)
    })?;
    let mut hasher = Sha256::new();
    let mut total: u64 = 0;
    while let Some(chunk) = response.chunk().await.map_err(fail("io.readFailed"))? {
        total += chunk.len() as u64;
        if total > MAX_YT_DLP_SIZE {
            return Err(AppError::new("download.fileTooLargeLimit")
                .with("limit", MAX_YT_DLP_SIZE / (1024 * 1024)));
        }
        hasher.update(&chunk);
        file.write_all(&chunk).map_err(fail("io.writeFailed"))?;
    }
    file.sync_all().map_err(fail("io.writeFailed"))?;
    drop(file);

    let actual = format!("{:x}", hasher.finalize());
    if actual != expected {
        return Err(AppError::new("download.checksumMismatch").detail(actual));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&tmp.path)
            .map_err(fail("download.metadataFailed"))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&tmp.path, perms).map_err(fail("download.chmodFailed"))?;
    }

    let version_check = silent_command(&tmp.path).arg("--version").output();
    let version = match version_check {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).trim().to_string(),
        _ => return Err(AppError::new("download.notExecutable")),
    };

    // A running yt-dlp.exe cannot be replaced, but it can be moved aside.
    #[cfg(target_os = "windows")]
    {
        let old = dir.join("yt-dlp.old");
        let _ = fs::remove_file(&old);
        if target_path.exists() {
            fs::rename(&target_path, &old).map_err(fail("download.replaceBinaryFailed"))?;
        }
        if let Err(e) = fs::rename(&tmp.path, &target_path) {
            let _ = fs::rename(&old, &target_path);
            return Err(AppError::new("download.replaceBinaryFailed").detail(e));
        }
        let _ = fs::remove_file(&old);
    }
    #[cfg(not(target_os = "windows"))]
    fs::rename(&tmp.path, &target_path).map_err(fail("download.replaceBinaryFailed"))?;

    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_are_decoded_as_utf8() {
        assert_eq!(
            parse_content_disposition_filename(
                "attachment; filename*=UTF-8''Caf%C3%A9%20n%C2%B01.mp3"
            ),
            Some("Café n°1.mp3".into())
        );
        assert_eq!(
            parse_content_disposition_filename("attachment; filename=\"My Song.mp3\""),
            Some("My Song.mp3".into())
        );
        assert_eq!(
            parse_content_disposition_filename("attachment; filename=\"../../evil.mp3\""),
            Some("evil.mp3".into())
        );
        assert_eq!(
            filename_from_url("https://x.org/a/My%20Song.mp3?dl=1"),
            Some("My Song.mp3".into())
        );
        assert_eq!(filename_from_url("https://x.org/"), None);
        assert_eq!(percent_decode("100%"), "100%");
    }

    #[test]
    fn only_audio_extensions_are_kept() {
        assert_eq!(audio_extension("a.MP3"), Some(".mp3".into()));
        assert_eq!(audio_extension("a.flac"), Some(".flac".into()));
        assert_eq!(audio_extension("download.php"), None);
        assert_eq!(audio_extension("a:b"), None);
        assert_eq!(audio_extension("track.mp3:evil"), None);
        assert_eq!(audio_extension("noext"), None);
    }

    #[test]
    fn audio_is_recognised_by_its_first_bytes() {
        assert_eq!(sniff_audio(b"ID3\x04\x00"), Some(".mp3"));
        assert_eq!(sniff_audio(&[0xFF, 0xFB, 0x90, 0x00]), Some(".mp3"));
        assert_eq!(sniff_audio(&[0xFF, 0xF1, 0x50, 0x80]), Some(".aac"));
        assert_eq!(sniff_audio(b"OggS\x00\x02"), Some(".ogg"));
        assert_eq!(sniff_audio(b"fLaC\x00"), Some(".flac"));
        assert_eq!(sniff_audio(b"RIFF\x24\x08\x00\x00WAVEfmt "), Some(".wav"));
        assert_eq!(sniff_audio(b"\x00\x00\x00\x20ftypM4A "), Some(".m4a"));
        assert_eq!(sniff_audio(&[0x1A, 0x45, 0xDF, 0xA3, 0x01]), Some(".webm"));
        assert_eq!(sniff_audio(b"<!DOCTYPE html><html>"), None);
        assert_eq!(sniff_audio(b"{\"error\":1}"), None);
        assert_eq!(sniff_audio(b"RIFF\x24\x08\x00\x00AVI "), None);
        assert_eq!(sniff_audio(b""), None);
    }

    #[test]
    fn pages_are_not_audio() {
        assert!(is_textual_content_type("text/html"));
        assert!(is_textual_content_type("application/json"));
        assert!(!is_textual_content_type("audio/mpeg"));
        assert!(!is_textual_content_type("application/octet-stream"));
    }

    #[test]
    fn only_http_urls_are_accepted() {
        assert_eq!(
            validate_http_url(" https://www.youtube.com/watch?v=x ").unwrap(),
            "https://www.youtube.com/watch?v=x"
        );
        assert!(validate_http_url("http://example.com/a.mp3").is_ok());
        for bad in [
            "--exec=touch /tmp/pwned",
            "-o/etc/x",
            "file:///etc/passwd",
            "ftp://example.com/a.mp3",
            "javascript:alert(1)",
            "example.com/a.mp3",
            "",
        ] {
            assert_eq!(
                validate_http_url(bad).unwrap_err().code,
                "download.invalidUrl",
                "{bad:?}"
            );
        }
    }

    #[test]
    fn checksum_is_read_for_the_right_asset() {
        let a = "a".repeat(64);
        let b = "B".repeat(64);
        let sums = format!("{a}  yt-dlp\n{b}  yt-dlp_linux\n{a}  yt-dlp.exe\n");
        assert_eq!(expected_sha256(&sums, "yt-dlp_linux"), Some("b".repeat(64)));
        assert_eq!(expected_sha256(&sums, "yt-dlp_macos"), None);
        assert_eq!(
            expected_sha256(&format!("{b} *yt-dlp.exe"), "yt-dlp.exe"),
            Some("b".repeat(64))
        );
        assert_eq!(
            expected_sha256("nothex  yt-dlp_linux", "yt-dlp_linux"),
            None
        );
    }

    #[test]
    fn only_date_like_tags_are_used() {
        assert!(is_plausible_tag("2025.09.26"));
        assert!(!is_plausible_tag(""));
        assert!(!is_plausible_tag("../../evil"));
        assert!(!is_plausible_tag("2025.09.26?x=1"));
    }
}
