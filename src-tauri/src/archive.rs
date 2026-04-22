use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use tauri_plugin_dialog::DialogExt;

use crate::types::{migrate_project, PlaylistItem, Project};
use crate::{open_project_from_file, safe_filename, save_project_to_disk};

#[tauri::command]
pub fn pick_regieson_file(app: tauri::AppHandle) -> Option<String> {
    app.dialog().file()
        .add_filter("Régie Son", &["regieson"])
        .blocking_pick_file()
        .map(|p| p.to_string())
}

#[tauri::command]
pub fn save_regieson_file(app: tauri::AppHandle, default_name: String) -> Option<String> {
    app.dialog().file()
        .add_filter("Régie Son", &["regieson"])
        .set_file_name(&format!("{}.regieson", default_name))
        .blocking_save_file()
        .map(|p| p.to_string())
}

#[tauri::command]
pub fn pick_regiesonnumero_file(app: tauri::AppHandle) -> Option<String> {
    app.dialog().file()
        .add_filter("Numéro Régie Son", &["regiesonnumero"])
        .blocking_pick_file()
        .map(|p| p.to_string())
}

#[tauri::command]
pub fn save_regiesonnumero_file(app: tauri::AppHandle, default_name: String) -> Option<String> {
    app.dialog().file()
        .add_filter("Numéro Régie Son", &["regiesonnumero"])
        .set_file_name(&format!("{}.regiesonnumero", default_name))
        .blocking_save_file()
        .map(|p| p.to_string())
}

fn export_to_zip(src_path: &Path, dest_file: &str, json_filename: &str) -> Result<(), String> {
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
pub fn export_project(project_path: String, dest_file: String) -> Result<(), String> {
    export_to_zip(Path::new(&project_path), &dest_file, "projet.json")
}

#[tauri::command]
pub fn export_numero(numero_path: String, dest_file: String) -> Result<(), String> {
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
pub fn import_project(src_file: String, dest_folder: String) -> Result<Project, String> {
    let dest = PathBuf::from(&dest_folder);
    extract_zip_to(&src_file, &dest)?;
    open_project_from_file(&dest, "projet.json")
        .map_err(|e| format!("Archive invalide : {}", e))
}

#[tauri::command]
pub fn import_numero_standalone(src_file: String, dest_folder: String) -> Result<Project, String> {
    let dest = PathBuf::from(&dest_folder);
    extract_zip_to(&src_file, &dest)?;
    let mut project = open_project_from_file(&dest, "numero.json")
        .map_err(|e| format!("Archive invalide : {}", e))?;
    project.single_numero = Some(true);
    save_project_to_disk(&project)?;
    Ok(project)
}

#[tauri::command]
pub fn import_numero_into_project(src_file: String, project_path: String) -> Result<Project, String> {
    let mut project = open_project_from_file(Path::new(&project_path), "projet.json")
        .map_err(|e| format!("Projet cible invalide : {}", e))?;

    let file = fs::File::open(&src_file).map_err(|e| format!("Ouverture de l'archive : {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Archive invalide : {}", e))?;

    let raw_numero_json = {
        let mut entry = archive.by_name("numero.json")
            .map_err(|_| "Archive invalide : numero.json manquant".to_string())?;
        let mut s = String::new();
        entry.read_to_string(&mut s).map_err(|e| format!("Lecture numero.json : {}", e))?;
        s
    };

    let src_project = migrate_project(&raw_numero_json, String::new())?;
    let mut numero = src_project.numeros.into_iter().next()
        .ok_or("Archive invalide : aucun numéro")?;

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

    numero.id = uuid::Uuid::new_v4().to_string();
    numero.numero_type = "numero".into();
    project.numeros.push(numero);

    save_project_to_disk(&project)?;
    Ok(project)
}
