// End-to-end round trips over the file operations a show goes through:
// create, add audio, save, reopen, export, import. They pin the behaviour the
// Android port must not change on desktop, and they would catch a refactor of
// the shared file handling that loses a field, a file or a flag on the way.

use std::fs;
use std::path::{Path, PathBuf};

use crate::archive::{
    export_numero, export_project, import_numero_into_project, import_numero_standalone,
    import_project,
};
use crate::types::{PauseItem, PlaylistItem, Project};
use crate::{
    copy_audio_file, create_numero, create_project, open_project_from_file, save_project_to_disk,
};

fn scratch_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("regie-son-roundtrip-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn path_str(p: &Path) -> String {
    p.to_string_lossy().to_string()
}

// A track with every setting a show uses, including `loop`, which Rust only
// carries through its catch-all `extra` map.
fn add_track(project: &mut Project, source: &Path, bytes: &[u8]) {
    fs::write(source, bytes).unwrap();
    let mut audio = copy_audio_file(path_str(source), project.path.clone()).unwrap();
    audio.volume = 70.0;
    audio.start_time = Some(1.5);
    audio.end_time = Some(42.0);
    audio.fade_in = Some(2.0);
    audio.fade_out = Some(3.0);
    audio.cue = Some("Top lumière".into());
    audio
        .extra
        .insert("loop".into(), serde_json::Value::Bool(true));
    let pause = PauseItem {
        id: uuid::Uuid::new_v4().to_string(),
        cue: Some("Attendre le salut".into()),
        duration: Some(8.0),
        extra: Default::default(),
    };
    let numero = project.numeros.first_mut().expect("a numero to fill");
    numero.items.push(PlaylistItem::Audio(audio));
    numero.items.push(PlaylistItem::Pause(pause));
}

// Everything but the location and the generated ids, which imports renew.
fn content(project: &Project) -> serde_json::Value {
    let mut v = serde_json::to_value(project).unwrap();
    v.as_object_mut().unwrap().remove("path");
    v
}

fn audio_filenames(project: &Project) -> Vec<String> {
    project
        .numeros
        .iter()
        .flat_map(|n| n.items.iter())
        .filter_map(|i| match i {
            PlaylistItem::Audio(a) => Some(a.filename.clone()),
            PlaylistItem::Pause(_) => None,
        })
        .collect()
}

fn read_audio(project: &Project, filename: &str) -> Vec<u8> {
    fs::read(Path::new(&project.path).join("musiques").join(filename)).unwrap()
}

#[test]
fn a_show_survives_save_reopen_export_and_import() {
    let dir = scratch_dir();
    let show_dir = dir.join("Show");
    let mut show = create_project("Gala".into(), path_str(&show_dir)).unwrap();
    // create_project starts empty: give it a numero like the editor does.
    show.numeros.push(crate::types::Numero {
        id: uuid::Uuid::new_v4().to_string(),
        numero_type: "numero".into(),
        name: "Ouverture".into(),
        items: vec![],
        extra: Default::default(),
    });
    add_track(&mut show, &dir.join("Intro.mp3"), b"ID3 fake mp3 bytes");
    save_project_to_disk(&show).unwrap();

    let reopened = open_project_from_file(&show_dir, "projet.json").unwrap();
    assert_eq!(content(&reopened), content(&show));
    assert_eq!(reopened.path, show.path);

    let archive = dir.join("gala.regieson");
    export_project(show.path.clone(), path_str(&archive)).unwrap();
    let imported = import_project(path_str(&archive), path_str(&dir.join("Imported"))).unwrap();
    assert_eq!(content(&imported), content(&show));
    let file = &audio_filenames(&show)[0];
    assert_eq!(read_audio(&imported, file), b"ID3 fake mp3 bytes");

    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn an_act_survives_the_standalone_round_trip() {
    let dir = scratch_dir();
    let act_dir = dir.join("Act");
    let mut act = create_numero("Jonglage".into(), path_str(&act_dir)).unwrap();
    assert_eq!(act.single_numero, Some(true));
    add_track(&mut act, &dir.join("Balles.wav"), b"RIFF fake wav");
    save_project_to_disk(&act).unwrap();

    // An act is saved to numero.json, never to projet.json.
    assert!(act_dir.join("numero.json").exists());
    assert!(!act_dir.join("projet.json").exists());
    let reopened = open_project_from_file(&act_dir, "numero.json").unwrap();
    assert_eq!(content(&reopened), content(&act));

    let archive = dir.join("jonglage.regiesonnumero");
    export_numero(act.path.clone(), path_str(&archive)).unwrap();
    let imported =
        import_numero_standalone(path_str(&archive), path_str(&dir.join("Imported"))).unwrap();
    assert_eq!(imported.single_numero, Some(true));
    assert_eq!(content(&imported), content(&act));

    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn an_act_imported_into_a_show_keeps_its_settings_under_new_ids() {
    let dir = scratch_dir();
    let act_dir = dir.join("Act");
    let mut act = create_numero("Jonglage".into(), path_str(&act_dir)).unwrap();
    add_track(&mut act, &dir.join("Balles.wav"), b"RIFF fake wav");
    save_project_to_disk(&act).unwrap();
    let archive = dir.join("jonglage.regiesonnumero");
    export_numero(act.path.clone(), path_str(&archive)).unwrap();

    let show_dir = dir.join("Show");
    let show = create_project("Gala".into(), path_str(&show_dir)).unwrap();
    let merged = import_numero_into_project(path_str(&archive), show.path.clone()).unwrap();

    assert_eq!(merged.numeros.len(), 1);
    let (from, to) = (&act.numeros[0], &merged.numeros[0]);
    assert_ne!(to.id, from.id, "a fresh numero id avoids clashes");
    assert_eq!(to.name, from.name);
    let (PlaylistItem::Audio(a), PlaylistItem::Audio(b)) = (&from.items[0], &to.items[0]) else {
        panic!("the first item should stay a track");
    };
    assert_ne!(
        b.filename, a.filename,
        "the file is copied under a new name"
    );
    assert_eq!(
        (
            b.volume,
            b.start_time,
            b.end_time,
            b.fade_in,
            b.fade_out,
            &b.cue
        ),
        (
            a.volume,
            a.start_time,
            a.end_time,
            a.fade_in,
            a.fade_out,
            &a.cue
        )
    );
    assert_eq!(b.extra.get("loop"), Some(&serde_json::Value::Bool(true)));
    assert_eq!(read_audio(&merged, &b.filename), b"RIFF fake wav");
    let PlaylistItem::Pause(p) = &to.items[1] else {
        panic!("the second item should stay a pause")
    };
    assert_eq!(
        (p.duration, p.cue.as_deref()),
        (Some(8.0), Some("Attendre le salut"))
    );

    // The show on disk holds the imported act too.
    let reopened = open_project_from_file(&show_dir, "projet.json").unwrap();
    assert_eq!(content(&reopened), content(&merged));

    fs::remove_dir_all(&dir).unwrap();
}
