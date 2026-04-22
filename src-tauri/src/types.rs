use serde::{Deserialize, Serialize};

pub fn default_volume() -> f64 { 100.0 }

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AudioFile {
    pub id: String,
    pub filename: String,
    pub original_name: String,
    #[serde(default = "default_volume")]
    pub volume: f64,
    #[serde(skip_serializing_if = "Option::is_none", rename = "startTime")]
    pub start_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "endTime")]
    pub end_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "fadeIn")]
    pub fade_in: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "fadeOut")]
    pub fade_out: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "note")]
    pub cue: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PauseItem {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none", alias = "note")]
    pub cue: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum PlaylistItem {
    Audio(AudioFile),
    Pause(PauseItem),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Numero {
    pub id: String,
    #[serde(rename = "type")]
    pub numero_type: String,
    pub name: String,
    pub items: Vec<PlaylistItem>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub name: String,
    pub path: String,
    pub numeros: Vec<Numero>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "singleNumero")]
    pub single_numero: Option<bool>,
}

// ===== Legacy format migration =====

#[derive(Deserialize)]
struct LegacyAudioFile {
    id: String,
    filename: String,
    original_name: String,
}

#[derive(Deserialize)]
struct LegacyNumero {
    id: String,
    #[serde(rename = "type")]
    numero_type: String,
    name: String,
    #[serde(default)]
    audio_files: Vec<LegacyAudioFile>,
    #[serde(default)]
    items: Vec<serde_json::Value>,
}

#[derive(Deserialize)]
struct LegacyProject {
    name: String,
    numeros: Vec<LegacyNumero>,
    #[serde(default, rename = "singleNumero")]
    single_numero: Option<bool>,
}

pub fn migrate_project(raw: &str, path: String) -> Result<Project, String> {
    let legacy: LegacyProject = serde_json::from_str(raw)
        .map_err(|e| format!("Fichier projet invalide : {}", e))?;
    let numeros: Result<Vec<Numero>, String> = legacy.numeros.into_iter().map(|n| {
        let items: Vec<PlaylistItem> = if !n.items.is_empty() {
            serde_json::from_value(serde_json::Value::Array(n.items))
                .map_err(|e| format!("Items invalides pour « {} » : {}", n.name, e))?
        } else {
            n.audio_files.into_iter().map(|af| PlaylistItem::Audio(AudioFile {
                id: af.id,
                filename: af.filename,
                original_name: af.original_name,
                volume: 100.0,
                start_time: None,
                end_time: None,
                fade_in: None,
                fade_out: None,
                cue: None,
            })).collect()
        };
        Ok(Numero { id: n.id, numero_type: n.numero_type, name: n.name, items })
    }).collect();
    Ok(Project { name: legacy.name, path, numeros: numeros?, single_numero: legacy.single_numero })
}

#[derive(Serialize)]
pub struct VerifyResult {
    pub missing: Vec<String>,
    pub orphans: Vec<String>,
}
