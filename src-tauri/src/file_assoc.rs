use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use crate::archive::{import_numero_standalone, import_project};
use crate::types::Project;
use crate::{default_numeros_dir, default_projects_dir};

fn pending_open_file() -> &'static Mutex<Option<String>> {
    static PENDING: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(None))
}

pub fn extract_file_from_args(args: &[String]) -> Option<String> {
    args.iter().skip(1).find(|a| {
        let lower = a.to_lowercase();
        lower.ends_with(".regieson") || lower.ends_with(".regiesonnumero")
    }).cloned()
}

pub fn set_pending_open_file(path: String) {
    *pending_open_file().lock().unwrap() = Some(path);
}

#[tauri::command]
pub fn take_pending_open_file() -> Option<String> {
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
pub fn auto_import_regieson(src_file: String) -> Result<Project, String> {
    let archive_name = Path::new(&src_file).file_stem()
        .ok_or("Nom de fichier invalide")?
        .to_string_lossy().to_string();
    let base_dir = PathBuf::from(default_projects_dir()).join(&archive_name);
    let dest = pick_unique_path(&base_dir);
    import_project(src_file, dest.to_string_lossy().to_string())
}

#[tauri::command]
pub fn auto_import_regiesonnumero(src_file: String) -> Result<Project, String> {
    let archive_name = Path::new(&src_file).file_stem()
        .ok_or("Nom de fichier invalide")?
        .to_string_lossy().to_string();
    let base_dir = PathBuf::from(default_numeros_dir()).join(&archive_name);
    let dest = pick_unique_path(&base_dir);
    import_numero_standalone(src_file, dest.to_string_lossy().to_string())
}
