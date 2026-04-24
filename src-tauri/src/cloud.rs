use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::archive::{export_to_zip, extract_zip_to, import_numero_into_project};
use crate::types::Project;
use crate::{open_project_from_file, save_project_to_disk};

const UPLOAD_URL: &str = "https://pixeldrain.com/api/file";
const MAX_CLOUD_FILE_SIZE: u64 = 2 * 1024 * 1024 * 1024; // 2 GB (PixelDrain free tier limit per file)

#[derive(Deserialize)]
struct UploadResponse {
    id: String,
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| format!("Erreur client HTTP : {}", e))
}

async fn upload_file(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|e| format!("Lecture métadonnées : {}", e))?;
    if metadata.len() > MAX_CLOUD_FILE_SIZE {
        return Err(format!(
            "Fichier trop volumineux ({} Mo). Limite du service : {} Mo.",
            metadata.len() / (1024 * 1024),
            MAX_CLOUD_FILE_SIZE / (1024 * 1024),
        ));
    }

    let bytes = fs::read(path).map_err(|e| format!("Lecture du fichier : {}", e))?;
    let filename = path
        .file_name()
        .ok_or("Nom de fichier invalide")?
        .to_string_lossy()
        .to_string();

    let part = reqwest::multipart::Part::bytes(bytes).file_name(filename);
    let form = reqwest::multipart::Form::new().part("file", part);

    let client = http_client()?;
    let resp = client
        .post(UPLOAD_URL)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Erreur de connexion : {}", e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Erreur du service cloud (HTTP {})",
            resp.status().as_u16()
        ));
    }

    let body: UploadResponse = resp
        .json()
        .await
        .map_err(|e| format!("Réponse inattendue du service : {}", e))?;
    Ok(body.id)
}

async fn download_file(code: &str, dest: &Path) -> Result<(), String> {
    let trimmed = code.trim();
    if trimmed.is_empty() || !trimmed.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Code invalide.".into());
    }

    let client = http_client()?;
    let url = format!("https://pixeldrain.com/api/file/{}", trimmed);
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Erreur de connexion : {}", e))?;

    if resp.status().as_u16() == 404 {
        return Err("Code introuvable ou fichier expiré.".into());
    }
    if !resp.status().is_success() {
        return Err(format!(
            "Erreur du service cloud (HTTP {})",
            resp.status().as_u16()
        ));
    }

    if let Some(len) = resp.content_length() {
        if len > MAX_CLOUD_FILE_SIZE {
            return Err(format!(
                "Fichier distant trop volumineux ({} Mo).",
                len / (1024 * 1024)
            ));
        }
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Erreur de lecture : {}", e))?;
    fs::write(dest, &bytes).map_err(|e| format!("Écriture : {}", e))?;
    Ok(())
}

fn temp_archive_path(ext: &str) -> PathBuf {
    let id = uuid::Uuid::new_v4().to_string();
    std::env::temp_dir().join(format!("regieson-{}.{}", id, ext))
}

#[tauri::command]
pub async fn share_project_on_cloud(project_path: String) -> Result<String, String> {
    let tmp = temp_archive_path("regieson");
    export_to_zip(Path::new(&project_path), &tmp.to_string_lossy(), "projet.json")?;
    let result = upload_file(&tmp).await;
    let _ = fs::remove_file(&tmp);
    result
}

#[tauri::command]
pub async fn share_numero_on_cloud(numero_path: String) -> Result<String, String> {
    let tmp = temp_archive_path("regiesonnumero");
    export_to_zip(Path::new(&numero_path), &tmp.to_string_lossy(), "numero.json")?;
    let result = upload_file(&tmp).await;
    let _ = fs::remove_file(&tmp);
    result
}

#[tauri::command]
pub async fn import_project_from_cloud(code: String, dest_folder: String) -> Result<Project, String> {
    let tmp = temp_archive_path("regieson");
    let outcome = async {
        download_file(&code, &tmp).await?;
        let dest = PathBuf::from(&dest_folder);
        extract_zip_to(&tmp.to_string_lossy(), &dest)?;
        open_project_from_file(&dest, "projet.json")
            .map_err(|e| format!("Archive invalide : {}", e))
    }
    .await;
    let _ = fs::remove_file(&tmp);
    outcome
}

#[tauri::command]
pub async fn import_numero_from_cloud_into_project(code: String, project_path: String) -> Result<Project, String> {
    let tmp = temp_archive_path("regiesonnumero");
    let outcome = async {
        download_file(&code, &tmp).await?;
        import_numero_into_project(tmp.to_string_lossy().to_string(), project_path)
    }
    .await;
    let _ = fs::remove_file(&tmp);
    outcome
}

#[tauri::command]
pub async fn import_numero_from_cloud(code: String, dest_folder: String) -> Result<Project, String> {
    let tmp = temp_archive_path("regiesonnumero");
    let outcome = async {
        download_file(&code, &tmp).await?;
        let dest = PathBuf::from(&dest_folder);
        extract_zip_to(&tmp.to_string_lossy(), &dest)?;
        let mut project = open_project_from_file(&dest, "numero.json")
            .map_err(|e| format!("Archive invalide : {}", e))?;
        project.single_numero = Some(true);
        save_project_to_disk(&project)?;
        Ok(project)
    }
    .await;
    let _ = fs::remove_file(&tmp);
    outcome
}
