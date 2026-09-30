# Régie Son — Documentation technique

Application desktop (Tauri 2) de pilotage audio pour spectacles cabaret. Le régisseur prépare un projet (numéros, entractes, présentations). Chaque numéro contient une liste de pistes audio et de pauses, et la lecture s'enchaîne pendant le spectacle avec fondus, extrait début/fin, volume par piste et sortie audio configurable.

- **Cible** : Linux x86_64, Windows x86_64, macOS x86_64 et aarch64
- **Dev unique** : pcomble
- **Langue UI** : français et anglais (i18next, repli sur le français) — **Code** : anglais
- **Projet** : dossier contenant `projet.json` + `musiques/`
- **Numéro isolé** : dossier contenant `numero.json` + `musiques/` (même structure `Project`, avec `singleNumero: true`)
- **Archives portables** : `.regieson` (spectacle) et `.regiesonnumero` (numéro), des zip du dossier

Les conventions de code (i18n, erreurs Rust, patterns React) sont dans [CLAUDE.md](CLAUDE.md). Ce document décrit l'architecture. Il cite des fichiers et des symboles, jamais des numéros de ligne, qui périment à chaque modification.

---

## 1. Architecture

```
┌───────────────────────────────────────────────────────────────┐
│ Frontend React 19 + TypeScript (Vite)                         │
│  App.tsx ── HomePage (récents, création, import)              │
│         └─ ProjectEditor ── NumeroCard × N ── AudioItem       │
│                          │                  └─ PauseTrack     │
│                          └─ PlayerBar                          │
│  hooks : usePlayer, useSettings, useRecentProjects,           │
│          useRecentNumeros, useUpdater, useBattery,            │
│          useAudioDurations, useModal                          │
│  lecture : <audio> alimenté en flux par le protocole asset    │
└───────────────────────────────────────────────────────────────┘
                 │ invoke() / listen()          │ asset://
                 ▼                              ▼
┌───────────────────────────────────────────────────────────────┐
│ Backend Rust + Tauri 2 (src-tauri/src/)                       │
│  lib.rs        projets, fichiers audio, scope asset, run()    │
│  types.rs      modèle de données + migration de l'ancien      │
│                schéma                                         │
│  archive.rs    export / import .regieson et .regiesonnumero   │
│  cloud.rs      partage et import par code (Litterbox)         │
│  download.rs   URL directe, yt-dlp, mise à jour de yt-dlp     │
│  file_assoc.rs ouverture par double-clic                      │
│  show_mode.rs  mode spectacle : notifications système         │
│  sleep_guard.rs mode spectacle : blocage de la mise en veille │
│  audio_session.rs  nom de la session audio (Windows)          │
│  battery.rs    état de la batterie                            │
│  error.rs      AppError { code, detail, params }              │
└───────────────────────────────────────────────────────────────┘
```

### Stack

| Couche | Choix |
|---|---|
| Fenêtre native | Tauri 2 |
| UI | React 19, TypeScript, Vite 7 |
| State | hooks custom + prop drilling (pas de Redux ni de Zustand) |
| Traduction | i18next + react-i18next, outillage i18next-cli (extraction, types, lint) |
| Lecture audio | `HTMLAudioElement`, source `convertFileSrc(<projet>/musiques/<fichier>)` |
| Forme d'onde | wavesurfer.js + plugin regions (réglages d'une piste) |
| Icônes | lucide-react |
| Glisser-déposer | @dnd-kit (souris et clavier) |
| Mise à jour | tauri-plugin-updater, signatures minisign |
| Réseau | reqwest 0.12 (rustls) + sidecar yt-dlp |
| Archives | zip 4 (entrées audio stockées, sans recompression) |
| Tests | Vitest (jsdom pour les hooks) et `cargo test` |

---

## 2. Modèle de données

Défini côté Rust dans [types.rs](src-tauri/src/types.rs) et côté TypeScript dans [types.ts](src/types.ts). Les deux doivent rester synchronisés ; les types TypeScript font foi pour le format JSON.

```ts
interface AudioFile {
  type: "audio";
  id: string;
  filename: string;       // nom du fichier dans musiques/ (UUID + extension)
  original_name: string;  // snake_case : pas de rename serde
  volume: number;         // 0–100
  startTime?: number;     // secondes, camelCase via serde rename
  endTime?: number;
  fadeIn?: number;
  fadeOut?: number;
  cue?: string;           // top de départ ; "note" est accepté en lecture
}

interface PauseItem {
  type: "pause";
  id: string;
  cue?: string;
  duration?: number;      // pause minutée : avance seule au bout du délai
}

type NumeroType = "numero" | "entracte" | "presentation";  // valeurs persistées, jamais traduites

interface Numero { id: string; type: NumeroType; name: string; items: (AudioFile | PauseItem)[] }
interface Project { name: string; path: string; numeros: Numero[]; singleNumero?: boolean }
```

**Migration** : `migrate_project` lit tout fichier de projet. Il convertit l'ancien schéma (`audio_files[]` dans chaque numéro) en `items[]`, et accepte `note` comme ancien nom de `cue`. Ses cas sont couverts par les tests de `types.rs`.

---

## 3. Backend

### 3.1 Commandes Tauri

Enregistrées dans `run()` ([lib.rs](src-tauri/src/lib.rs)). Toute commande qui lit ou écrit beaucoup, ou qui ouvre un dialogue `blocking_*`, est `#[tauri::command(async)]` : une commande synchrone tourne sur le thread principal et figerait l'interface.

| Domaine | Commandes |
|---|---|
| Projets | `get_default_projects_dir`, `get_default_numeros_dir`, `create_project`, `open_project`, `save_project`, `create_numero`, `open_numero`, `save_numero` |
| Fichiers audio | `pick_folder`, `pick_audio_files`, `copy_audio_file`, `delete_audio_file`, `verify_project`, `cleanup_orphan_files`, `read_audio_file` |
| Archives | `pick_*_file` / `save_*_file`, `export_project`, `export_numero`, `import_project`, `import_numero_standalone`, `import_numero_into_project` |
| Double-clic | `auto_import_regieson`, `auto_import_regiesonnumero`, `take_pending_open_file` |
| Cloud | `share_project_on_cloud`, `share_numero_on_cloud`, `import_project_from_cloud`, `import_numero_from_cloud`, `import_numero_from_cloud_into_project` |
| Téléchargements | `download_audio_from_url`, `download_youtube_audio`, `cancel_download`, `get_yt_dlp_version`, `update_yt_dlp` |
| Système | `set_show_mode`, `get_battery_status` |

Les erreurs sont des `AppError { code, detail?, params? }` traduites par le frontend (`translateError`). Voir CLAUDE.md, section « Erreurs Rust ».

### 3.2 Accès aux fichiers audio (protocole asset)

`assetProtocol.scope` est vide dans [tauri.conf.json](src-tauri/tauri.conf.json). `grant_audio_access(project_dir)` autorise le seul dossier `<projet>/musiques`, sans récursion, pour chaque projet remis au frontend. Elle est appelée depuis `open_project_from_file` (ouverture, imports, double-clic, cloud), `create_project` et `create_numero`.

**Règle** : tout nouveau chemin qui renvoie un `Project` au frontend doit passer par l'une de ces fonctions, sinon rien ne se lit. Le test `every_project_handed_to_the_frontend_is_granted_to_the_player` la vérifie.

`read_audio_file`, qui ne sert plus qu'à la forme d'onde, n'accepte qu'un fichier situé directement dans un dossier `musiques/` autorisé.

### 3.3 Écriture des projets

`save_project_to_disk` écrit d'abord `projet.json.tmp`, avec `sync_all`, puis le renomme sur `projet.json`. `.bak1` est une **copie**, jamais un renommage, pour que le fichier existe à tout instant. La rotation `.bak1` → `.bak3` a lieu au plus toutes les 10 minutes. `open_project_from_file` retombe sur `.bak1` si le fichier principal manque ou est illisible. Un verrou sérialise les écritures, puisque les imports sauvegardent hors du thread principal.

Créer ou importer dans un dossier qui contient déjà `projet.json` ou `numero.json` est refusé (`project.alreadyExists`).

### 3.4 Archives

- **Export** : `projet.json` est lu et validé avant de toucher la destination. L'archive est écrite dans `<dest>.tmp` puis renommée. Seules les pistes référencées y entrent, stockées sans recompression.
- **Import** : `entry_target` n'accepte que `projet.json`, `numero.json` et `musiques/<fichier>`, et ignore le reste. Un nom qui sortirait du dossier fait échouer l'import : `..`, lettre de lecteur, flux NTFS, barre oblique inverse. Plafonds : 500 Mo par piste, 16 Mo par JSON, 16 Go par archive.

### 3.5 Téléchargements

- **URL directe** : une page web ou un JSON est refusé, et rien n'est écrit tant que les premiers octets ne sont pas reconnus comme de l'audio. Le nom de fichier est décodé en UTF-8 et l'extension passe par une liste blanche.
- **yt-dlp** : l'URL est passée après `--` et doit être en http(s). La phase de téléchargement s'annule par `cancel_download` (`CancelToken` + `DownloadGuard`), et la progression part dans l'événement `yt-dlp-progress`.
- **Délais** : un transfert échoue s'il est bloqué (15 s pour se connecter, 60 s sans données), pas s'il est lent.
- **Mise à jour de yt-dlp** : `update_yt_dlp` compare la dernière version publiée à la version installée. Si elle est plus récente, il télécharge le binaire et `SHA2-256SUMS` du même tag, vérifie l'empreinte, puis l'installe. Un verrou global empêche deux mises à jour simultanées.
- **Sidecar embarqué** : sa version est fixée par `YTDLP_VERSION` dans le workflow de release. Sous Linux, c'est la version Python de yt-dlp : elle demande `python3` sur la machine.

### 3.6 Mode spectacle

`set_show_mode` est asynchrone, sérialisé par un verrou, et mémorise son état en Rust. Il tente toujours ses deux volets et renvoie leurs erreurs séparément (`Vec<AppError>`).

| Volet | Windows | macOS | Linux |
|---|---|---|---|
| Notifications ([show_mode.rs](src-tauri/src/show_mode.rs)) | coupe la session WASAPI SystemSounds | macOS 11 et moins : `defaults` ; macOS 12 et plus : `showMode.macosManual` (réglage Focus à faire à la main) | GNOME : `gsettings show-banners` ; autres bureaux : `showMode.desktopUnsupported` |
| Veille ([sleep_guard.rs](src-tauri/src/sleep_guard.rs)) | `SetThreadExecutionState` sur un thread parqué | `caffeinate -w <pid>` | `systemd-inhibit … cat` |

Le réglage d'avant est relu à l'activation et restauré à la désactivation, ainsi qu'à la fermeture de l'application (`release_on_exit`). Un marqueur dans le dossier de données de l'application permet de le restaurer au lancement suivant après un crash. Le blocage de veille se relâche tout seul si le processus meurt.

---

## 4. Frontend

### 4.1 Orchestration

- [App.tsx](src/App.tsx) bascule entre `HomePage` et `ProjectEditor`. `ProjectEditor` porte `key={project.path}`, donc chaque projet ouvert repart d'un éditeur neuf. App parle à l'éditeur par un `EditorHandle` (`flushSave`, `leaveShowMode`, `importNumeroFile`), ce qui permet d'ouvrir un autre fichier sans perdre de modification.
- [ProjectEditor.tsx](src/components/ProjectEditor.tsx) porte la sauvegarde, l'historique, les raccourcis, le mode spectacle, le preflight, l'export et le partage.
  - **Sauvegarde** ([useAutosave](src/useAutosave.ts)) : `flushSave` sérialise les écritures (différées de 600 ms). Elle est appelée à la fermeture, au démontage, à la fermeture de la fenêtre, et avant un export ou un import.
  - **Historique** ([useProjectHistory](src/useProjectHistory.ts)) : toute modification passe par `update`. Annuler et rétablir sur 50 niveaux, avec des boutons dans l'en-tête et une notification « Annuler » après une suppression.
  - **Mode spectacle** : il verrouille l'édition (`editable = editMode && !showMode`), mais laisse le volume réglable.
  - **Vue spectacle** ([ShowView](src/components/ShowView.tsx), modèle dans [showView.ts](src/showView.ts)) : superposition plein écran, sans édition, ouverte depuis l'en-tête et proposée à l'activation du mode spectacle. Ce n'est pas une modale : les raccourcis restent actifs, Échap compris (Stop). Seul son bouton la ferme.

### 4.2 Hooks et modules

| Module | Rôle |
|---|---|
| [usePlayer](src/usePlayer.ts) | Moteur de lecture (section 5). |
| [playerNav](src/playerNav.ts) | Seule définition de « ce qui vient après » (`firstItemPosition`, `nextItemPosition`), partagée par Suivant, Espace et l'aperçu ; `findItemPosition` retrouve la piste courante par son id. |
| [useFollowActive](src/useFollowActive.ts) | Amène la piste courante à l'écran par le plus court chemin, sauf si l'opérateur vient de faire défiler la liste à la main. |
| [useAudioDurations](src/useAudioDurations.ts) | Mesure la durée de chaque fichier par ses métadonnées. Relancé seulement quand la liste des fichiers change. |
| [preflight](src/preflight.ts) + [preflightMessage](src/preflightMessage.ts) | Vérification avant spectacle : codes d'issue, texte à l'affichage. |
| [useModal](src/useModal.ts) + [Modal](src/components/Modal.tsx) | Pile des modales : Échap ferme la plus haute, `isModalOpen()` coupe les raccourcis du lecteur, focus piégé et rendu. |
| [Toast](src/components/Toast.tsx) | Messages non bloquants, qui remplacent `alert()` : un `alert()` fige le JavaScript de la webview, donc les fondus. |
| [keyBindings](src/keyBindings.ts) | Raccourcis configurables. L'éditeur ignore la répétition automatique, sauf pour l'avance et le recul. |
| [trackTimes](src/trackTimes.ts), [slug](src/slug.ts), [duration](src/duration.ts), [mime](src/mime.ts) | Utilitaires purs, testés. |
| [errorMessage](src/errorMessage.ts) | `translateError` pour les `AppError`. |
| useSettings, useRecentProjects, useRecentNumeros, useUpdater, useBattery | Réglages, listes récentes, mise à jour (inaccessible pendant le spectacle), batterie. |
| [storage](src/storage.ts) | Lecture validée du `localStorage` (listes récentes, raccourcis) et écriture qui ne lève jamais. Ce qui ne correspond pas au format attendu est ignoré. |

### 4.3 CSS

Fichiers dans [src/styles/](src/styles/), importés par [App.css](src/App.css). Les variables sont dans `:root`, dans `base.css`. La chaîne `html, body, #root` → `height: 100%; overflow: hidden` est critique : toute dérogation casse le défilement de `.editor-body`. Les modales défilent en interne.

---

## 5. Moteur de lecture ([usePlayer.ts](src/usePlayer.ts))

`usePlayer(project, audioDeviceId)` renvoie `{ state, playAt, togglePlay, next, stop, seek }`. `state` contient :
- `position` : `{ numeroIndex, audioIndex }`, dérivée à chaque rendu de l'id de la piste courante ;
- `isPlaying` ;
- `progress`, relatif à l'extrait `[startTime, endTime]` ;
- `fade` ;
- `audioError` ;
- `outputError`.

Principes :

- **Piste suivie par id**, pas par index : éditer la liste pendant la lecture ne déplace pas la piste courante. Si elle est supprimée, Suivant reprend à son ancienne place.
- **Garde de version** : `loadVersionRef` est incrémenté par `playAt`, `stop`, le passage sur une pause et le démontage. Une lecture dont la version a changé ne démarre pas.
- **Lecture en flux** : `audio.src = convertFileSrc(...)`, sans transfert IPC ni copie en mémoire.
- **Minuteries plutôt que `requestAnimationFrame`** : les fondus et les pauses minutées sont calculés sur l'heure réelle par `setInterval`. Un `rAF` s'arrête quand la fenêtre est masquée. La fenêtre est aussi configurée pour ne pas être bridée en arrière-plan (`backgroundThrottling`, options de WebView2).
- **Fondus** : le fondu de sortie automatique commence `fadeOut` secondes avant `endTime` (ou la fin du fichier). Une fin naturelle enchaîne sans blanc. Pause et reprise font un fondu de 150 ms, et Stop de 250 ms.
- **Fin du spectacle** : le lecteur s'arrête proprement.
- **Sortie audio** : `setSinkId` est réappliqué à chaque changement et à chaque `devicechange`, et un échec remplit `outputError`. `setSinkId` n'existe que dans Chromium (WebView2) ; ailleurs, le preflight signale que le choix de sortie est ignoré.
- **Patterns** : ref-sync (`stateRef`, `projectRef`) pour des callbacks stables, et références croisées (`playAtRef`, `advanceRef`, `stopRef`) pour les listeners installés au montage.

Les tests ([usePlayer.test.tsx](src/usePlayer.test.tsx)) tournent sous jsdom avec un faux élément `<audio>`. Ils couvrent Stop pendant un chargement, un échec de chargement suivi de Suivant, une édition autour de la piste courante, la fin du spectacle, une pause minutée, la progression relative et le fondu avant `endTime`.

---

## 6. Configuration Tauri

- **[tauri.conf.json](src-tauri/tauri.conf.json)**
  - CSP stricte : `script-src 'self'`, `object-src`, `base-uri`, `form-action` et `frame-ancestors` à `'none'`.
  - `assetProtocol.scope` vide (section 3.2).
  - Fenêtre avec `backgroundThrottling: "disabled"` et les options WebView2 qui désactivent la mise en veille des minuteries.
  - Updater : `plugins.updater.pubkey` et l'endpoint `latest.json` de la dernière release.
  - **La clé minisign ne doit jamais être régénérée.**
- **[capabilities/default.json](src-tauri/capabilities/default.json)**
  - `core:default` ;
  - `core:window:allow-destroy`, pour que la fenêtre se ferme après la sauvegarde ;
  - `dialog:default` ;
  - `updater:default` ;
  - `process:allow-restart`, pour relancer après une mise à jour ;
  - `opener:default`.
- **[Cargo.toml](src-tauri/Cargo.toml)**
  - Profil release : LTO, une seule unité de compilation, symboles retirés, `panic = "unwind"` conservé, pour qu'une panique dans une commande ne tue pas l'application en plein spectacle.
  - `windows` 0.61 et `zip` 4, alignés sur les versions de Tauri.
  - reqwest reste en 0.12 : passer en 0.13 change le backend TLS.

---

## 7. CI et release

- **[ci.yml](.github/workflows/ci.yml)**, sur chaque push et chaque PR :
  - frontend : `i18n:check`, types i18n à jour, ESLint (règles des hooks React), tests, build Vite ;
  - Rust sous Linux, Windows et macOS : `cargo fmt --check` (sous Linux), `clippy -D warnings`, `cargo test`.
  - C'est le seul endroit où le code `#[cfg(windows)]` et `#[cfg(macos)]` est compilé avant une release.
- **[release.yml](.github/workflows/release.yml)**, sur un tag `v*` :
  1. **Brouillon** : création du brouillon de release.
  2. **Vérifications** : même contrôle que la CI côté frontend.
  3. **Builds** : quatre builds signés par minisign. yt-dlp est épinglé et vérifié par SHA-256, et la version est patchée depuis le tag.
  4. **`finalize`** : renommage des fichiers, contrôle que les quatre plateformes figurent dans `latest.json`, puis publication. S'il manque une plateforme, la release reste en brouillon.
- **Sécurité du workflow** : les actions sont épinglées par SHA de commit et tenues à jour par [Dependabot](.github/dependabot.yml). Le workflow est en lecture seule, sauf les trois jobs qui créent, remplissent et publient la release.
- **Deux tags d'affilée** : attendre la fin de la release précédente avant de pousser le tag suivant. Sinon, une release plus ancienne qui se termine après une plus récente redevient la « dernière » pour l'updater.

---

## 8. Scripts npm

| Script | Usage |
|---|---|
| `dev` / `build` / `preview` | Vite (`build` = `tsc && vite build`) |
| `tauri` | CLI Tauri (`npm run tauri dev`, `npm run tauri build`) |
| `test` / `test:watch` | Vitest, limité à `src/` |
| `lint` | ESLint sur `src/` |
| `i18n:extract` / `i18n:types` / `i18n:lint` / `i18n:check` | Catalogues de traduction ; `i18n:types` régénère `src/types/resources.d.ts`, qui est commité |

---

## 9. Formats de fichier

```
MonSpectacle/
├── projet.json          # Project sérialisé
├── projet.json.bak1…3   # sauvegardes tournantes
└── musiques/
    └── <uuid>.<ext>     # fichiers copiés, jamais le nom d'origine
```

Un numéro isolé a la même structure avec `numero.json` et `singleNumero: true`. Il s'édite dans le même `ProjectEditor`, simplifié : pas d'ajout de partie, pas de suppression du numéro. Pour importer un `.regiesonnumero` dans un spectacle, on régénère les ids du numéro et des pistes, et on copie les fichiers sous de nouveaux noms.

---

## 10. Où modifier quoi

| Objectif | Fichiers |
|---|---|
| Ajouter une commande Tauri | Le module concerné dans `src-tauri/src/` + `generate_handler!` dans `run()` ([lib.rs](src-tauri/src/lib.rs)) ; `async` si elle touche au disque ou au réseau |
| Renvoyer un projet au frontend depuis un nouveau chemin | Passer par `open_project_from_file` ou appeler `grant_audio_access` |
| Changer le format de projet | [types.rs](src-tauri/src/types.rs) **et** [types.ts](src/types.ts), avec une migration dans `migrate_project` |
| Modifier la lecture | [usePlayer.ts](src/usePlayer.ts) et [playerNav.ts](src/playerNav.ts), avec leurs tests |
| Ajouter un message | Catalogues `fr` et `en` puis `npm run i18n:types` ; un code d'erreur Rust va dans `errors.json` |
| Ajouter une permission | [capabilities/default.json](src-tauri/capabilities/default.json) |
| Apparence | [src/styles/](src/styles/) ; ne pas casser la chaîne `html/body/#root` |
