use std::fs;
use std::path::{Path, PathBuf};

use crate::archive::{export_to_zip, extract_zip_to, import_numero_into_project};
use crate::download::download_client;
use crate::error::{fail, missing, AppError, AppResult};
use crate::file_assoc::pick_unique_path;
use crate::types::{migrate_project, Project};
use crate::{ensure_no_project, open_project_from_file, save_project_to_disk};

// Litterbox (sister of catbox.moe) — anonymous uploads, no account required,
// files expire after the chosen retention. We use 72h, the maximum.
const UPLOAD_URL: &str = "https://litterbox.catbox.moe/resources/internals/api.php";
const DOWNLOAD_BASE: &str = "https://litter.catbox.moe";
const RETENTION: &str = "72h";
const MAX_CLOUD_FILE_SIZE: u64 = 1024 * 1024 * 1024; // 1 GB (Litterbox limit per file)

// reqwest's read timeout also bounds the wait for the response headers,
// which only come once the whole body is sent: an upload cannot use it. It
// gets a deadline that grows with the file instead, at a floor of 64 KB/s.
fn upload_timeout(len: u64) -> std::time::Duration {
    std::time::Duration::from_secs(120 + len / (64 * 1024))
}

fn upload_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(crate::download::CONNECT_TIMEOUT)
        .build()
        .map_err(fail("cloud.httpClientFailed"))
}

// Returns the short code (filename stem) extracted from the Litterbox URL.
async fn upload_file(path: &Path) -> AppResult<String> {
    let metadata = fs::metadata(path).map_err(fail("cloud.readMetadataFailed"))?;
    if metadata.len() > MAX_CLOUD_FILE_SIZE {
        return Err(AppError::new("cloud.fileTooLarge")
            .with("size", metadata.len() / (1024 * 1024))
            .with("limit", MAX_CLOUD_FILE_SIZE / (1024 * 1024)));
    }

    let bytes = fs::read(path).map_err(fail("io.readFileFailed"))?;
    let filename = path
        .file_name()
        .ok_or_else(missing("io.invalidFilename"))?
        .to_string_lossy()
        .to_string();

    let part = reqwest::multipart::Part::bytes(bytes).file_name(filename);
    let form = reqwest::multipart::Form::new()
        .text("reqtype", "fileupload")
        .text("time", RETENTION)
        .part("fileToUpload", part);

    let client = upload_client()?;
    let resp = client
        .post(UPLOAD_URL)
        .timeout(upload_timeout(metadata.len()))
        .multipart(form)
        .send()
        .await
        .map_err(fail("cloud.connectionFailed"))?;

    if !resp.status().is_success() {
        return Err(AppError::new("cloud.serviceHttpError").with("status", resp.status().as_u16()));
    }

    let body = resp
        .text()
        .await
        .map_err(fail("cloud.unexpectedResponse"))?
        .trim()
        .to_string();
    if !body.starts_with("https://") {
        return Err(AppError::new("cloud.unexpectedResponse").detail(&body));
    }
    // Body is the full URL e.g. "https://litter.catbox.moe/abc123.zip".
    // Strip the path and the file extension to keep just the short code.
    let stem = body
        .rsplit('/')
        .next()
        .and_then(|seg| seg.split('.').next())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::new("cloud.unexpectedUrl").detail(&body))?;
    Ok(stem.to_string())
}

// Always downloads <code>.zip — share_*_on_cloud uploads as .zip so the
// extension on Litterbox is always known.
async fn download_file(code: &str, dest: &Path) -> AppResult<()> {
    let trimmed = code.trim();
    if trimmed.is_empty() || !trimmed.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(AppError::new("cloud.invalidCode"));
    }

    let client = download_client()?;
    let url = format!("{}/{}.zip", DOWNLOAD_BASE, trimmed);
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(fail("cloud.connectionFailed"))?;

    if resp.status().as_u16() == 404 {
        return Err(AppError::new("cloud.codeNotFound"));
    }
    if !resp.status().is_success() {
        return Err(AppError::new("cloud.serviceHttpError").with("status", resp.status().as_u16()));
    }

    if let Some(len) = resp.content_length() {
        if len > MAX_CLOUD_FILE_SIZE {
            return Err(AppError::new("cloud.remoteFileTooLarge").with("size", len / (1024 * 1024)));
        }
    }

    let bytes = resp.bytes().await.map_err(fail("io.readFailed"))?;
    fs::write(dest, &bytes).map_err(fail("io.writeFailed"))?;
    Ok(())
}

fn temp_archive_path(ext: &str) -> PathBuf {
    let id = uuid::Uuid::new_v4().to_string();
    std::env::temp_dir().join(format!("regieson-{}.{}", id, ext))
}

// Validate a downloaded archive before we commit to extracting it. Catches
// codes that point to unrelated files / wrong-kind archives so we don't
// pollute the target folder, and guides the user when the code is for the
// other Régie Son share kind.
fn validate_zip_archive(zip_path: &Path, expected_json: &str) -> AppResult<()> {
    use std::io::Read;
    let file = fs::File::open(zip_path).map_err(fail("cloud.readDownloadedFailed"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|_| AppError::new("cloud.notAnArchive"))?;

    let expecting_show = expected_json == "projet.json";
    let other_json = if expecting_show {
        "numero.json"
    } else {
        "projet.json"
    };

    let names: Vec<String> = archive.file_names().map(String::from).collect();
    let has_expected = names.iter().any(|n| n == expected_json);
    let has_other = names.iter().any(|n| n == other_json);

    if !has_expected {
        if has_other {
            return Err(AppError::new(if expecting_show {
                "cloud.sharedActNotShow"
            } else {
                "cloud.sharedShowNotAct"
            }));
        }
        return Err(AppError::new(if expecting_show {
            "cloud.notAShow"
        } else {
            "cloud.notAnAct"
        }));
    }

    let mut entry = archive
        .by_name(expected_json)
        .map_err(|_| AppError::new("archive.corrupt").with("name", expected_json))?;
    let mut content = String::new();
    entry
        .read_to_string(&mut content)
        .map_err(|_| AppError::new("archive.corrupt").with("name", expected_json))?;
    migrate_project(&content, String::new()).map_err(fail("archive.invalid"))?;
    Ok(())
}

#[tauri::command]
pub async fn share_project_on_cloud(project_path: String) -> AppResult<String> {
    let tmp = temp_archive_path("zip");
    export_to_zip(
        Path::new(&project_path),
        &tmp.to_string_lossy(),
        "projet.json",
    )?;
    let result = upload_file(&tmp).await;
    let _ = fs::remove_file(&tmp);
    result
}

#[tauri::command]
pub async fn share_numero_on_cloud(numero_path: String) -> AppResult<String> {
    let tmp = temp_archive_path("zip");
    export_to_zip(
        Path::new(&numero_path),
        &tmp.to_string_lossy(),
        "numero.json",
    )?;
    let result = upload_file(&tmp).await;
    let _ = fs::remove_file(&tmp);
    result
}

#[tauri::command]
pub async fn import_project_from_cloud(code: String, dest_folder: String) -> AppResult<Project> {
    let tmp = temp_archive_path("zip");
    let outcome = async {
        download_file(&code, &tmp).await?;
        validate_zip_archive(&tmp, "projet.json")?;
        // The same code imported twice must not overwrite the first copy,
        // which may have been edited since.
        let dest = pick_unique_path(&PathBuf::from(&dest_folder));
        ensure_no_project(&dest)?;
        extract_zip_to(&tmp.to_string_lossy(), &dest)?;
        open_project_from_file(&dest, "projet.json").map_err(fail("archive.invalid"))
    }
    .await;
    let _ = fs::remove_file(&tmp);
    outcome
}

#[tauri::command]
pub async fn import_numero_from_cloud_into_project(
    code: String,
    project_path: String,
) -> AppResult<Project> {
    let tmp = temp_archive_path("zip");
    let outcome = async {
        download_file(&code, &tmp).await?;
        validate_zip_archive(&tmp, "numero.json")?;
        import_numero_into_project(tmp.to_string_lossy().to_string(), project_path)
    }
    .await;
    let _ = fs::remove_file(&tmp);
    outcome
}

#[tauri::command]
pub async fn import_numero_from_cloud(code: String, dest_folder: String) -> AppResult<Project> {
    let tmp = temp_archive_path("zip");
    let outcome = async {
        download_file(&code, &tmp).await?;
        validate_zip_archive(&tmp, "numero.json")?;
        // The same code imported twice must not overwrite the first copy,
        // which may have been edited since.
        let dest = pick_unique_path(&PathBuf::from(&dest_folder));
        ensure_no_project(&dest)?;
        extract_zip_to(&tmp.to_string_lossy(), &dest)?;
        let mut project =
            open_project_from_file(&dest, "numero.json").map_err(fail("archive.invalid"))?;
        project.single_numero = Some(true);
        save_project_to_disk(&project)?;
        Ok(project)
    }
    .await;
    let _ = fs::remove_file(&tmp);
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upload_deadline_grows_with_the_file() {
        assert_eq!(upload_timeout(0).as_secs(), 120);
        // A full 1 GB share at 64 KB/s: a little over four and a half hours.
        assert_eq!(upload_timeout(MAX_CLOUD_FILE_SIZE).as_secs(), 120 + 16384);
    }
}
