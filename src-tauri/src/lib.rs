use std::path::{Path, PathBuf};
use std::process::Command;
use serde::{Deserialize, Serialize};
use tauri_plugin_dialog::DialogExt;
use std::fs;

// ===== Project types =====

fn default_volume() -> f64 { 100.0 }

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AudioFile {
    pub id: String,
    pub filename: String,
    pub original_name: String,
    #[serde(default = "default_volume")]
    pub volume: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_time: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PauseItem {
    pub id: String,
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
}

fn migrate_project(raw: &str, path: String) -> Result<Project, String> {
    let legacy: LegacyProject = serde_json::from_str(raw)
        .map_err(|e| format!("Fichier projet invalide : {}", e))?;
    let numeros = legacy.numeros.into_iter().map(|n| {
        let items = if !n.items.is_empty() {
            serde_json::from_value(serde_json::Value::Array(n.items)).unwrap_or_default()
        } else {
            n.audio_files.into_iter().map(|af| PlaylistItem::Audio(AudioFile {
                id: af.id,
                filename: af.filename,
                original_name: af.original_name,
                volume: 100.0,
                start_time: None,
                end_time: None,
            })).collect()
        };
        Numero { id: n.id, numero_type: n.numero_type, name: n.name, items }
    }).collect();
    Ok(Project { name: legacy.name, path, numeros })
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
    let project = Project { name, path: project_dir.to_string_lossy().to_string(), numeros: vec![] };
    save_project_to_disk(&project)?;
    Ok(project)
}

#[tauri::command]
fn open_project(project_path: String) -> Result<Project, String> {
    let content = fs::read_to_string(Path::new(&project_path).join("projet.json"))
        .map_err(|e| format!("Impossible de lire le projet : {}", e))?;
    migrate_project(&content, project_path)
}

#[tauri::command]
fn save_project(project: Project) -> Result<(), String> {
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
    Ok(AudioFile { id, filename: new_filename, original_name, volume: 100.0, start_time: None, end_time: None })
}

#[tauri::command]
fn delete_audio_file(project_path: String, filename: String) -> Result<(), String> {
    let path = PathBuf::from(&project_path).join("musiques").join(&filename);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Impossible de supprimer : {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn read_audio_file(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = fs::read(&path).map_err(|e| format!("Impossible de lire le fichier : {}", e))?;
    Ok(tauri::ipc::Response::new(bytes))
}

fn save_project_to_disk(project: &Project) -> Result<(), String> {
    let content = serde_json::to_string_pretty(project)
        .map_err(|e| format!("Erreur de sérialisation : {}", e))?;
    fs::write(Path::new(&project.path).join("projet.json"), content)
        .map_err(|e| format!("Impossible de sauvegarder : {}", e))?;
    Ok(())
}

// ===== Entry point =====

fn configure_wsl2_audio() {
    if !fs::read_to_string("/proc/version").unwrap_or_default().to_lowercase().contains("microsoft") {
        return;
    }
    std::env::set_var("PULSE_LATENCY_MSEC", "500");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure_wsl2_audio();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            get_default_projects_dir,
            pick_folder, pick_audio_files,
            create_project, open_project, save_project,
            copy_audio_file, delete_audio_file,
            read_audio_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
