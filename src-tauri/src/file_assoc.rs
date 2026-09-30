use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use tauri::{Emitter, Manager};

use crate::archive::{import_numero_standalone, import_project};
use crate::error::{missing, AppResult};
use crate::types::Project;
use crate::{default_numeros_dir, default_projects_dir};

fn pending_open_file() -> &'static Mutex<Option<String>> {
    static PENDING: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(None))
}

// Set once the frontend has asked for the pending file: from then on its
// "open-file" listener is in place and a file can be sent straight to it.
static FRONTEND_READY: AtomicBool = AtomicBool::new(false);

pub fn is_openable(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".regieson") || lower.ends_with(".regiesonnumero")
}

pub fn extract_file_from_args(args: &[String]) -> Option<String> {
    args.iter().skip(1).find(|a| is_openable(a)).cloned()
}

pub fn set_pending_open_file(path: String) {
    *pending_open_file().lock().unwrap() = Some(path);
}

/// Hands a file the OS asked us to open to the frontend: kept for
/// take_pending_open_file while the webview is still loading (an event sent
/// then would be lost), sent as "open-file" once it listens.
pub fn deliver_open_file(app: &tauri::AppHandle, path: String) {
    if !FRONTEND_READY.load(Ordering::SeqCst) {
        set_pending_open_file(path);
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = window.emit("open-file", path);
    }
}

#[tauri::command]
pub fn take_pending_open_file() -> Option<String> {
    FRONTEND_READY.store(true, Ordering::SeqCst);
    pending_open_file().lock().unwrap().take()
}

pub(crate) fn pick_unique_path(base: &Path) -> PathBuf {
    if !base.exists() {
        return base.to_path_buf();
    }
    let parent = base.parent().unwrap_or(Path::new("."));
    let name = base
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    for i in 2..1000 {
        let candidate = parent.join(format!("{}-{}", name, i));
        if !candidate.exists() {
            return candidate;
        }
    }
    parent.join(format!("{}-{}", name, std::process::id()))
}

#[tauri::command(async)]
pub fn auto_import_regieson(src_file: String) -> AppResult<Project> {
    let archive_name = Path::new(&src_file)
        .file_stem()
        .ok_or_else(missing("io.invalidFilename"))?
        .to_string_lossy()
        .to_string();
    let base_dir = PathBuf::from(default_projects_dir()).join(&archive_name);
    let dest = pick_unique_path(&base_dir);
    import_project(src_file, dest.to_string_lossy().to_string())
}

#[tauri::command(async)]
pub fn auto_import_regiesonnumero(src_file: String) -> AppResult<Project> {
    let archive_name = Path::new(&src_file)
        .file_stem()
        .ok_or_else(missing("io.invalidFilename"))?
        .to_string_lossy()
        .to_string();
    let base_dir = PathBuf::from(default_numeros_dir()).join(&archive_name);
    let dest = pick_unique_path(&base_dir);
    import_numero_standalone(src_file, dest.to_string_lossy().to_string())
}
