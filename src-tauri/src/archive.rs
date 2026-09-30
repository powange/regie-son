use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use tauri_plugin_dialog::DialogExt;

use crate::error::{fail, missing, AppError, AppResult};
use crate::types::{migrate_project, PlaylistItem, Project};
use crate::{ensure_no_project, open_project_from_file, safe_filename, save_project_to_disk};

#[tauri::command(async)]
pub fn pick_regieson_file(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .add_filter("Régie Son", &["regieson"])
        .blocking_pick_file()
        .map(|p| p.to_string())
}

#[tauri::command(async)]
pub fn save_regieson_file(app: tauri::AppHandle, default_name: String) -> Option<String> {
    app.dialog()
        .file()
        .add_filter("Régie Son", &["regieson"])
        .set_file_name(format!("{}.regieson", default_name))
        .blocking_save_file()
        .map(|p| p.to_string())
}

#[tauri::command(async)]
pub fn pick_regiesonnumero_file(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .add_filter("Numéro Régie Son", &["regiesonnumero"])
        .blocking_pick_file()
        .map(|p| p.to_string())
}

#[tauri::command(async)]
pub fn save_regiesonnumero_file(app: tauri::AppHandle, default_name: String) -> Option<String> {
    app.dialog()
        .file()
        .add_filter("Numéro Régie Son", &["regiesonnumero"])
        .set_file_name(format!("{}.regiesonnumero", default_name))
        .blocking_save_file()
        .map(|p| p.to_string())
}

pub(crate) fn export_to_zip(
    src_path: &Path,
    dest_file: &str,
    json_filename: &str,
) -> AppResult<()> {
    let file = fs::File::create(dest_file).map_err(fail("archive.createFailed"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options: zip::write::FileOptions<()> =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let json_path = src_path.join(json_filename);
    if !json_path.exists() {
        return Err(AppError::new("archive.missingFile").with("name", json_filename));
    }
    let content = fs::read(&json_path).map_err(|e| {
        AppError::new("archive.readNamedFailed")
            .with("name", json_filename)
            .detail(e)
    })?;
    zip.start_file(json_filename, options)
        .map_err(fail("archive.zipFailed"))?;
    zip.write_all(&content).map_err(fail("io.writeFailed"))?;

    let musiques_dir = src_path.join("musiques");
    if musiques_dir.exists() {
        let entries = fs::read_dir(&musiques_dir).map_err(fail("archive.readDirFailed"))?;
        for entry in entries.filter_map(|e| e.ok()) {
            if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let content = fs::read(entry.path()).map_err(|e| {
                AppError::new("archive.readNamedFailed")
                    .with("name", &name)
                    .detail(e)
            })?;
            zip.start_file(format!("musiques/{}", name), options)
                .map_err(fail("archive.zipFailed"))?;
            zip.write_all(&content).map_err(fail("io.writeFailed"))?;
        }
    }

    zip.finish().map_err(fail("archive.finishFailed"))?;
    Ok(())
}

#[tauri::command(async)]
pub fn export_project(project_path: String, dest_file: String) -> AppResult<()> {
    export_to_zip(Path::new(&project_path), &dest_file, "projet.json")
}

#[tauri::command(async)]
pub fn export_numero(numero_path: String, dest_file: String) -> AppResult<()> {
    export_to_zip(Path::new(&numero_path), &dest_file, "numero.json")
}

/// Where a zip entry lands, relative to the extraction folder.
///
/// An archive only ever holds `projet.json` or `numero.json` and the files of
/// `musiques/`: anything else is skipped (`Ok(None)`). A name that tries to
/// leave the folder is refused outright (`Err`). The checks are spelled out
/// rather than left to `Path`, because `Path` parses by the host's rules: on
/// Linux `C:/…` or `a\..\b` are ordinary names, on Windows they escape.
fn entry_target(name: &str) -> Result<Option<PathBuf>, ()> {
    if name.contains('\0') || name.starts_with('/') || name.starts_with('\\') {
        return Err(());
    }
    let parts: Vec<&str> = name.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
    // ':' covers drive letters (`C:`) and NTFS alternate streams (`a.mp3:x`).
    if parts
        .iter()
        .any(|p| *p == ".." || *p == "." || p.contains(':'))
    {
        return Err(());
    }
    match parts.as_slice() {
        [json @ ("projet.json" | "numero.json")] => Ok(Some(PathBuf::from(*json))),
        ["musiques", file] => {
            safe_filename(file).map_err(|_| ())?;
            Ok(Some(Path::new("musiques").join(file)))
        }
        _ => Ok(None),
    }
}

const MB: u64 = 1024 * 1024;
const MAX_JSON_SIZE: u64 = 16 * MB;

/// Caps on what an archive may unpack to. The sizes a zip declares can lie,
/// so they are only a first check: the copy itself stops one byte past the
/// cap. Without them a 1 GB cloud share can inflate to hundreds of GB and
/// fill the system disk.
#[derive(Clone, Copy)]
pub(crate) struct ExtractLimits {
    pub per_file: u64,
    pub total: u64,
}

// Per file, the same cap as a downloaded file (read_audio_file refuses more).
pub(crate) const EXTRACT_LIMITS: ExtractLimits = ExtractLimits {
    per_file: crate::download::MAX_AUDIO_FILE_SIZE,
    total: 16 * 1024 * MB,
};

/// Copies one archive entry into `out`, charging it to `budget` (what is
/// left of the total allowance).
fn copy_capped(
    entry: &mut impl Read,
    declared: u64,
    out: &mut impl Write,
    name: &str,
    per_file: u64,
    budget: &mut u64,
) -> AppResult<()> {
    let cap = per_file.min(*budget);
    let too_large = || {
        if cap < per_file {
            AppError::new("archive.tooLarge").with("limit", EXTRACT_LIMITS.total / MB)
        } else {
            AppError::new("archive.entryTooLarge")
                .with("name", name)
                .with("limit", per_file / MB)
        }
    };
    if declared > cap {
        return Err(too_large());
    }
    let copied = std::io::copy(&mut entry.take(cap + 1), out).map_err(|e| {
        AppError::new("archive.extractNamedFailed")
            .with("name", name)
            .detail(e)
    })?;
    if copied > cap {
        return Err(too_large());
    }
    *budget -= copied;
    Ok(())
}

/// Reads a projet.json / numero.json entry, which is never legitimately big.
pub(crate) fn read_json_entry(entry: &mut impl Read, name: &str) -> AppResult<String> {
    let mut content = String::new();
    entry
        .take(MAX_JSON_SIZE + 1)
        .read_to_string(&mut content)
        .map_err(|e| {
            AppError::new("archive.readNamedFailed")
                .with("name", name)
                .detail(e)
        })?;
    if content.len() as u64 > MAX_JSON_SIZE {
        return Err(AppError::new("archive.entryTooLarge")
            .with("name", name)
            .with("limit", MAX_JSON_SIZE / MB));
    }
    Ok(content)
}

pub(crate) fn extract_zip_to(src_file: &str, dest_folder: &Path) -> AppResult<()> {
    extract_zip_with_limits(src_file, dest_folder, EXTRACT_LIMITS)
}

fn extract_zip_with_limits(
    src_file: &str,
    dest_folder: &Path,
    limits: ExtractLimits,
) -> AppResult<()> {
    fs::create_dir_all(dest_folder).map_err(fail("io.createDirFailed"))?;
    let mut budget = limits.total;

    let file = fs::File::open(src_file).map_err(fail("archive.openFailed"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(fail("archive.invalid"))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(fail("archive.readEntryFailed"))?;
        let name = entry.name().to_string();
        let unsafe_path = || AppError::new("archive.unsafePath").with("name", &name);
        // Second opinion from the zip crate, which also judges by the host's rules.
        if entry.enclosed_name().is_none() {
            return Err(unsafe_path());
        }
        let Some(relative) = entry_target(&name).map_err(|_| unsafe_path())? else {
            continue;
        };
        if entry.is_dir() {
            continue;
        }
        let out_path = dest_folder.join(&relative);
        if !out_path.starts_with(dest_folder) {
            return Err(unsafe_path());
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(fail("io.createDirFailed"))?;
        }
        let per_file = if relative.starts_with("musiques") {
            limits.per_file
        } else {
            MAX_JSON_SIZE
        };
        let declared = entry.size();
        let mut out = fs::File::create(&out_path).map_err(fail("archive.createEntryFailed"))?;
        if let Err(e) = copy_capped(&mut entry, declared, &mut out, &name, per_file, &mut budget) {
            drop(out);
            let _ = fs::remove_file(&out_path);
            return Err(e);
        }
    }
    Ok(())
}

#[tauri::command(async)]
pub fn import_project(src_file: String, dest_folder: String) -> AppResult<Project> {
    let dest = PathBuf::from(&dest_folder);
    ensure_no_project(&dest)?;
    extract_zip_to(&src_file, &dest)?;
    open_project_from_file(&dest, "projet.json").map_err(fail("archive.invalid"))
}

#[tauri::command(async)]
pub fn import_numero_standalone(src_file: String, dest_folder: String) -> AppResult<Project> {
    let dest = PathBuf::from(&dest_folder);
    ensure_no_project(&dest)?;
    extract_zip_to(&src_file, &dest)?;
    let mut project =
        open_project_from_file(&dest, "numero.json").map_err(fail("archive.invalid"))?;
    project.single_numero = Some(true);
    save_project_to_disk(&project)?;
    Ok(project)
}

#[tauri::command(async)]
pub fn import_numero_into_project(src_file: String, project_path: String) -> AppResult<Project> {
    let mut project = open_project_from_file(Path::new(&project_path), "projet.json")
        .map_err(fail("archive.targetProjectInvalid"))?;

    let file = fs::File::open(&src_file).map_err(fail("archive.openFailed"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(fail("archive.invalid"))?;

    let raw_numero_json = {
        let mut entry = archive
            .by_name("numero.json")
            .map_err(|_| AppError::new("archive.missingNumeroJson"))?;
        read_json_entry(&mut entry, "numero.json")?
    };

    let src_project = migrate_project(&raw_numero_json, String::new())?;
    let mut numero = src_project
        .numeros
        .into_iter()
        .next()
        .ok_or_else(missing("archive.noAct"))?;

    let dest_musiques = PathBuf::from(&project_path).join("musiques");
    fs::create_dir_all(&dest_musiques).map_err(fail("io.createDirFailed"))?;

    let mut budget = EXTRACT_LIMITS.total;
    for item in numero.items.iter_mut() {
        if let PlaylistItem::Audio(audio) = item {
            safe_filename(&audio.filename)?;
            let archive_path = format!("musiques/{}", audio.filename);
            let mut entry = archive.by_name(&archive_path).map_err(|_| {
                AppError::new("archive.fileMissingInArchive").with("name", &audio.filename)
            })?;
            let ext = Path::new(&audio.filename)
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy()))
                .unwrap_or_default();
            let new_id = uuid::Uuid::new_v4().to_string();
            let new_filename = format!("{}{}", new_id, ext);
            let out_path = dest_musiques.join(&new_filename);
            let mut out = fs::File::create(&out_path).map_err(|e| {
                AppError::new("archive.createNamedFailed")
                    .with("name", &new_filename)
                    .detail(e)
            })?;
            let declared = entry.size();
            if let Err(e) = copy_capped(
                &mut entry,
                declared,
                &mut out,
                &audio.filename,
                EXTRACT_LIMITS.per_file,
                &mut budget,
            ) {
                drop(out);
                let _ = fs::remove_file(&out_path);
                return Err(e);
            }
            audio.id = new_id;
            audio.filename = new_filename;
        } else if let PlaylistItem::Pause(pause) = item {
            pause.id = uuid::Uuid::new_v4().to_string();
        }
    }

    numero.id = uuid::Uuid::new_v4().to_string();
    numero.numero_type = "numero".into();
    project.numeros.push(numero);

    save_project_to_disk(&project)?;
    Ok(project)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_target_keeps_the_archive_layout() {
        assert_eq!(
            entry_target("projet.json"),
            Ok(Some(PathBuf::from("projet.json")))
        );
        assert_eq!(
            entry_target("numero.json"),
            Ok(Some(PathBuf::from("numero.json")))
        );
        assert_eq!(
            entry_target("musiques/1f0e.mp3"),
            Ok(Some(Path::new("musiques").join("1f0e.mp3")))
        );
        assert_eq!(
            entry_target("musiques\\1f0e.mp3"),
            Ok(Some(Path::new("musiques").join("1f0e.mp3")))
        );
    }

    #[test]
    fn entry_target_skips_foreign_entries() {
        assert_eq!(entry_target("musiques/"), Ok(None));
        assert_eq!(entry_target("__MACOSX/._projet.json"), Ok(None));
        assert_eq!(entry_target("readme.txt"), Ok(None));
        assert_eq!(entry_target("musiques/sub/a.mp3"), Ok(None));
    }

    #[test]
    fn entry_target_refuses_escapes() {
        for name in [
            "../evil.bat",
            "musiques/../../evil.bat",
            "musiques\\..\\..\\evil.bat",
            "/etc/passwd",
            "\\Windows\\evil.bat",
            "C:/Users/x/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/evil.bat",
            "C:evil.bat",
            "musiques/a.mp3:stream",
            "\\\\?\\C:\\evil.bat",
            "musiques/./a.mp3",
            "projet.json\0",
        ] {
            assert_eq!(entry_target(name), Err(()), "{name:?} should be refused");
        }
    }

    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let mut zip = zip::ZipWriter::new(fs::File::create(path).unwrap());
        let options: zip::write::FileOptions<()> = zip::write::FileOptions::default();
        for (name, data) in entries {
            zip.start_file(*name, options).unwrap();
            zip.write_all(data).unwrap();
        }
        zip.finish().unwrap();
    }

    fn scratch_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("regie-son-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn extract_writes_the_expected_files_only() {
        let dir = scratch_dir();
        let src = dir.join("show.regieson");
        write_zip(
            &src,
            &[
                ("projet.json", b"{}"),
                ("musiques/a.mp3", b"audio"),
                ("__MACOSX/._a.mp3", b"junk"),
            ],
        );
        let dest = dir.join("out");
        extract_zip_to(src.to_str().unwrap(), &dest).unwrap();
        assert_eq!(fs::read(dest.join("projet.json")).unwrap(), b"{}");
        assert_eq!(
            fs::read(dest.join("musiques").join("a.mp3")).unwrap(),
            b"audio"
        );
        assert!(!dest.join("__MACOSX").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn import_refuses_to_overwrite_a_show() {
        let dir = scratch_dir();
        let src = dir.join("show.regieson");
        write_zip(
            &src,
            &[("projet.json", b"{\"name\":\"imported\",\"numeros\":[]}")],
        );
        let dest = dir.join("out");
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("projet.json"), b"original").unwrap();
        let src_file = src.to_string_lossy().to_string();
        let dest_folder = dest.to_string_lossy().to_string();
        let err = import_project(src_file.clone(), dest_folder.clone()).unwrap_err();
        assert_eq!(err.code, "project.alreadyExists");
        let err = import_numero_standalone(src_file, dest_folder).unwrap_err();
        assert_eq!(err.code, "project.alreadyExists");
        assert_eq!(fs::read(dest.join("projet.json")).unwrap(), b"original");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn import_into_a_fresh_folder() {
        let dir = scratch_dir();
        let src = dir.join("show.regieson");
        write_zip(
            &src,
            &[("projet.json", b"{\"name\":\"imported\",\"numeros\":[]}")],
        );
        let dest = dir.join("out");
        let project = import_project(
            src.to_string_lossy().to_string(),
            dest.to_string_lossy().to_string(),
        )
        .unwrap();
        assert_eq!(project.name, "imported");
        // The player streams through the asset protocol: see grant_audio_access.
        assert_eq!(crate::take_granted(), vec![dest.join("musiques")]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn extract_refuses_an_entry_over_the_file_cap() {
        let dir = scratch_dir();
        let src = dir.join("big.regieson");
        write_zip(
            &src,
            &[("projet.json", b"{}"), ("musiques/a.mp3", &[0u8; 2048])],
        );
        let dest = dir.join("out");
        let limits = ExtractLimits {
            per_file: 1024,
            total: 1 << 20,
        };
        let err = extract_zip_with_limits(src.to_str().unwrap(), &dest, limits).unwrap_err();
        assert_eq!(err.code, "archive.entryTooLarge");
        assert!(!dest.join("musiques").join("a.mp3").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn extract_refuses_an_archive_over_the_total_cap() {
        let dir = scratch_dir();
        let src = dir.join("big.regieson");
        write_zip(
            &src,
            &[
                ("projet.json", b"{}"),
                ("musiques/a.mp3", &[0u8; 800]),
                ("musiques/b.mp3", &[0u8; 800]),
            ],
        );
        let dest = dir.join("out");
        let limits = ExtractLimits {
            per_file: 1024,
            total: 1500,
        };
        let err = extract_zip_with_limits(src.to_str().unwrap(), &dest, limits).unwrap_err();
        assert_eq!(err.code, "archive.tooLarge");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn copy_stops_at_the_cap_whatever_the_entry_declares() {
        let data = [1u8; 100];
        let mut out = Vec::new();
        let mut budget = 1000;
        // Declares 10 bytes, holds 100: the header lies.
        let err = copy_capped(&mut &data[..], 10, &mut out, "a.mp3", 50, &mut budget).unwrap_err();
        assert_eq!(err.code, "archive.entryTooLarge");
        assert!(out.len() <= 51);

        let mut out = Vec::new();
        copy_capped(&mut &data[..], 100, &mut out, "a.mp3", 100, &mut budget).unwrap();
        assert_eq!(out.len(), 100);
        assert_eq!(budget, 900);
    }

    #[test]
    fn json_entries_are_capped() {
        let big = vec![b' '; (MAX_JSON_SIZE + 1) as usize];
        let err = read_json_entry(&mut &big[..], "projet.json").unwrap_err();
        assert_eq!(err.code, "archive.entryTooLarge");
        assert_eq!(
            read_json_entry(&mut &b"{}"[..], "projet.json").unwrap(),
            "{}"
        );
    }

    #[test]
    fn extract_refuses_an_escaping_entry() {
        let dir = scratch_dir();
        let src = dir.join("evil.regieson");
        write_zip(
            &src,
            &[("projet.json", b"{}"), ("musiques/../../evil.bat", b"x")],
        );
        let dest = dir.join("out");
        let err = extract_zip_to(src.to_str().unwrap(), &dest).unwrap_err();
        assert_eq!(err.code, "archive.unsafePath");
        assert!(!dir.join("evil.bat").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
