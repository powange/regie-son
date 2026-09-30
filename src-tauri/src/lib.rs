mod archive;
mod audio_session;
mod battery;
mod cloud;
mod download;
mod error;
mod file_assoc;
mod show_mode;
mod sleep_guard;
mod types;

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use tauri_plugin_dialog::DialogExt;

use crate::error::{fail, missing, AppError, AppResult};
use crate::types::{migrate_project, AudioFile, Numero, PlaylistItem, Project, VerifyResult};

// ===== Helpers =====

pub(crate) fn safe_filename(filename: &str) -> AppResult<()> {
    let p = Path::new(filename);
    let valid = p.components().all(|c| matches!(c, Component::Normal(_)))
        && p.file_name().map(|n| n == p.as_os_str()).unwrap_or(false);
    if valid {
        Ok(())
    } else {
        Err(AppError::new("io.invalidFilename"))
    }
}

// ===== Asset protocol scope =====

// The asset protocol starts with an empty scope (tauri.conf.json). The player
// and the duration probe stream `<project>/musiques/<file>` through it, so
// every project or act handed to the frontend must go through
// grant_audio_access, or nothing plays. Today that is open_project_from_file
// (open, import, auto-import, cloud import) and the two create commands; the
// tests below check each of them. Only musiques/ is granted, never the
// project folder: a path forged by the webview can at worst expose audio.
static ASSET_SCOPE: OnceLock<tauri::scope::fs::Scope> = OnceLock::new();

#[cfg(test)]
thread_local! {
    static GRANTED: std::cell::RefCell<Vec<PathBuf>> = const { std::cell::RefCell::new(Vec::new()) };
}

#[cfg(test)]
pub(crate) fn take_granted() -> Vec<PathBuf> {
    GRANTED.with(|g| g.borrow_mut().drain(..).collect())
}

pub(crate) fn grant_audio_access(project_dir: &Path) {
    let musiques = project_dir.join("musiques");
    #[cfg(test)]
    GRANTED.with(|g| g.borrow_mut().push(musiques.clone()));
    if let Some(scope) = ASSET_SCOPE.get() {
        let _ = scope.allow_directory(&musiques, false);
    }
}

// read_audio_file takes a path from the webview: it must name a file directly
// inside a musiques/ folder the asset scope allows, symlinks resolved.
fn check_audio_path(path: &Path, allowed: impl Fn(&Path) -> bool) -> AppResult<()> {
    let in_musiques = path
        .parent()
        .and_then(|p| p.file_name())
        .is_some_and(|n| n == "musiques");
    let named = path
        .file_name()
        .is_some_and(|n| safe_filename(&n.to_string_lossy()).is_ok());
    if in_musiques && named && allowed(path) {
        Ok(())
    } else {
        Err(AppError::new("io.pathNotAllowed"))
    }
}

// ===== File system helpers =====

fn pick_folder_zenity() -> Option<String> {
    let out = Command::new("zenity")
        .args([
            "--file-selection",
            "--directory",
            "--title",
            "Choisir un dossier",
        ])
        .output()
        .ok()?;
    if out.status.success() {
        let path = String::from_utf8(out.stdout).ok()?.trim().to_string();
        if path.is_empty() {
            None
        } else {
            Some(path)
        }
    } else {
        None
    }
}

fn pick_audio_files_zenity() -> Vec<String> {
    let out = match Command::new("zenity")
        .args([
            "--file-selection",
            "--multiple",
            "--title",
            "Choisir des fichiers audio",
            "--file-filter",
            "Fichiers audio (mp3, ogg, wav...) | *.mp3 *.ogg *.wav *.flac *.aac *.m4a *.wma *.opus",
            "--separator",
            "|",
        ])
        .output()
    {
        Ok(o) => o,
        Err(_) => return vec![],
    };
    if !out.status.success() {
        return vec![];
    }
    let raw = String::from_utf8(out.stdout).unwrap_or_default();
    raw.trim()
        .split('|')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
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
fn get_default_projects_dir() -> String {
    default_projects_dir()
}

#[tauri::command]
fn get_default_numeros_dir() -> String {
    default_numeros_dir()
}

#[tauri::command(async)]
fn pick_folder(app: tauri::AppHandle) -> AppResult<Option<String>> {
    if Command::new("which")
        .arg("zenity")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        return Ok(pick_folder_zenity());
    }
    let result = app.dialog().file().blocking_pick_folder();
    Ok(result.map(|p| p.to_string()))
}

#[tauri::command(async)]
fn pick_audio_files(app: tauri::AppHandle) -> Vec<String> {
    if Command::new("which")
        .arg("zenity")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        return pick_audio_files_zenity();
    }
    let files = app
        .dialog()
        .file()
        .add_filter(
            "Audio",
            &["mp3", "ogg", "wav", "flac", "aac", "m4a", "wma", "opus"],
        )
        .blocking_pick_files();
    match files {
        Some(paths) => paths.iter().map(|p| p.to_string()).collect(),
        None => vec![],
    }
}

// ===== Project commands =====

// Creating or importing into a folder that already holds a show or an act
// would overwrite it. Both kinds are checked: they would share musiques/ and
// cleaning one's orphans would delete the other's audio.
pub(crate) fn ensure_no_project(dir: &Path) -> AppResult<()> {
    let taken = ["projet.json", "numero.json"]
        .iter()
        .any(|f| dir.join(f).exists() || dir.join(format!("{}.bak1", f)).exists());
    if taken {
        return Err(AppError::new("project.alreadyExists").with("path", dir.display()));
    }
    Ok(())
}

#[tauri::command]
fn create_project(name: String, folder_path: String) -> AppResult<Project> {
    let project_dir = PathBuf::from(&folder_path);
    ensure_no_project(&project_dir)?;
    fs::create_dir_all(project_dir.join("musiques")).map_err(fail("io.createDirFailed"))?;
    let project = Project {
        name,
        path: project_dir.to_string_lossy().to_string(),
        numeros: vec![],
        single_numero: None,
    };
    save_project_to_disk(&project)?;
    grant_audio_access(&project_dir);
    Ok(project)
}

fn read_project_file(folder: &Path, filename: &str) -> AppResult<Project> {
    let content =
        fs::read_to_string(folder.join(filename)).map_err(fail("io.readProjectFailed"))?;
    migrate_project(&content, folder.to_string_lossy().to_string())
}

// A missing or unparsable file falls back to the most recent backup, so an
// interrupted save never loses the show. The original error wins if the
// backup is no better.
pub(crate) fn open_project_from_file(folder: &Path, filename: &str) -> AppResult<Project> {
    let project = read_project_file(folder, filename)
        .or_else(|err| read_project_file(folder, &format!("{}.bak1", filename)).map_err(|_| err))?;
    grant_audio_access(folder);
    Ok(project)
}

#[tauri::command]
fn open_project(project_path: String) -> AppResult<Project> {
    open_project_from_file(Path::new(&project_path), "projet.json")
}

#[tauri::command]
fn save_project(project: Project) -> AppResult<()> {
    save_project_to_disk(&project)
}

#[tauri::command]
fn create_numero(name: String, folder_path: String) -> AppResult<Project> {
    let numero_dir = PathBuf::from(&folder_path);
    ensure_no_project(&numero_dir)?;
    fs::create_dir_all(numero_dir.join("musiques")).map_err(fail("io.createDirFailed"))?;
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
    grant_audio_access(&numero_dir);
    Ok(project)
}

#[tauri::command]
fn open_numero(numero_path: String) -> AppResult<Project> {
    open_project_from_file(Path::new(&numero_path), "numero.json")
}

#[tauri::command]
fn save_numero(project: Project) -> AppResult<()> {
    save_project_to_disk(&project)
}

#[tauri::command(async)]
fn copy_audio_file(src_path: String, project_path: String) -> AppResult<AudioFile> {
    let src = Path::new(&src_path);
    let original_name = src
        .file_name()
        .ok_or_else(missing("io.invalidFilename"))?
        .to_string_lossy()
        .to_string();
    let ext = src
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let id = uuid::Uuid::new_v4().to_string();
    let new_filename = format!("{}{}", id, ext);
    let dest = PathBuf::from(&project_path)
        .join("musiques")
        .join(&new_filename);
    fs::copy(src, &dest).map_err(fail("io.copyFailed"))?;
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
fn delete_audio_file(project_path: String, filename: String) -> AppResult<()> {
    safe_filename(&filename)?;
    let path = PathBuf::from(&project_path)
        .join("musiques")
        .join(&filename);
    if path.exists() {
        fs::remove_file(&path).map_err(fail("io.deleteFailed"))?;
    }
    Ok(())
}

#[tauri::command(async)]
fn verify_project(project: Project) -> AppResult<VerifyResult> {
    let musiques_dir = PathBuf::from(&project.path).join("musiques");
    let mut referenced: std::collections::HashSet<String> = std::collections::HashSet::new();
    for n in &project.numeros {
        for item in &n.items {
            if let PlaylistItem::Audio(a) = item {
                referenced.insert(a.filename.clone());
            }
        }
    }
    let mut missing: Vec<String> = referenced
        .iter()
        .filter(|f| !musiques_dir.join(f).exists())
        .cloned()
        .collect();
    missing.sort();

    let mut orphans: Vec<String> = Vec::new();
    if let Ok(entries) = fs::read_dir(&musiques_dir) {
        for e in entries.filter_map(|e| e.ok()) {
            if !e.file_type().map(|t| t.is_file()).unwrap_or(false) {
                continue;
            }
            let name = e.file_name().to_string_lossy().to_string();
            if !referenced.contains(&name) {
                orphans.push(name);
            }
        }
    }
    orphans.sort();
    Ok(VerifyResult { missing, orphans })
}

#[tauri::command(async)]
fn cleanup_orphan_files(project_path: String, filenames: Vec<String>) -> AppResult<u32> {
    let musiques_dir = PathBuf::from(&project_path).join("musiques");
    let mut deleted = 0u32;
    for name in filenames {
        if safe_filename(&name).is_err() {
            continue;
        }
        let p = musiques_dir.join(&name);
        if p.exists() && fs::remove_file(&p).is_ok() {
            deleted += 1;
        }
    }
    Ok(deleted)
}

#[tauri::command(async)]
fn read_audio_file(path: String) -> AppResult<tauri::ipc::Response> {
    check_audio_path(Path::new(&path), |p| {
        ASSET_SCOPE.get().is_some_and(|scope| scope.is_allowed(p))
    })?;
    let metadata = fs::metadata(&path).map_err(fail("io.readFileFailed"))?;
    if metadata.len() > download::MAX_AUDIO_FILE_SIZE {
        return Err(AppError::new("download.fileTooLarge")
            .with("size", metadata.len() / (1024 * 1024))
            .with("limit", download::MAX_AUDIO_FILE_SIZE / (1024 * 1024)));
    }
    let bytes = fs::read(&path).map_err(fail("io.readFileFailed"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

fn project_json_filename(project: &Project) -> &'static str {
    if project.single_numero.unwrap_or(false) {
        "numero.json"
    } else {
        "projet.json"
    }
}

fn rotate_backups(dir: &Path, filename: &str) {
    let bak = |n: u8| dir.join(format!("{}.bak{}", filename, n));
    let _ = fs::remove_file(bak(3));
    let _ = fs::rename(bak(2), bak(3));
    let _ = fs::rename(bak(1), bak(2));
    // Copied, not renamed: the target must exist at every instant, in case
    // the final rename fails (file held by an antivirus, disk full).
    let current = dir.join(filename);
    if current.exists() {
        let _ = fs::copy(&current, bak(1));
    }
}

pub(crate) fn save_project_to_disk(project: &Project) -> AppResult<()> {
    use std::io::Write;
    use std::sync::Mutex;

    // Imports run off the main thread and save too: two writers must never
    // share the same .tmp file.
    static SAVE_LOCK: Mutex<()> = Mutex::new(());
    let _guard = SAVE_LOCK.lock().unwrap_or_else(|e| e.into_inner());

    let content = serde_json::to_string_pretty(project).map_err(fail("io.serializeFailed"))?;
    let dir = Path::new(&project.path);
    let filename = project_json_filename(project);
    let target = dir.join(filename);
    let tmp = dir.join(format!("{}.tmp", filename));
    {
        let mut file = fs::File::create(&tmp).map_err(fail("io.saveFailed"))?;
        file.write_all(content.as_bytes())
            .map_err(fail("io.saveFailed"))?;
        // Without it a power cut after the rename can leave an empty file.
        file.sync_all().map_err(fail("io.saveFailed"))?;
    }
    rotate_backups(dir, filename);
    fs::rename(&tmp, &target).map_err(fail("io.saveFailed"))?;
    // Persist the rename itself. Directories cannot be opened this way on
    // Windows, where NTFS journals the metadata anyway.
    #[cfg(unix)]
    if let Ok(d) = fs::File::open(dir) {
        let _ = d.sync_all();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    show_mode::configure_wsl2_audio();
    audio_session::start_session_namer();

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
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(file) = file_assoc::extract_file_from_args(&args) {
                file_assoc::deliver_open_file(app, file);
            }
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            use tauri::Manager;
            let _ = ASSET_SCOPE.set(app.asset_protocol_scope());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_default_projects_dir,
            get_default_numeros_dir,
            pick_folder,
            pick_audio_files,
            create_project,
            open_project,
            save_project,
            create_numero,
            open_numero,
            save_numero,
            copy_audio_file,
            delete_audio_file,
            verify_project,
            cleanup_orphan_files,
            read_audio_file,
            archive::pick_regieson_file,
            archive::save_regieson_file,
            archive::pick_regiesonnumero_file,
            archive::save_regiesonnumero_file,
            archive::export_project,
            archive::import_project,
            archive::export_numero,
            archive::import_numero_standalone,
            archive::import_numero_into_project,
            file_assoc::auto_import_regieson,
            file_assoc::auto_import_regiesonnumero,
            file_assoc::take_pending_open_file,
            cloud::share_project_on_cloud,
            cloud::share_numero_on_cloud,
            cloud::import_project_from_cloud,
            cloud::import_numero_from_cloud,
            cloud::import_numero_from_cloud_into_project,
            download::download_audio_from_url,
            download::download_youtube_audio,
            download::cancel_download,
            download::get_yt_dlp_version,
            download::update_yt_dlp,
            show_mode::set_show_mode,
            battery::get_battery_status,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // macOS passes double-clicked files as an Apple Event, not argv,
            // both at cold start and while running.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                let file = urls
                    .iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .map(|path| path.to_string_lossy().to_string())
                    .find(|path| file_assoc::is_openable(path));
                if let Some(file) = file {
                    file_assoc::deliver_open_file(_app, file);
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("regie-son-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn show(dir: &Path, name: &str) -> Project {
        Project {
            name: name.into(),
            path: dir.to_string_lossy().to_string(),
            numeros: vec![],
            single_numero: None,
        }
    }

    #[test]
    fn save_keeps_the_previous_version_as_backup() {
        let dir = scratch_dir();
        save_project_to_disk(&show(&dir, "v1")).unwrap();
        save_project_to_disk(&show(&dir, "v2")).unwrap();
        assert_eq!(
            open_project_from_file(&dir, "projet.json").unwrap().name,
            "v2"
        );
        assert_eq!(
            read_project_file(&dir, "projet.json.bak1").unwrap().name,
            "v1"
        );
        assert!(!dir.join("projet.json.tmp").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn open_falls_back_to_the_backup_when_the_file_is_missing() {
        let dir = scratch_dir();
        save_project_to_disk(&show(&dir, "v1")).unwrap();
        save_project_to_disk(&show(&dir, "v2")).unwrap();
        fs::remove_file(dir.join("projet.json")).unwrap();
        let project = open_project_from_file(&dir, "projet.json").unwrap();
        assert_eq!(project.name, "v1");
        assert_eq!(project.path, dir.to_string_lossy());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn open_falls_back_to_the_backup_when_the_file_is_corrupt() {
        let dir = scratch_dir();
        save_project_to_disk(&show(&dir, "v1")).unwrap();
        save_project_to_disk(&show(&dir, "v2")).unwrap();
        fs::write(dir.join("projet.json"), "{ trunc").unwrap();
        assert_eq!(
            open_project_from_file(&dir, "projet.json").unwrap().name,
            "v1"
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn create_refuses_a_folder_that_holds_a_show_or_an_act() {
        let dir = scratch_dir();
        save_project_to_disk(&show(&dir, "existing")).unwrap();
        let folder = dir.to_string_lossy().to_string();
        let err = create_project("new".into(), folder.clone()).unwrap_err();
        assert_eq!(err.code, "project.alreadyExists");
        let err = create_numero("new".into(), folder).unwrap_err();
        assert_eq!(err.code, "project.alreadyExists");
        assert_eq!(
            open_project_from_file(&dir, "projet.json").unwrap().name,
            "existing"
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn create_accepts_an_empty_folder() {
        let dir = scratch_dir();
        let project = create_project("new".into(), dir.to_string_lossy().to_string()).unwrap();
        assert_eq!(project.name, "new");
        assert!(dir.join("musiques").is_dir());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn every_project_handed_to_the_frontend_is_granted_to_the_player() {
        let dir = scratch_dir();
        take_granted();

        let show = dir.join("show");
        create_project("s".into(), show.to_string_lossy().to_string()).unwrap();
        assert_eq!(take_granted(), vec![show.join("musiques")]);

        let act = dir.join("act");
        create_numero("a".into(), act.to_string_lossy().to_string()).unwrap();
        assert_eq!(take_granted(), vec![act.join("musiques")]);

        open_project(show.to_string_lossy().to_string()).unwrap();
        assert_eq!(take_granted(), vec![show.join("musiques")]);

        open_numero(act.to_string_lossy().to_string()).unwrap();
        assert_eq!(take_granted(), vec![act.join("musiques")]);

        // A failed open grants nothing.
        assert!(open_project(dir.join("none").to_string_lossy().to_string()).is_err());
        assert!(take_granted().is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn read_audio_file_only_reads_granted_musiques_files() {
        let yes = |_: &Path| true;
        let no = |_: &Path| false;
        assert!(check_audio_path(Path::new("/show/musiques/a.mp3"), yes).is_ok());
        assert!(check_audio_path(Path::new("/show/musiques/a.mp3"), no).is_err());
        for path in [
            "/home/u/.ssh/id_rsa",
            "/show/musiques",
            "/show/musiques/sub/a.mp3",
            "/show/musiques/..",
            "/show/projet.json",
        ] {
            assert_eq!(
                check_audio_path(Path::new(path), yes).unwrap_err().code,
                "io.pathNotAllowed",
                "{path:?}"
            );
        }
    }

    #[test]
    fn open_reports_the_original_error_without_a_backup() {
        let dir = scratch_dir();
        fs::write(dir.join("projet.json"), "{ trunc").unwrap();
        let err = open_project_from_file(&dir, "projet.json").unwrap_err();
        assert_eq!(err.code, "project.invalidFile");
        fs::remove_dir_all(&dir).unwrap();
    }
}
