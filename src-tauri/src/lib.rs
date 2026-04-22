use std::path::{Path, PathBuf, Component};
use std::process::Command;
use serde::{Deserialize, Serialize};
use tauri_plugin_dialog::DialogExt;
use tauri::Emitter;
use std::fs;

// ===== Helpers =====

fn safe_filename(filename: &str) -> Result<(), String> {
    let p = Path::new(filename);
    let valid = p.components().all(|c| matches!(c, Component::Normal(_)))
        && p.file_name().map(|n| n == p.as_os_str()).unwrap_or(false);
    if valid { Ok(()) } else { Err("Nom de fichier invalide".into()) }
}

fn parse_content_disposition_filename(disposition: &str) -> Option<String> {
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

// ===== Project types =====

fn default_volume() -> f64 { 100.0 }

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AudioFile {
    pub id: String,
    pub filename: String,
    pub original_name: String,
    #[serde(default = "default_volume")]
    pub volume: f64,
    #[serde(skip_serializing_if = "Option::is_none", rename = "startTime")]
    pub start_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "endTime")]
    pub end_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "fadeIn")]
    pub fade_in: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "fadeOut")]
    pub fade_out: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "note")]
    pub cue: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PauseItem {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none", alias = "note")]
    pub cue: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum PlaylistItem {
    Audio(AudioFile),
    Pause(PauseItem),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Numero {
    pub id: String,
    #[serde(rename = "type")]
    pub numero_type: String,
    pub name: String,
    pub items: Vec<PlaylistItem>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub name: String,
    pub path: String,
    pub numeros: Vec<Numero>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "singleNumero")]
    pub single_numero: Option<bool>,
}

// ===== Legacy format migration =====

#[derive(Deserialize)]
struct LegacyAudioFile {
    id: String,
    filename: String,
    original_name: String,
}

#[derive(Deserialize)]
struct LegacyNumero {
    id: String,
    #[serde(rename = "type")]
    numero_type: String,
    name: String,
    #[serde(default)]
    audio_files: Vec<LegacyAudioFile>,
    #[serde(default)]
    items: Vec<serde_json::Value>,
}

#[derive(Deserialize)]
struct LegacyProject {
    name: String,
    numeros: Vec<LegacyNumero>,
    #[serde(default, rename = "singleNumero")]
    single_numero: Option<bool>,
}

fn migrate_project(raw: &str, path: String) -> Result<Project, String> {
    let legacy: LegacyProject = serde_json::from_str(raw)
        .map_err(|e| format!("Fichier projet invalide : {}", e))?;
    let numeros: Result<Vec<Numero>, String> = legacy.numeros.into_iter().map(|n| {
        let items: Vec<PlaylistItem> = if !n.items.is_empty() {
            serde_json::from_value(serde_json::Value::Array(n.items))
                .map_err(|e| format!("Items invalides pour « {} » : {}", n.name, e))?
        } else {
            n.audio_files.into_iter().map(|af| PlaylistItem::Audio(AudioFile {
                id: af.id,
                filename: af.filename,
                original_name: af.original_name,
                volume: 100.0,
                start_time: None,
                end_time: None,
                fade_in: None,
                fade_out: None,
                cue: None,
            })).collect()
        };
        Ok(Numero { id: n.id, numero_type: n.numero_type, name: n.name, items })
    }).collect();
    Ok(Project { name: legacy.name, path, numeros: numeros?, single_numero: legacy.single_numero })
}

// ===== File system helpers =====

fn pick_folder_zenity() -> Option<String> {
    let out = Command::new("zenity")
        .args(["--file-selection", "--directory", "--title", "Choisir un dossier"])
        .output().ok()?;
    if out.status.success() {
        let path = String::from_utf8(out.stdout).ok()?.trim().to_string();
        if path.is_empty() { None } else { Some(path) }
    } else { None }
}

fn pick_audio_files_zenity() -> Vec<String> {
    let out = match Command::new("zenity")
        .args([
            "--file-selection", "--multiple",
            "--title", "Choisir des fichiers audio",
            "--file-filter", "Fichiers audio (mp3, ogg, wav...) | *.mp3 *.ogg *.wav *.flac *.aac *.m4a *.wma *.opus",
            "--separator", "|",
        ])
        .output()
    {
        Ok(o) => o,
        Err(_) => return vec![],
    };
    if !out.status.success() { return vec![]; }
    let raw = String::from_utf8(out.stdout).unwrap_or_default();
    raw.trim().split('|').filter(|s| !s.is_empty()).map(|s| s.to_string()).collect()
}

#[tauri::command]
fn get_default_projects_dir() -> String {
    let base = dirs::document_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Spectacles").to_string_lossy().to_string()
}

#[tauri::command]
fn get_default_numeros_dir() -> String {
    let base = dirs::document_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Numéros").to_string_lossy().to_string()
}

#[tauri::command]
fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    if Command::new("which").arg("zenity").output().map(|o| o.status.success()).unwrap_or(false) {
        return Ok(pick_folder_zenity());
    }
    let result = app.dialog().file().blocking_pick_folder();
    Ok(result.map(|p| p.to_string()))
}

#[tauri::command]
fn pick_audio_files(app: tauri::AppHandle) -> Vec<String> {
    if Command::new("which").arg("zenity").output().map(|o| o.status.success()).unwrap_or(false) {
        return pick_audio_files_zenity();
    }
    let files = app.dialog()
        .file()
        .add_filter("Audio", &["mp3", "ogg", "wav", "flac", "aac", "m4a", "wma", "opus"])
        .blocking_pick_files();
    match files {
        Some(paths) => paths.iter().map(|p| p.to_string()).collect(),
        None => vec![],
    }
}

// ===== Project commands =====

#[tauri::command]
fn create_project(name: String, folder_path: String) -> Result<Project, String> {
    let project_dir = PathBuf::from(&folder_path);
    fs::create_dir_all(project_dir.join("musiques"))
        .map_err(|e| format!("Impossible de créer le dossier : {}", e))?;
    let project = Project {
        name,
        path: project_dir.to_string_lossy().to_string(),
        numeros: vec![],
        single_numero: None,
    };
    save_project_to_disk(&project)?;
    Ok(project)
}

fn open_project_from_file(folder: &Path, filename: &str) -> Result<Project, String> {
    let content = fs::read_to_string(folder.join(filename))
        .map_err(|e| format!("Impossible de lire le projet : {}", e))?;
    migrate_project(&content, folder.to_string_lossy().to_string())
}

#[tauri::command]
fn open_project(project_path: String) -> Result<Project, String> {
    open_project_from_file(Path::new(&project_path), "projet.json")
}

#[tauri::command]
fn save_project(project: Project) -> Result<(), String> {
    save_project_to_disk(&project)
}

#[tauri::command]
fn create_numero(name: String, folder_path: String) -> Result<Project, String> {
    let numero_dir = PathBuf::from(&folder_path);
    fs::create_dir_all(numero_dir.join("musiques"))
        .map_err(|e| format!("Impossible de créer le dossier : {}", e))?;
    let numero = Numero {
        id: uuid::Uuid::new_v4().to_string(),
        numero_type: "numero".into(),
        name: name.clone(),
        items: vec![],
    };
    let project = Project {
        name,
        path: numero_dir.to_string_lossy().to_string(),
        numeros: vec![numero],
        single_numero: Some(true),
    };
    save_project_to_disk(&project)?;
    Ok(project)
}

#[tauri::command]
fn open_numero(numero_path: String) -> Result<Project, String> {
    open_project_from_file(Path::new(&numero_path), "numero.json")
}

#[tauri::command]
fn save_numero(project: Project) -> Result<(), String> {
    save_project_to_disk(&project)
}

#[tauri::command]
fn copy_audio_file(src_path: String, project_path: String) -> Result<AudioFile, String> {
    let src = Path::new(&src_path);
    let original_name = src.file_name().ok_or("Nom de fichier invalide")?
        .to_string_lossy().to_string();
    let ext = src.extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let id = uuid::Uuid::new_v4().to_string();
    let new_filename = format!("{}{}", id, ext);
    let dest = PathBuf::from(&project_path).join("musiques").join(&new_filename);
    fs::copy(src, &dest)
        .map_err(|e| format!("Impossible de copier le fichier : {}", e))?;
    Ok(AudioFile { id, filename: new_filename, original_name, volume: 100.0, start_time: None, end_time: None, fade_in: None, fade_out: None, cue: None })
}

#[tauri::command]
fn delete_audio_file(project_path: String, filename: String) -> Result<(), String> {
    safe_filename(&filename)?;
    let path = PathBuf::from(&project_path).join("musiques").join(&filename);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Impossible de supprimer : {}", e))?;
    }
    Ok(())
}

#[derive(Serialize)]
pub struct VerifyResult {
    missing: Vec<String>,
    orphans: Vec<String>,
}

#[tauri::command]
fn verify_project(project: Project) -> Result<VerifyResult, String> {
    let musiques_dir = PathBuf::from(&project.path).join("musiques");
    let mut referenced: std::collections::HashSet<String> = std::collections::HashSet::new();
    for n in &project.numeros {
        for item in &n.items {
            if let PlaylistItem::Audio(a) = item {
                referenced.insert(a.filename.clone());
            }
        }
    }
    let mut missing: Vec<String> = referenced.iter()
        .filter(|f| !musiques_dir.join(f).exists())
        .cloned().collect();
    missing.sort();

    let mut orphans: Vec<String> = Vec::new();
    if let Ok(entries) = fs::read_dir(&musiques_dir) {
        for e in entries.filter_map(|e| e.ok()) {
            if !e.file_type().map(|t| t.is_file()).unwrap_or(false) { continue; }
            let name = e.file_name().to_string_lossy().to_string();
            if !referenced.contains(&name) { orphans.push(name); }
        }
    }
    orphans.sort();
    Ok(VerifyResult { missing, orphans })
}

#[tauri::command]
fn cleanup_orphan_files(project_path: String, filenames: Vec<String>) -> Result<u32, String> {
    let musiques_dir = PathBuf::from(&project_path).join("musiques");
    let mut deleted = 0u32;
    for name in filenames {
        if safe_filename(&name).is_err() { continue; }
        let p = musiques_dir.join(&name);
        if p.exists() && fs::remove_file(&p).is_ok() { deleted += 1; }
    }
    Ok(deleted)
}

#[tauri::command]
fn pick_regieson_file(app: tauri::AppHandle) -> Option<String> {
    app.dialog().file()
        .add_filter("Régie Son", &["regieson"])
        .blocking_pick_file()
        .map(|p| p.to_string())
}

#[tauri::command]
fn save_regieson_file(app: tauri::AppHandle, default_name: String) -> Option<String> {
    app.dialog().file()
        .add_filter("Régie Son", &["regieson"])
        .set_file_name(&format!("{}.regieson", default_name))
        .blocking_save_file()
        .map(|p| p.to_string())
}

#[tauri::command]
fn pick_regiesonnumero_file(app: tauri::AppHandle) -> Option<String> {
    app.dialog().file()
        .add_filter("Numéro Régie Son", &["regiesonnumero"])
        .blocking_pick_file()
        .map(|p| p.to_string())
}

#[tauri::command]
fn save_regiesonnumero_file(app: tauri::AppHandle, default_name: String) -> Option<String> {
    app.dialog().file()
        .add_filter("Numéro Régie Son", &["regiesonnumero"])
        .set_file_name(&format!("{}.regiesonnumero", default_name))
        .blocking_save_file()
        .map(|p| p.to_string())
}

fn export_to_zip(src_path: &Path, dest_file: &str, json_filename: &str) -> Result<(), String> {
    use std::io::Write;
    let file = fs::File::create(dest_file)
        .map_err(|e| format!("Impossible de créer l'archive : {}", e))?;
    let mut zip = zip::ZipWriter::new(file);
    let options: zip::write::FileOptions<()> = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let json_path = src_path.join(json_filename);
    if !json_path.exists() {
        return Err(format!("Fichier {} introuvable", json_filename));
    }
    let content = fs::read(&json_path).map_err(|e| format!("Lecture {} : {}", json_filename, e))?;
    zip.start_file(json_filename, options).map_err(|e| format!("Zip : {}", e))?;
    zip.write_all(&content).map_err(|e| format!("Écriture : {}", e))?;

    let musiques_dir = src_path.join("musiques");
    if musiques_dir.exists() {
        let entries = fs::read_dir(&musiques_dir).map_err(|e| format!("Lecture dossier : {}", e))?;
        for entry in entries.filter_map(|e| e.ok()) {
            if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) { continue; }
            let name = entry.file_name().to_string_lossy().to_string();
            let content = fs::read(entry.path()).map_err(|e| format!("Lecture {} : {}", name, e))?;
            zip.start_file(format!("musiques/{}", name), options).map_err(|e| format!("Zip : {}", e))?;
            zip.write_all(&content).map_err(|e| format!("Écriture : {}", e))?;
        }
    }

    zip.finish().map_err(|e| format!("Finalisation de l'archive : {}", e))?;
    Ok(())
}

#[tauri::command]
fn export_project(project_path: String, dest_file: String) -> Result<(), String> {
    export_to_zip(Path::new(&project_path), &dest_file, "projet.json")
}

#[tauri::command]
fn export_numero(numero_path: String, dest_file: String) -> Result<(), String> {
    export_to_zip(Path::new(&numero_path), &dest_file, "numero.json")
}

fn extract_zip_to(src_file: &str, dest_folder: &Path) -> Result<(), String> {
    fs::create_dir_all(dest_folder).map_err(|e| format!("Création du dossier : {}", e))?;

    let file = fs::File::open(src_file).map_err(|e| format!("Ouverture de l'archive : {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Archive invalide : {}", e))?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("Lecture entrée : {}", e))?;
        let name = entry.name().to_string();
        if name.contains("..") || name.starts_with('/') || name.starts_with('\\') {
            return Err(format!("Chemin invalide dans l'archive : {}", name));
        }
        let out_path = dest_folder.join(&name);
        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| format!("mkdir : {}", e))?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("mkdir : {}", e))?;
            }
            let mut out = fs::File::create(&out_path).map_err(|e| format!("Création : {}", e))?;
            std::io::copy(&mut entry, &mut out).map_err(|e| format!("Extraction : {}", e))?;
        }
    }
    Ok(())
}

#[tauri::command]
fn import_project(src_file: String, dest_folder: String) -> Result<Project, String> {
    let dest = PathBuf::from(&dest_folder);
    extract_zip_to(&src_file, &dest)?;
    open_project_from_file(&dest, "projet.json")
        .map_err(|e| format!("Archive invalide : {}", e))
}

#[tauri::command]
fn import_numero_standalone(src_file: String, dest_folder: String) -> Result<Project, String> {
    let dest = PathBuf::from(&dest_folder);
    extract_zip_to(&src_file, &dest)?;
    let mut project = open_project_from_file(&dest, "numero.json")
        .map_err(|e| format!("Archive invalide : {}", e))?;
    // Ensure flag is preserved even if archive came without it.
    project.single_numero = Some(true);
    save_project_to_disk(&project)?;
    Ok(project)
}

#[tauri::command]
fn import_numero_into_project(src_file: String, project_path: String) -> Result<Project, String> {
    use std::io::Read;

    // 1. Open target project
    let mut project = open_project_from_file(Path::new(&project_path), "projet.json")
        .map_err(|e| format!("Projet cible invalide : {}", e))?;

    // 2. Read the archive
    let file = fs::File::open(&src_file).map_err(|e| format!("Ouverture de l'archive : {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Archive invalide : {}", e))?;

    // 3. Read numero.json from archive
    let raw_numero_json = {
        let mut entry = archive.by_name("numero.json")
            .map_err(|_| "Archive invalide : numero.json manquant".to_string())?;
        let mut s = String::new();
        entry.read_to_string(&mut s).map_err(|e| format!("Lecture numero.json : {}", e))?;
        s
    };

    // 4. Parse it as a Project (reuse migrate_project to handle item shapes)
    let src_project = migrate_project(&raw_numero_json, String::new())?;
    let mut numero = src_project.numeros.into_iter().next()
        .ok_or("Archive invalide : aucun numéro")?;

    // 5. For each audio item, copy its file to project_path/musiques with a new UUID
    let dest_musiques = PathBuf::from(&project_path).join("musiques");
    fs::create_dir_all(&dest_musiques).map_err(|e| format!("mkdir musiques : {}", e))?;

    for item in numero.items.iter_mut() {
        if let PlaylistItem::Audio(audio) = item {
            safe_filename(&audio.filename)?;
            let archive_path = format!("musiques/{}", audio.filename);
            let mut entry = archive.by_name(&archive_path)
                .map_err(|_| format!("Fichier manquant dans l'archive : {}", audio.filename))?;
            let ext = Path::new(&audio.filename).extension()
                .map(|e| format!(".{}", e.to_string_lossy()))
                .unwrap_or_default();
            let new_id = uuid::Uuid::new_v4().to_string();
            let new_filename = format!("{}{}", new_id, ext);
            let out_path = dest_musiques.join(&new_filename);
            let mut out = fs::File::create(&out_path)
                .map_err(|e| format!("Création {} : {}", new_filename, e))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("Extraction {} : {}", new_filename, e))?;
            audio.id = new_id;
            audio.filename = new_filename;
        } else if let PlaylistItem::Pause(pause) = item {
            pause.id = uuid::Uuid::new_v4().to_string();
        }
    }

    // 6. Give numero a fresh id, force type = "numero", append to project
    numero.id = uuid::Uuid::new_v4().to_string();
    numero.numero_type = "numero".into();
    project.numeros.push(numero);

    // 7. Save and return
    save_project_to_disk(&project)?;
    Ok(project)
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

fn find_yt_dlp() -> PathBuf {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            #[cfg(target_os = "windows")]
            let candidate = exe_dir.join("yt-dlp.exe");
            #[cfg(not(target_os = "windows"))]
            let candidate = exe_dir.join("yt-dlp");
            if candidate.exists() {
                return candidate;
            }
        }
    }
    PathBuf::from("yt-dlp")
}

// ===== Cancellation =====

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::Notify;

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
fn cancel_download(id: String) {
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
async fn download_youtube_audio(url: String, project_path: String, download_id: String, app: tauri::AppHandle) -> Result<AudioFile, String> {
    let guard = DownloadGuard::new(download_id);
    let yt_dlp = find_yt_dlp();

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
async fn download_audio_from_url(url: String, project_path: String, download_id: String) -> Result<AudioFile, String> {
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

const MAX_AUDIO_FILE_SIZE: u64 = 500 * 1024 * 1024; // 500 MB

#[tauri::command]
fn read_audio_file(path: String) -> Result<tauri::ipc::Response, String> {
    let metadata = fs::metadata(&path)
        .map_err(|e| format!("Impossible de lire le fichier : {}", e))?;
    if metadata.len() > MAX_AUDIO_FILE_SIZE {
        return Err(format!(
            "Fichier trop volumineux ({} Mo). Limite : {} Mo.",
            metadata.len() / (1024 * 1024),
            MAX_AUDIO_FILE_SIZE / (1024 * 1024)
        ));
    }
    let bytes = fs::read(&path).map_err(|e| format!("Impossible de lire le fichier : {}", e))?;
    Ok(tauri::ipc::Response::new(bytes))
}

fn project_json_filename(project: &Project) -> &'static str {
    if project.single_numero.unwrap_or(false) { "numero.json" } else { "projet.json" }
}

fn rotate_backups(dir: &Path, filename: &str) {
    let bak = |n: u8| dir.join(format!("{}.bak{}", filename, n));
    let _ = fs::remove_file(bak(3));
    let _ = fs::rename(bak(2), bak(3));
    let _ = fs::rename(bak(1), bak(2));
    let current = dir.join(filename);
    if current.exists() {
        let _ = fs::rename(&current, bak(1));
    }
}

fn save_project_to_disk(project: &Project) -> Result<(), String> {
    let content = serde_json::to_string_pretty(project)
        .map_err(|e| format!("Erreur de sérialisation : {}", e))?;
    let dir = Path::new(&project.path);
    let filename = project_json_filename(project);
    let target = dir.join(filename);
    let tmp = dir.join(format!("{}.tmp", filename));
    fs::write(&tmp, &content)
        .map_err(|e| format!("Impossible de sauvegarder : {}", e))?;
    rotate_backups(dir, filename);
    fs::rename(&tmp, &target)
        .map_err(|e| format!("Impossible de sauvegarder : {}", e))?;
    Ok(())
}

// ===== Show mode =====

#[tauri::command]
fn set_show_mode(active: bool) -> Result<(), String> {
    set_show_mode_impl(active)
}

#[cfg(target_os = "windows")]
fn set_show_mode_impl(active: bool) -> Result<(), String> {
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IAudioSessionControl2, IAudioSessionManager2,
        IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };
    use windows::core::Interface;

    unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let should_uninit = hr.is_ok();

        let result = (|| -> Result<(), String> {
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("CoCreateInstance : {}", e))?;

            let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)
                .map_err(|e| format!("GetDefaultAudioEndpoint : {}", e))?;

            let session_mgr: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("Activate IAudioSessionManager2 : {}", e))?;

            let session_enum = session_mgr.GetSessionEnumerator()
                .map_err(|e| format!("GetSessionEnumerator : {}", e))?;

            let count = session_enum.GetCount()
                .map_err(|e| format!("GetCount : {}", e))?;

            let mut muted_any = false;
            for i in 0..count {
                let ctrl = match session_enum.GetSession(i) {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                let ctrl2: IAudioSessionControl2 = match ctrl.cast() {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                let pid = ctrl2.GetProcessId().unwrap_or(u32::MAX);
                if pid == 0 {
                    let vol: ISimpleAudioVolume = match ctrl2.cast() {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    vol.SetMute(active, std::ptr::null())
                        .map_err(|e| format!("SetMute : {}", e))?;
                    muted_any = true;
                }
            }

            if !muted_any {
                return Err("Session SystemSounds introuvable. Produisez un son système (ex : notification) puis réessayez.".into());
            }
            Ok(())
        })();

        if should_uninit {
            CoUninitialize();
        }

        result
    }
}

#[cfg(target_os = "macos")]
fn set_show_mode_impl(active: bool) -> Result<(), String> {
    // Essayer AppleScript (macOS ≤ 12)
    let value = if active { "true" } else { "false" };
    let script = format!("tell application \"System Events\" to set Do Not Disturb to {}", value);
    if let Ok(out) = Command::new("osascript").args(["-e", &script]).output() {
        if out.status.success() { return Ok(()); }
    }
    // Fallback defaults + redémarrage NotificationCenter (macOS 12+)
    let bool_val = if active { "YES" } else { "NO" };
    let out = Command::new("defaults")
        .args(["-currentHost", "write", "com.apple.notificationcenterui", "doNotDisturb", "-boolean", bool_val])
        .output()
        .map_err(|e| format!("Erreur : {}", e))?;
    if out.status.success() {
        let _ = Command::new("killall").arg("NotificationCenter").output();
        Ok(())
    } else {
        Err("Activez manuellement le mode Ne pas déranger dans Réglages Système > Notifications.".into())
    }
}

#[cfg(target_os = "linux")]
fn set_show_mode_impl(active: bool) -> Result<(), String> {
    // GNOME : inverser show-banners (false = muet)
    let value = if active { "false" } else { "true" };
    let out = Command::new("gsettings")
        .args(["set", "org.gnome.desktop.notifications", "show-banners", value])
        .output()
        .map_err(|_| "gsettings non disponible. Activez manuellement le mode Ne pas déranger.".to_string())?;
    if out.status.success() { Ok(()) } else {
        Err("Impossible de modifier les notifications GNOME. Activez manuellement le mode Ne pas déranger.".into())
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn set_show_mode_impl(_active: bool) -> Result<(), String> {
    Err("Mode spectacle non supporté sur cet OS.".into())
}

// ===== Entry point =====

fn configure_wsl2_audio() {
    if !fs::read_to_string("/proc/version").unwrap_or_default().to_lowercase().contains("microsoft") {
        return;
    }
    std::env::set_var("PULSE_LATENCY_MSEC", "500");
}

// ===== File association handling =====

fn pending_open_file() -> &'static Mutex<Option<String>> {
    static PENDING: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(None))
}

fn extract_file_from_args(args: &[String]) -> Option<String> {
    args.iter().skip(1).find(|a| {
        let lower = a.to_lowercase();
        lower.ends_with(".regieson") || lower.ends_with(".regiesonnumero")
    }).cloned()
}

#[tauri::command]
fn take_pending_open_file() -> Option<String> {
    pending_open_file().lock().unwrap().take()
}

fn pick_unique_path(base: &Path) -> PathBuf {
    if !base.exists() { return base.to_path_buf(); }
    let parent = base.parent().unwrap_or(Path::new("."));
    let name = base.file_name().unwrap_or_default().to_string_lossy().to_string();
    for i in 2..1000 {
        let candidate = parent.join(format!("{}-{}", name, i));
        if !candidate.exists() { return candidate; }
    }
    parent.join(format!("{}-{}", name, std::process::id()))
}

#[tauri::command]
fn auto_import_regieson(src_file: String) -> Result<Project, String> {
    let archive_name = Path::new(&src_file).file_stem()
        .ok_or("Nom de fichier invalide")?
        .to_string_lossy().to_string();
    let base_dir = PathBuf::from(get_default_projects_dir()).join(&archive_name);
    let dest = pick_unique_path(&base_dir);
    import_project(src_file, dest.to_string_lossy().to_string())
}

#[tauri::command]
fn auto_import_regiesonnumero(src_file: String) -> Result<Project, String> {
    let archive_name = Path::new(&src_file).file_stem()
        .ok_or("Nom de fichier invalide")?
        .to_string_lossy().to_string();
    let base_dir = PathBuf::from(get_default_numeros_dir()).join(&archive_name);
    let dest = pick_unique_path(&base_dir);
    import_numero_standalone(src_file, dest.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure_wsl2_audio();

    // Cold start: capture the file passed as CLI argument
    let initial_args: Vec<String> = std::env::args().collect();
    if let Some(file) = extract_file_from_args(&initial_args) {
        *pending_open_file().lock().unwrap() = Some(file);
    }

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // Hot start: focus existing window + forward file via event
    #[cfg(desktop)]
    {
        use tauri::Manager;
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(file) = extract_file_from_args(&args) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                    let _ = window.emit("open-file", file);
                }
            }
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            get_default_projects_dir, get_default_numeros_dir,
            pick_folder, pick_audio_files,
            create_project, open_project, save_project,
            create_numero, open_numero, save_numero,
            copy_audio_file, delete_audio_file,
            verify_project, cleanup_orphan_files,
            pick_regieson_file, save_regieson_file,
            pick_regiesonnumero_file, save_regiesonnumero_file,
            export_project, import_project,
            export_numero, import_numero_standalone, import_numero_into_project,
            auto_import_regieson, auto_import_regiesonnumero, take_pending_open_file,
            read_audio_file, download_audio_from_url, download_youtube_audio,
            set_show_mode,
            cancel_download,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
