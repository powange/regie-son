mod types;
mod download;
mod show_mode;

use std::path::{Path, PathBuf, Component};
use std::process::Command;
use std::fs;
use std::sync::{Mutex, OnceLock};

use tauri_plugin_dialog::DialogExt;
use tauri::Emitter;

use crate::types::{AudioFile, Numero, PlaylistItem, Project, VerifyResult, migrate_project};

// ===== Helpers =====

fn safe_filename(filename: &str) -> Result<(), String> {
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
    show_mode::configure_wsl2_audio();

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
            read_audio_file,
            download::download_audio_from_url, download::download_youtube_audio, download::cancel_download,
            show_mode::set_show_mode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
