mod archive;
mod cloud;
mod download;
mod file_assoc;
mod show_mode;
mod types;

use std::path::{Path, PathBuf, Component};
use std::process::Command;
use std::fs;

use tauri_plugin_dialog::DialogExt;
use tauri::Emitter;

use crate::types::{AudioFile, Numero, PlaylistItem, Project, VerifyResult, migrate_project};

// ===== Helpers =====

pub(crate) fn safe_filename(filename: &str) -> Result<(), String> {
    let p = Path::new(filename);
    let valid = p.components().all(|c| matches!(c, Component::Normal(_)))
        && p.file_name().map(|n| n == p.as_os_str()).unwrap_or(false);
    if valid { Ok(()) } else { Err("Nom de fichier invalide".into()) }
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

pub(crate) fn default_projects_dir() -> String {
    let base = dirs::document_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Spectacles").to_string_lossy().to_string()
}

pub(crate) fn default_numeros_dir() -> String {
    let base = dirs::document_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Numéros").to_string_lossy().to_string()
}

#[tauri::command]
fn get_default_projects_dir() -> String { default_projects_dir() }

#[tauri::command]
fn get_default_numeros_dir() -> String { default_numeros_dir() }

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

pub(crate) fn open_project_from_file(folder: &Path, filename: &str) -> Result<Project, String> {
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
fn read_audio_file(path: String) -> Result<tauri::ipc::Response, String> {
    let metadata = fs::metadata(&path)
        .map_err(|e| format!("Impossible de lire le fichier : {}", e))?;
    if metadata.len() > download::MAX_AUDIO_FILE_SIZE {
        return Err(format!(
            "Fichier trop volumineux ({} Mo). Limite : {} Mo.",
            metadata.len() / (1024 * 1024),
            download::MAX_AUDIO_FILE_SIZE / (1024 * 1024)
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

pub(crate) fn save_project_to_disk(project: &Project) -> Result<(), String> {
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


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    show_mode::configure_wsl2_audio();

    // Cold start: capture the file passed as CLI argument
    let initial_args: Vec<String> = std::env::args().collect();
    if let Some(file) = file_assoc::extract_file_from_args(&initial_args) {
        file_assoc::set_pending_open_file(file);
    }

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // Hot start: focus existing window + forward file via event
    #[cfg(desktop)]
    {
        use tauri::Manager;
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(file) = file_assoc::extract_file_from_args(&args) {
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
            read_audio_file,
            archive::pick_regieson_file, archive::save_regieson_file,
            archive::pick_regiesonnumero_file, archive::save_regiesonnumero_file,
            archive::export_project, archive::import_project,
            archive::export_numero, archive::import_numero_standalone, archive::import_numero_into_project,
            file_assoc::auto_import_regieson, file_assoc::auto_import_regiesonnumero, file_assoc::take_pending_open_file,
            cloud::share_project_on_cloud, cloud::share_numero_on_cloud,
            cloud::import_project_from_cloud, cloud::import_numero_from_cloud,
            cloud::import_numero_from_cloud_into_project,
            download::download_audio_from_url, download::download_youtube_audio, download::cancel_download,
            download::get_yt_dlp_version, download::update_yt_dlp,
            show_mode::set_show_mode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
