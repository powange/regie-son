use std::fs;
use std::path::{Path, PathBuf};

use crate::archive::{export_to_zip, extract_zip_to, import_numero_into_project};
use crate::types::{migrate_project, Project};
use crate::{open_project_from_file, save_project_to_disk};

// Litterbox (sister of catbox.moe) — anonymous uploads, no account required,
// files expire after the chosen retention. We use 72h, the maximum.
const UPLOAD_URL: &str = "https://litterbox.catbox.moe/resources/internals/api.php";
const DOWNLOAD_BASE: &str = "https://litter.catbox.moe";
const RETENTION: &str = "72h";
const MAX_CLOUD_FILE_SIZE: u64 = 1024 * 1024 * 1024; // 1 GB (Litterbox limit per file)

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| format!("Erreur client HTTP : {}", e))
}

// Returns the short code (filename stem) extracted from the Litterbox URL.
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
    let form = reqwest::multipart::Form::new()
        .text("reqtype", "fileupload")
        .text("time", RETENTION)
        .part("fileToUpload", part);

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

    let body = resp
        .text()
        .await
        .map_err(|e| format!("Réponse inattendue du service : {}", e))?
        .trim()
        .to_string();
    if !body.starts_with("https://") {
        return Err(format!("Réponse inattendue du service : {}", body));
    }
    // Body is the full URL e.g. "https://litter.catbox.moe/abc123.zip".
    // Strip the path and the file extension to keep just the short code.
    let stem = body
        .rsplit('/')
        .next()
        .and_then(|seg| seg.split('.').next())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("URL inattendue : {}", body))?;
    Ok(stem.to_string())
}

// Always downloads <code>.zip — share_*_on_cloud uploads as .zip so the
// extension on Litterbox is always known.
async fn download_file(code: &str, dest: &Path) -> Result<(), String> {
    let trimmed = code.trim();
    if trimmed.is_empty() || !trimmed.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Code invalide.".into());
    }

    let client = http_client()?;
    let url = format!("{}/{}.zip", DOWNLOAD_BASE, trimmed);
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

// Validate a downloaded archive before we commit to extracting it. Catches
// codes that point to unrelated files / wrong-kind archives so we don't
// pollute the target folder.
fn validate_zip_archive(zip_path: &Path, expected_json: &str, kind_label: &str) -> Result<(), String> {
    use std::io::Read;
    let file = fs::File::open(zip_path)
        .map_err(|e| format!("Lecture du fichier téléchargé : {}", e))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|_| "Le fichier reçu n'est pas une archive valide.".to_string())?;
    let mut entry = archive.by_name(expected_json).map_err(|_| {
        format!(
            "Ce code ne correspond pas à un {} Régie Son ({} introuvable dans l'archive).",
            kind_label, expected_json
        )
    })?;
    let mut content = String::new();
    entry
        .read_to_string(&mut content)
        .map_err(|_| format!("Archive corrompue : {} illisible.", expected_json))?;
    migrate_project(&content, String::new())
        .map_err(|e| format!("Archive invalide : {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn share_project_on_cloud(project_path: String) -> Result<String, String> {
    let tmp = temp_archive_path("zip");
    export_to_zip(Path::new(&project_path), &tmp.to_string_lossy(), "projet.json")?;
    let result = upload_file(&tmp).await;
    let _ = fs::remove_file(&tmp);
    result
}

#[tauri::command]
pub async fn share_numero_on_cloud(numero_path: String) -> Result<String, String> {
    let tmp = temp_archive_path("zip");
    export_to_zip(Path::new(&numero_path), &tmp.to_string_lossy(), "numero.json")?;
    let result = upload_file(&tmp).await;
    let _ = fs::remove_file(&tmp);
    result
}

#[tauri::command]
pub async fn import_project_from_cloud(code: String, dest_folder: String) -> Result<Project, String> {
    let tmp = temp_archive_path("zip");
    let outcome = async {
        download_file(&code, &tmp).await?;
        validate_zip_archive(&tmp, "projet.json", "spectacle")?;
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
    let tmp = temp_archive_path("zip");
    let outcome = async {
        download_file(&code, &tmp).await?;
        validate_zip_archive(&tmp, "numero.json", "numéro")?;
        import_numero_into_project(tmp.to_string_lossy().to_string(), project_path)
    }
    .await;
    let _ = fs::remove_file(&tmp);
    outcome
}

#[tauri::command]
pub async fn import_numero_from_cloud(code: String, dest_folder: String) -> Result<Project, String> {
    let tmp = temp_archive_path("zip");
    let outcome = async {
        download_file(&code, &tmp).await?;
        validate_zip_archive(&tmp, "numero.json", "numéro")?;
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
