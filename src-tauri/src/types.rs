use serde::{Deserialize, Serialize};

use crate::error::{fail, AppError, AppResult};

pub fn default_volume() -> f64 {
    100.0
}

pub type Extra = serde_json::Map<String, serde_json::Value>;

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
    // Fields this version does not know, written by a newer one: kept so
    // that opening and saving here does not erase them.
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PauseItem {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none", alias = "note")]
    pub cue: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    #[serde(flatten)]
    pub extra: Extra,
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
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub name: String,
    // Where the project lives, for the frontend only: empty in the files on
    // disk, since the folder a file is read from is its path anyway.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub path: String,
    pub numeros: Vec<Numero>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "singleNumero"
    )]
    pub single_numero: Option<bool>,
    #[serde(flatten)]
    pub extra: Extra,
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
    #[serde(flatten)]
    extra: Extra,
}

#[derive(Deserialize)]
struct LegacyProject {
    name: String,
    numeros: Vec<LegacyNumero>,
    #[serde(default, rename = "singleNumero")]
    single_numero: Option<bool>,
    #[serde(flatten)]
    extra: Extra,
}

pub fn migrate_project(raw: &str, path: String) -> AppResult<Project> {
    let legacy: LegacyProject = serde_json::from_str(raw).map_err(fail("project.invalidFile"))?;
    let numeros: AppResult<Vec<Numero>> = legacy
        .numeros
        .into_iter()
        .map(|n| {
            let items: Vec<PlaylistItem> = if !n.items.is_empty() {
                serde_json::from_value(serde_json::Value::Array(n.items)).map_err(|e| {
                    AppError::new("project.invalidItems")
                        .with("name", &n.name)
                        .detail(e)
                })?
            } else {
                n.audio_files
                    .into_iter()
                    .map(|af| {
                        PlaylistItem::Audio(AudioFile {
                            id: af.id,
                            filename: af.filename,
                            original_name: af.original_name,
                            volume: 100.0,
                            start_time: None,
                            end_time: None,
                            fade_in: None,
                            fade_out: None,
                            cue: None,
                            extra: Extra::new(),
                        })
                    })
                    .collect()
            };
            Ok(Numero {
                id: n.id,
                numero_type: n.numero_type,
                name: n.name,
                items,
                extra: n.extra,
            })
        })
        .collect();
    // The folder a project was read from is its path, whatever the file says.
    let mut extra = legacy.extra;
    extra.remove("path");
    Ok(Project {
        name: legacy.name,
        path,
        numeros: numeros?,
        single_numero: legacy.single_numero,
        extra,
    })
}

#[derive(Serialize)]
pub struct VerifyResult {
    pub missing: Vec<String>,
    pub orphans: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn audio_of(item: &PlaylistItem) -> &AudioFile {
        match item {
            PlaylistItem::Audio(a) => a,
            PlaylistItem::Pause(_) => panic!("expected an audio item"),
        }
    }

    #[test]
    fn legacy_audio_files_become_audio_items() {
        let raw = r#"{
            "name": "Old show",
            "numeros": [{
                "id": "n1", "type": "numero", "name": "Act 1",
                "audio_files": [
                    { "id": "a1", "filename": "a1.mp3", "original_name": "Intro.mp3" },
                    { "id": "a2", "filename": "a2.wav", "original_name": "Bows.wav" }
                ]
            }]
        }"#;
        let p = migrate_project(raw, "/shows/old".into()).unwrap();
        assert_eq!(p.path, "/shows/old");
        assert_eq!(p.numeros[0].items.len(), 2);
        let a = audio_of(&p.numeros[0].items[1]);
        assert_eq!(a.filename, "a2.wav");
        assert_eq!(a.original_name, "Bows.wav");
        assert_eq!(a.volume, 100.0);
    }

    #[test]
    fn current_items_are_kept_as_they_are() {
        let raw = r#"{
            "name": "Show", "singleNumero": true,
            "numeros": [{
                "id": "n1", "type": "entracte", "name": "Intermission",
                "items": [
                    { "type": "audio", "id": "a1", "filename": "a1.mp3", "original_name": "A",
                      "volume": 40, "startTime": 1.5, "endTime": 30, "fadeIn": 2, "fadeOut": 3, "cue": "go" },
                    { "type": "pause", "id": "p1", "duration": 90, "note": "wait" }
                ]
            }]
        }"#;
        let p = migrate_project(raw, "/s".into()).unwrap();
        assert_eq!(p.single_numero, Some(true));
        assert_eq!(p.numeros[0].numero_type, "entracte");
        let a = audio_of(&p.numeros[0].items[0]);
        assert_eq!(
            (a.volume, a.start_time, a.end_time),
            (40.0, Some(1.5), Some(30.0))
        );
        assert_eq!(
            (a.fade_in, a.fade_out, a.cue.as_deref()),
            (Some(2.0), Some(3.0), Some("go"))
        );
        match &p.numeros[0].items[1] {
            // "note" is the old name of "cue".
            PlaylistItem::Pause(pause) => assert_eq!(
                (pause.duration, pause.cue.as_deref()),
                (Some(90.0), Some("wait"))
            ),
            PlaylistItem::Audio(_) => panic!("expected a pause"),
        }
    }

    #[test]
    fn a_missing_volume_defaults_to_full() {
        let raw = r#"{ "name": "S", "numeros": [{ "id": "n", "type": "numero", "name": "N",
            "items": [{ "type": "audio", "id": "a", "filename": "a.mp3", "original_name": "A" }] }] }"#;
        let p = migrate_project(raw, "/s".into()).unwrap();
        assert_eq!(audio_of(&p.numeros[0].items[0]).volume, 100.0);
    }

    #[test]
    fn broken_files_are_reported_with_their_code() {
        assert_eq!(
            migrate_project("not json", "/s".into()).unwrap_err().code,
            "project.invalidFile"
        );
        let bad_item = r#"{ "name": "S", "numeros": [{ "id": "n", "type": "numero", "name": "N",
            "items": [{ "type": "video", "id": "x" }] }] }"#;
        let err = migrate_project(bad_item, "/s".into()).unwrap_err();
        assert_eq!(err.code, "project.invalidItems");
    }

    #[test]
    fn fields_from_a_newer_version_survive_a_round_trip() {
        let raw = r#"{ "name": "S", "path": "/elsewhere", "futureShow": {"x": 1},
            "numeros": [{ "id": "n", "type": "numero", "name": "N", "futureAct": [1, 2],
            "items": [
                { "type": "audio", "id": "a", "filename": "a.mp3", "original_name": "A", "futureTrack": "t" },
                { "type": "pause", "id": "p", "futurePause": true }
            ] }] }"#;
        let project = migrate_project(raw, "/s".into()).unwrap();
        let saved = serde_json::to_value(&project).unwrap();
        assert_eq!(saved["path"], "/s");
        assert_eq!(saved["futureShow"]["x"], 1);
        let numero = &saved["numeros"][0];
        assert_eq!(numero["futureAct"], serde_json::json!([1, 2]));
        assert_eq!(numero["items"][0]["futureTrack"], "t");
        assert_eq!(numero["items"][0]["type"], "audio");
        assert_eq!(numero["items"][1]["futurePause"], true);
        // The tag is the enum's, never duplicated into the extra fields.
        assert!(audio_of(&project.numeros[0].items[0])
            .extra
            .get("type")
            .is_none());

        let again = migrate_project(&saved.to_string(), "/s".into()).unwrap();
        assert_eq!(serde_json::to_value(&again).unwrap(), saved);
    }

    #[test]
    fn a_saved_project_reads_back_identically() {
        let raw = r#"{ "name": "S", "numeros": [{ "id": "n", "type": "numero", "name": "N",
            "items": [{ "type": "audio", "id": "a", "filename": "a.mp3", "original_name": "A", "volume": 70, "fadeOut": 4 }] }] }"#;
        let first = migrate_project(raw, "/s".into()).unwrap();
        let saved = serde_json::to_string(&first).unwrap();
        let second = migrate_project(&saved, "/s".into()).unwrap();
        assert_eq!(
            serde_json::to_value(&first).unwrap(),
            serde_json::to_value(&second).unwrap()
        );
    }
}
