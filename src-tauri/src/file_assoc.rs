use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use tauri::{Emitter, Manager};

use crate::archive::{read_json_entry, referenced_audio, unpack_numero, unpack_project};
use crate::error::{missing, AppResult};
use crate::types::{migrate_project, Project};
use crate::{default_numeros_dir, default_projects_dir, open_numero_folder, open_show_folder};

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
    focus_main_window(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("open-file", path);
    }
}

/// Brings the window forward, for a second launch that found us running.
pub fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
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

/// Whether `dir` holds this archive as it was unpacked: same project once
/// normalised, and every track present with the size it has in the archive.
/// Anything edited since, even a volume, makes it a different show.
fn holds_same_content(src_file: &str, json_filename: &str, dir: &Path) -> Option<bool> {
    let normalised = |raw: &str| {
        let mut project = migrate_project(raw, String::new()).ok()?;
        // unpack_numero sets the flag and saves: it is no edit.
        project.single_numero = None;
        serde_json::to_value(&project).ok().map(|v| (project, v))
    };
    let mut archive = zip::ZipArchive::new(fs::File::open(src_file).ok()?).ok()?;
    let raw = read_json_entry(&mut archive.by_name(json_filename).ok()?, json_filename).ok()?;
    let (project, packed) = normalised(&raw)?;
    let (_, unpacked) = normalised(&fs::read_to_string(dir.join(json_filename)).ok()?)?;
    if packed != unpacked {
        return Some(false);
    }
    for name in referenced_audio(&project) {
        let on_disk = fs::metadata(dir.join("musiques").join(&name)).ok();
        let in_archive = archive.by_name(&format!("musiques/{}", name)).ok();
        if on_disk.map(|m| m.len()) != in_archive.map(|e| e.size()) {
            return Some(false);
        }
    }
    Some(true)
}

/// A copy of this archive left untouched by an earlier double-click, among
/// the folders pick_unique_path would pass over: `base`, `base-2`…
fn earlier_import(src_file: &str, json_filename: &str, base: &Path) -> Option<PathBuf> {
    let name = base.file_name()?.to_string_lossy().to_string();
    (1..1000)
        .map(|i| match i {
            1 => base.to_path_buf(),
            i => base.with_file_name(format!("{}-{}", name, i)),
        })
        .take_while(|dir| dir.exists())
        .find(|dir| holds_same_content(src_file, json_filename, dir) == Some(true))
}

fn auto_import(src_file: &str, base_dir: &Path, json_filename: &str) -> AppResult<Project> {
    let numero = json_filename == "numero.json";
    // Opening the same file twice used to leave a new copy each time.
    if let Some(dir) = earlier_import(src_file, json_filename, base_dir) {
        return if numero {
            open_numero_folder(&dir)
        } else {
            open_show_folder(&dir)
        };
    }
    let dest = pick_unique_path(base_dir);
    if numero {
        unpack_numero(src_file, &dest)
    } else {
        unpack_project(src_file, &dest)
    }
}

fn archive_name(src_file: &str) -> AppResult<String> {
    Ok(Path::new(src_file)
        .file_stem()
        .ok_or_else(missing("io.invalidFilename"))?
        .to_string_lossy()
        .to_string())
}

#[tauri::command(async)]
pub fn auto_import_regieson(src_file: String) -> AppResult<Project> {
    let base_dir = PathBuf::from(default_projects_dir()).join(archive_name(&src_file)?);
    auto_import(&src_file, &base_dir, "projet.json")
}

#[tauri::command(async)]
pub fn auto_import_regiesonnumero(src_file: String) -> AppResult<Project> {
    let base_dir = PathBuf::from(default_numeros_dir()).join(archive_name(&src_file)?);
    auto_import(&src_file, &base_dir, "numero.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn picks_the_first_show_or_act_after_the_program_name() {
        assert_eq!(
            extract_file_from_args(&args(&[
                "regie-son",
                "--flag",
                "/home/me/Show.REGIESON",
                "/b.regiesonnumero"
            ])),
            Some("/home/me/Show.REGIESON".into())
        );
        assert_eq!(
            extract_file_from_args(&args(&["regie-son", "C:\\Users\\me\\Act.regiesonnumero"])),
            Some("C:\\Users\\me\\Act.regiesonnumero".into())
        );
    }

    fn scratch_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("regie-son-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_archive(path: &Path, json_filename: &str) {
        use std::io::Write;
        let mut zip = zip::ZipWriter::new(fs::File::create(path).unwrap());
        let options: zip::write::FileOptions<()> = zip::write::FileOptions::default();
        zip.start_file(json_filename, options).unwrap();
        zip.write_all(
            br#"{"name":"s","numeros":[{"id":"n","type":"numero","name":"n","items":[
                {"type":"audio","id":"a","filename":"a.mp3","original_name":"a.mp3","volume":100}
            ]}]}"#,
        )
        .unwrap();
        zip.start_file("musiques/a.mp3", options).unwrap();
        zip.write_all(b"audio").unwrap();
        zip.finish().unwrap();
    }

    #[test]
    fn opening_the_same_archive_again_reuses_the_untouched_copy() {
        for json in ["projet.json", "numero.json"] {
            let dir = scratch_dir();
            let src = dir.join("show.regieson");
            write_archive(&src, json);
            let src = src.to_string_lossy().to_string();
            let base = dir.join("Show");

            let first = auto_import(&src, &base, json).unwrap();
            let again = auto_import(&src, &base, json).unwrap();
            assert_eq!(again.path, first.path, "{json}");

            // Once edited, it is another show: a new copy is made.
            let mut edited = again.clone();
            edited.name = "edited".into();
            crate::save_project_to_disk(&edited).unwrap();
            let third = auto_import(&src, &base, json).unwrap();
            assert_eq!(third.path, dir.join("Show-2").to_string_lossy(), "{json}");
            assert_eq!(auto_import(&src, &base, json).unwrap().path, third.path);

            // So is a copy that lost a track.
            fs::remove_file(dir.join("Show-2").join("musiques").join("a.mp3")).unwrap();
            let fourth = auto_import(&src, &base, json).unwrap();
            assert_eq!(fourth.path, dir.join("Show-3").to_string_lossy(), "{json}");
            crate::take_granted();
            fs::remove_dir_all(&dir).unwrap();
        }
    }

    #[test]
    fn ignores_the_program_itself_and_other_files() {
        assert_eq!(extract_file_from_args(&args(&["/opt/x.regieson"])), None);
        assert_eq!(
            extract_file_from_args(&args(&["regie-son", "song.mp3", "notes.regieson.txt"])),
            None
        );
    }
}
