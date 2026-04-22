# Régie Son — Documentation technique

Application desktop (Tauri 2) de pilotage audio pour spectacles cabaret. Le régisseur prépare un projet (numéros, entractes, présentations), chaque numéro contient une playlist de pistes audio et de pauses, et la lecture s'enchaîne pendant le spectacle avec fade in/out, start/end time, volume par piste et sortie audio configurable.

- **Cible** : Linux / Windows / macOS (x86_64 + aarch64 pour macOS)
- **Dev unique** : pcomble
- **Langue UI** : français — **Code** : anglais
- **Fichier projet** : dossier contenant `projet.json` + sous-dossier `musiques/`
- **Archive portable** : `.regieson` (zip du dossier projet)
- **Numéro isolé** : dossier contenant `numero.json` + `musiques/` (réutilise la structure `Project` avec flag `singleNumero: true`)
- **Archive portable de numéro** : `.regiesonnumero` (zip du dossier numéro), importable dans un projet pour ajouter un numéro avec tous ses presets (fades, volumes, start/end, notes, pauses intercalées).

---

## 1. Architecture générale

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend React 19 + TypeScript (Vite)                      │
│  ┌─────────┐   ┌──────────────┐   ┌───────────────────────┐ │
│  │ App.tsx │──▶│ HomePage     │   │ ProjectEditor         │ │
│  │         │   │ (liste pro-  │   │ ┌──────────────────┐  │ │
│  │         │   │  jets        │   │ │ NumeroCard × N   │  │ │
│  │         │   │  récents)    │   │ │   AudioItem/…    │  │ │
│  │         │   └──────────────┘   │ └──────────────────┘  │ │
│  │         │                      │ PlayerBar             │ │
│  └─────────┘                      └───────────────────────┘ │
│       │                                                      │
│       │ hooks: usePlayer, useSettings,                       │
│       │        useRecentProjects, useUpdater                 │
│       ▼                                                      │
│  [HTMLAudioElement + blob URLs]                             │
└─────────────────────────────────────────────────────────────┘
                        │
                        │  invoke() / event listen()
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  Backend Rust + Tauri 2  (tout dans src-tauri/src/lib.rs)   │
│  • Projet (create/open/save/verify/cleanup)                 │
│  • Fichiers (copy/delete/read_audio_file)                   │
│  • Export/Import .regieson (zip)                            │
│  • Download URL + yt-dlp (cancel token, progress events)    │
│  • Mode Spectacle (WASAPI Win / NSUserNotif macOS / Linux)  │
│  • Migration schéma legacy → actuel                         │
└─────────────────────────────────────────────────────────────┘
                        │
                        ▼
              [FS local + réseau + yt-dlp sidecar]
```

### Stack

| Couche | Choix |
|---|---|
| Fenêtre native | Tauri 2 |
| UI | React 19, TypeScript ~5.8, Vite 7 |
| State | hooks custom + prop drilling (pas de Redux/Zustand) |
| Audio playback | `HTMLAudioElement` + `URL.createObjectURL` sur des blobs renvoyés par `read_audio_file` |
| Icônes | `lucide-react` |
| Drag & drop | `@dnd-kit/core` + `sortable` |
| Updater | `tauri-plugin-updater` (signatures minisign) |
| Téléchargements | `reqwest` (rustls-tls) + sidecar `yt-dlp` |
| Archive projet | `zip` crate (deflate) |
| Tests front | Vitest (pas de tests Rust) |
| Audio système | `windows-rs` 0.58 (WASAPI) — dépendance target-specific Windows |

> **Note** : `howler` et `@types/howler` sont présents dans `package.json` mais **non utilisés** dans le code actuel (la lecture se fait via HTML5 `<audio>` natif). Candidats à suppression.

---

## 2. Modèle de données

Défini à la fois côté Rust ([src-tauri/src/lib.rs:55-104](src-tauri/src/lib.rs#L55-L104)) et TypeScript ([src/types.ts](src/types.ts)). Les deux **doivent rester synchronisés**.

### Schéma actuel

```ts
interface AudioFile {
  type: "audio";
  id: string;
  filename: string;       // nom du fichier dans musiques/
  original_name: string;  // snake_case — pas renommé côté TS
  volume: number;         // 0–100
  startTime?: number;     // camelCase via serde rename
  endTime?: number;
  fadeIn?: number;
  fadeOut?: number;
  cue?: string;           // "top de départ" — indication pour le régisseur (accepte "note" en lecture pour rétrocompat)
}

interface PauseItem {
  type: "pause";
  id: string;
  cue?: string;           // "top de départ"
}

type PlaylistItem = AudioFile | PauseItem;
type NumeroType = "numero" | "entracte" | "presentation";

interface Numero {
  id: string;
  type: NumeroType;
  name: string;
  items: PlaylistItem[];  // piste ou pause intercalée
}

interface Project {
  name: string;
  path: string;           // dossier sur le disque
  numeros: Numero[];
  singleNumero?: boolean; // true = numéro isolé (numero.json, export .regiesonnumero)
}
```

### Convention serde critique

Les champs Rust en `snake_case` sont renommés en `camelCase` côté JSON **un par un** via `#[serde(rename = "…")]`. Les champs non renommés (ex. `original_name`) **restent** en `snake_case` côté TypeScript. Les types TS sont la source de vérité.

### Migration legacy

[`migrate_project`](src-tauri/src/lib.rs#L130) détecte l'ancien schéma (`audio_files[]` à la racine du numéro) et le convertit en `items[]`. Les types `LegacyAudioFile`, `LegacyNumero`, `LegacyProject` ([src-tauri/src/lib.rs:106-128](src-tauri/src/lib.rs#L106-L128)) servent uniquement à la désérialisation de l'ancien format.

---

## 3. Backend Rust ([src-tauri/src/lib.rs](src-tauri/src/lib.rs))

Tout le backend tient dans un seul fichier (~850 lignes). Pas de découpage en modules.

### 3.1 Entrée et configuration

| Symbole | Rôle |
|---|---|
| [`run`](src-tauri/src/lib.rs#L827) | Point d'entrée, configure les plugins Tauri et enregistre les commandes. Appelle `configure_wsl2_audio()` en amont. |
| [`configure_wsl2_audio`](src-tauri/src/lib.rs#L819) | Workaround WSL2 (setup env audio). |
| `main.rs` | Appelle simplement `regie_son_lib::run()`. |
| `build.rs` | Glue `tauri_build::build()`. |

### 3.2 Commandes Tauri exposées

Enregistrées dans [`invoke_handler!`](src-tauri/src/lib.rs#L833) :

| Commande | Rôle |
|---|---|
| `get_default_projects_dir` | Dossier par défaut (`~/Documents/Régie Son`). |
| `pick_folder`, `pick_audio_files` | Dialogs natifs. Fallback `zenity` sur Linux (`pick_folder_zenity`, `pick_audio_files_zenity`) pour contourner les limites des dialogs Tauri. |
| `create_project` | Crée le dossier + `musiques/` + projet vide. |
| `open_project` | Lit `projet.json`, applique `migrate_project`, renvoie un `Project`. |
| `save_project` | Sérialise + écrit atomiquement. |
| `copy_audio_file` | Copie un fichier dans `musiques/`, déduplication par `safe_filename`. |
| `delete_audio_file` | Supprime un fichier physique. |
| `verify_project` | Renvoie `VerifyResult` avec fichiers manquants / orphelins. |
| `cleanup_orphan_files` | Supprime les fichiers non référencés. |
| `pick_regieson_file` / `save_regieson_file` | Dialogs spécifiques à l'extension `.regieson`. |
| `export_project` | Zippe le dossier projet en `.regieson`. |
| `import_project` | Dézippe un `.regieson` dans un dossier destination, ouvre le projet. |
| `read_audio_file` | Lit un fichier binaire et le renvoie en `tauri::ipc::Response` (pour créer un blob côté front). |
| `download_audio_from_url` | Télécharge un audio via HTTP avec `reqwest`, stream en chunks. |
| `download_youtube_audio` | Invoque le sidecar `yt-dlp` (avec progression), extrait le fichier final. |
| `cancel_download` | Annule un download en cours via `CancelToken`. |
| `set_show_mode` | Active/désactive le mode spectacle (mute notifications système). |
| `get_default_numeros_dir` | Dossier par défaut pour les numéros isolés (`~/Documents/Numéros`). |
| `create_numero` | Crée un dossier numéro isolé : JSON `numero.json` avec 1 `Numero` vide + `singleNumero: true`. |
| `open_numero` | Lit `numero.json` dans un dossier. |
| `save_numero` | Sauvegarde atomique (alias sémantique de `save_project` — le nom de fichier est choisi via `singleNumero`). |
| `pick_regiesonnumero_file` / `save_regiesonnumero_file` | Dialogs natifs pour `.regiesonnumero`. |
| `export_numero` | Zippe un dossier numéro en `.regiesonnumero`. |
| `import_numero_standalone` | Dézippe un `.regiesonnumero` en dossier éditable, force `singleNumero: true`. |
| `import_numero_into_project` | Copie les audios d'un `.regiesonnumero` dans `projet/musiques/`, régénère les UUIDs et l'ID du numéro, ajoute à `project.numeros`, sauvegarde. |
| `auto_import_regieson` / `auto_import_regiesonnumero` | Décompresse une archive vers un dossier auto-calculé (`{defaultDir}/{nom-archive}` avec suffixe `-2`, `-3` si collision) et renvoie le `Project`. Utilisé par l'ouverture via double-clic sur un fichier associé. |
| `take_pending_open_file` | Consume le chemin du fichier passé en argument CLI au démarrage (si l'app a été lancée via double-clic). Appelée par le front au mount. |

### 3.3 Téléchargements annulables

Pattern clé pour les downloads concurrents :

- [`CancelToken`](src-tauri/src/lib.rs#L430) — flag atomique + `tokio::sync::Notify` pour le `wait()`.
- [`cancel_registry`](src-tauri/src/lib.rs#L448) — `&'static Mutex<HashMap<String, Arc<CancelToken>>>` singleton.
- [`DownloadGuard`](src-tauri/src/lib.rs#L453) — RAII : insert dans le registry à la création, `drop()` retire automatiquement.
- [`cancel_download`](src-tauri/src/lib.rs#L473) — retrouve un token par ID et trigger `cancel()`.
- [`cleanup_partial_files`](src-tauri/src/lib.rs#L479) — nettoie les fichiers partiels après annulation.

### 3.4 yt-dlp sidecar

- [`find_yt_dlp`](src-tauri/src/lib.rs#L408) — cherche le binaire sidecar bundlé (`binaries/yt-dlp` dans `externalBin`).
- [`silent_command`](src-tauri/src/lib.rs#L398) — wrapper `Command::new` qui ajoute `CREATE_NO_WINDOW` sur Windows (évite le flash de la console).
- [`YtDlpProgress`](src-tauri/src/lib.rs#L396) — struct émise en événement `yt-dlp-progress` côté front via `app.emit(…)`. Le frontend écoute via `listen()` dans un `useEffect`.

### 3.5 Mode Spectacle (notifications système)

[`set_show_mode`](src-tauri/src/lib.rs#L706) appelle `set_show_mode_impl`, décliné **par plateforme** via `#[cfg(target_os = …)]` :

| OS | Ligne | Approche |
|---|---|---|
| Windows | [711](src-tauri/src/lib.rs#L711) | WASAPI via `windows-rs` — mute la session `SystemSounds` (PID 0). Nécessite que la session existe (sinon produire un son système au moins une fois). `PresentationSettings.exe` est un no-op sur Win11 → pas utilisé. |
| macOS | [778](src-tauri/src/lib.rs#L778) | NSUserNotification Focus. |
| Linux | [800](src-tauri/src/lib.rs#L800) | Best-effort via commandes shell. |
| Autres | [813](src-tauri/src/lib.rs#L813) | Fallback no-op (`_active: bool`). |

### 3.6 Écritures atomiques

[`save_project_to_disk`](src-tauri/src/lib.rs#L690) écrit d'abord `projet.json.tmp` puis `fs::rename` vers `projet.json`. Atomique sur Windows (MOVEFILE_REPLACE_EXISTING) et Unix. Pattern à reproduire pour toute écriture critique.

### 3.7 Helpers

- [`safe_filename`](src-tauri/src/lib.rs#L10) — sanitize + déduplique un nom.
- [`parse_content_disposition_filename`](src-tauri/src/lib.rs#L17) — extrait le filename d'un header HTTP lors des downloads URL.
- [`default_volume`](src-tauri/src/lib.rs#L52) — renvoie `100`, utilisé par le `#[serde(default = …)]` sur `AudioFile::volume`.

---

## 4. Frontend

### 4.1 Entrée et orchestration

- [src/main.tsx](src/main.tsx) — bootstrap React (`createRoot`).
- [src/App.tsx](src/App.tsx) — switch `HomePage` ↔ `ProjectEditor` selon `project === null`. Possède l'état global : `project`, `showSettings`, recents, settings, updater state. Affiche `UpdateBanner` en haut + `SettingsModal` en overlay.

### 4.2 Hooks custom

| Hook | Responsabilité | Notes |
|---|---|---|
| [`usePlayer`](src/usePlayer.ts) | Moteur de lecture. ~340 lignes. | Voir section 5. |
| [`useSettings`](src/useSettings.ts) | `Settings` (volume général, device audio) persisté dans `localStorage` sous la clé `KEY`. | `DEFAULT` + `load()` pour hydratation. |
| [`useRecentProjects`](src/useRecentProjects.ts) | Liste des projets récents (nom + path + `last_opened_at`). | Max `MAX` entrées, LRU, persisté en `localStorage`. |
| [`useUpdater`](src/useUpdater.ts) | État updater (`checking`/`available`/`downloading`/`ready`/`error`), actions `install`/`dismiss`/`checkUpdate`. | Consomme `@tauri-apps/plugin-updater`. |

### 4.3 Utilitaires purs (testés)

- [src/playerNav.ts](src/playerNav.ts) — [`getNextContext`](src/playerNav.ts#L13) calcule la prochaine piste à jouer en tenant compte du type de numéro, pauses, fin de playlist. Testé par [src/playerNav.test.ts](src/playerNav.test.ts) (26 cas).
- [src/mime.ts](src/mime.ts) — `MIME_MAP` + `audioMimeType(filename)` pour créer le bon `type` sur les blobs.
- [src/friendlyError.ts](src/friendlyError.ts) — `PATTERNS` + `friendlyError(raw)` convertit les erreurs Rust brutes en messages utilisateur français.

### 4.4 Composants

| Composant | Rôle |
|---|---|
| [HomePage](src/components/HomePage.tsx) | Accueil : liste des projets récents, boutons ouvrir/créer/importer/réglages. Contient `CreateProjectModal` interne + helper `slugify`. |
| [ProjectEditor](src/components/ProjectEditor.tsx) | Vue projet. Gère les numéros (ajout, suppression, réordonnancement dnd), intègre `PlayerBar` + `usePlayer`. Helper `newNumero(type, index)`. |
| [NumeroCard](src/components/NumeroCard.tsx) | Une carte "numéro" avec son nom, ses items (audios/pauses). Surface l'état de lecture (playerPosition, isPlaying, playerFade, missingFile). |
| [AudioItem](src/components/AudioItem.tsx) | Une piste dans un numéro : bouton play, nom, état actif/playing/missing, fade en cours. |
| [PauseTrack](src/components/PauseTrack.tsx) | Un slot "pause" entre deux pistes (top de départ optionnel). |
| [PlayerBar](src/components/PlayerBar.tsx) | Barre de contrôle bas d'écran : play/pause, next, stop, seek. Helper `formatTime(secs)`. |
| [AddAudioSourceModal](src/components/AddAudioSourceModal.tsx) | Modal multi-vue (`View` = local / url / youtube / pause). Contient `DownloadForm` réutilisable avec progression. |
| [AudioSettingsModal](src/components/AudioSettingsModal.tsx) | Édition des métadonnées d'une piste (startTime, endTime, fadeIn, fadeOut, volume). Helpers `formatTime` / `parseTime` / `parseDuration`. |
| [SettingsModal](src/components/SettingsModal.tsx) | Paramètres globaux : sortie audio (`AudioDevice` via `navigator.mediaDevices.enumerateDevices`), updater manuel. |
| [UpdateBanner](src/components/UpdateBanner.tsx) | Bandeau haut quand un update est dispo/téléchargé. |

### 4.5 CSS

Fichiers séparés dans [src/styles/](src/styles/) (audio-item, base, buttons, editor, home, inputs, modal, numero, player, settings-modal). Importés via [src/App.css](src/App.css). **Variables CSS** dans `:root` (ex. `var(--accent)`). Chaîne de hauteur critique : `html, body, #root` → `height: 100%; overflow: hidden` — toute dérogation casse le scroll de `.editor-body`.

---

## 5. Moteur de lecture ([src/usePlayer.ts](src/usePlayer.ts))

Cœur de l'app. Un seul hook qui gère tout l'état audio.

### 5.1 Types exposés

```ts
type PlayerPosition  = { numeroIndex: number; itemIndex: number };
type PlayerProgress  = { current: number; total: number };
type FadeState       = "in" | "out" | null;
interface PlayerState {
  position: PlayerPosition | null;
  isPlaying: boolean;
  progress: PlayerProgress;
  fade: FadeState;
  missingFile: string | null;
}
```

### 5.2 API

`usePlayer(project, audioDeviceId)` renvoie `{ state, playAt, togglePlay, next, stop, seek }`.

Helpers purs exposés (navigation) :

- `firstAudioPosition(project)` — premier audio playable du projet.
- `firstItemPosition(project)` — premier item (audio ou pause).
- `nextItemPosition(project, pos)` — item suivant linéaire.
- `nextAudioPosition(project, pos)` — prochain **audio** (saute les pauses).

### 5.3 Patterns critiques

**Version guard pour les chargements async** — `loadVersionRef` est incrémenté à chaque `playAt()`. Chaque callback `.then()` vérifie `version !== loadVersionRef.current` et bail si stale. Évite qu'un chargement tardif n'écrase une piste plus récente. Le cleanup du hook incrémente aussi `loadVersionRef.current++` pour invalider tout chargement en vol au démontage.

**Refs synchronisés pour callbacks stables** — `useCallback(…, [])` avec `stateRef.current`/`projectRef.current` mis à jour à chaque render. Les fonctions (`next`, `togglePlay`, etc.) lisent toujours le state courant sans re-render.

**Cross-refs pour rompre les cycles** — `nextRef.current = next` et `playAtRef.current = playAt` permettent aux callbacks définis tôt (ex. listener `ended` configuré au montage) d'appeler ceux définis plus tard.

**Flux de lecture typique** :
1. `playAt(pos)` → incrémente version, appelle `read_audio_file`, crée un blob + object URL, set `audio.src`, set `audio.setSinkId(audioDeviceId)` si dispo.
2. Écoute `timeupdate` → met à jour `progress`, déclenche `fadeOut` si `endTime` / `fadeOut` approche.
3. Événement `ended` → appelle `nextRef.current()` qui choisit via `getNextContext` (pause intercalaire ? audio suivant ? fin ?).

### 5.4 Compatibilité audio

- `audio.setSinkId(deviceId)` : Chrome/Edge (WebView2 sur Windows) uniquement. Silent fail ailleurs.
- `read_audio_file` bufferise en RAM — pour des très gros fichiers ce pattern pourrait être remplacé par du streaming direct via le protocole asset.

---

## 6. Configuration Tauri

### 6.1 [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json)

| Champ | Valeur |
|---|---|
| `productName` | "Régie Son" |
| `identifier` | `com.pcomble.regie-son` |
| `devUrl` | `http://localhost:1420` |
| `security.csp` | `null` (désactivée) |
| `security.assetProtocol` | `enable: true`, `scope: ["**"]` — permet de servir n'importe quel fichier local via le protocole asset |
| `plugins.updater.pubkey` | Clé publique minisign (base64, dans le fichier) |
| `plugins.updater.endpoints` | `https://github.com/powange/regie-son/releases/latest/download/latest.json` |
| `bundle.createUpdaterArtifacts` | `true` |
| `bundle.externalBin` | `["binaries/yt-dlp"]` — le sidecar est injecté par OS durant la CI |

> ⚠️ **La clé de signature minisign ne doit jamais être régénérée** — toute nouvelle paire casse l'updater pour les utilisateurs existants.

### 6.2 [src-tauri/capabilities/default.json](src-tauri/capabilities/default.json)

Permissions accordées à la fenêtre `main` :
- `core:default`
- `opener:default` (ouvrir liens externes)
- `dialog:default` + `dialog:allow-open`
- `updater:default`

### 6.3 [src-tauri/Cargo.toml](src-tauri/Cargo.toml)

Dépendances clés :
- `tauri` 2 + plugins (`opener`, `dialog`, `updater`, `process`)
- `reqwest` 0.12 — feature `rustls-tls` uniquement (pas d'openssl, évite les soucis de build cross-platform)
- `zip` 2 — feature `deflate` uniquement
- `tokio` 1 — features `process`, `sync`, `time`, `macros`
- `dirs` 6 — résolution `~/Documents` etc.
- Target Windows uniquement : `windows` 0.58 avec `Win32_Media_Audio`, `Win32_System_Com`, `Win32_Foundation` — pour l'API WASAPI du mode spectacle.

---

## 7. Pipeline de release ([.github/workflows/release.yml](.github/workflows/release.yml))

### Trigger
Push d'un tag `v*` uniquement — **pas de CI sur push normal**.

### Matrice
| OS | Target |
|---|---|
| `ubuntu-latest` | x86_64-unknown-linux-gnu |
| `windows-latest` | x86_64-pc-windows-msvc |
| `macos-latest` | x86_64-apple-darwin |
| `macos-latest` | aarch64-apple-darwin |

### Étapes clés
1. Récupère `VERSION` depuis `${{ github.ref_name }}`.
2. Patch la version dans `tauri.conf.json` **et** `Cargo.toml`.
3. Download de `yt-dlp` pour la plateforme cible → placé dans `src-tauri/binaries/` (sidecar).
4. `npm ci` + build Tauri.
5. Signature des artefacts updater via les secrets :
   - `TAURI_SIGNING_PRIVATE_KEY`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
6. Publication release GitHub + `latest.json` consommé par `tauri-plugin-updater`.

---

## 8. Scripts npm

| Script | Commande | Usage |
|---|---|---|
| `dev` | `vite` | Dev server front seul (lancé par Tauri auto en mode dev). |
| `build` | `tsc && vite build` | Type-check + build frontend. |
| `preview` | `vite preview` | Preview du build. |
| `tauri` | `tauri` | Proxy CLI Tauri (ex. `npm run tauri dev`, `npm run tauri build`). |
| `test` | `vitest run` | Tests unitaires Vitest one-shot. |
| `test:watch` | `vitest` | Tests en mode watch. |

---

## 9. Format de fichier projet

```
MonSpectacle/
├── projet.json          # sérialisation du type Project
└── musiques/
    ├── <uuid>.mp3       # fichiers copiés (nom réécrit via safe_filename)
    ├── <uuid>.wav
    └── ...
```

### Écriture
Toujours via `save_project_to_disk` — écrit `projet.json.tmp` puis rename atomique.

### Archive portable (`.regieson`)
Zip complet du dossier projet. Créée par `export_project`, restaurée par `import_project` qui extrait dans un dossier destination et renvoie le `Project` chargé.

### Numéro isolé (`.regiesonnumero`)

Structure identique à un projet mais avec un seul `Numero` et le flag `singleNumero: true` :

```
MonNumero/
├── numero.json          # Project sérialisé (singleNumero: true, numeros: [<unique numero>])
└── musiques/
```

- **Créé** par `create_numero` depuis la page d'accueil (bouton "Nouveau numéro").
- **Édité** dans le même `ProjectEditor` que les projets complets, mais en mode simplifié :
  - Pas de drag handle entre numéros (il n'y en a qu'un).
  - Pas de bouton "Ajouter un numéro/entracte/présentation".
  - Pas de bouton "Supprimer" sur le numéro principal.
  - Bouton d'export pointe vers `.regiesonnumero` (via `export_numero`).
- **Exporté** en archive `.regiesonnumero` (zip) pour être partagé.
- **Réimporté** :
  - Comme **numéro éditable** via `import_numero_standalone` (depuis la page d'accueil).
  - Comme **nouveau numéro dans un projet existant** via `import_numero_into_project` (bouton dans `ProjectEditor` d'un projet complet). Les UUIDs des items/fichiers et l'ID du numéro sont régénérés pour éviter les collisions, et les fichiers audio sont copiés dans le `musiques/` du projet cible avec de nouveaux noms.

**Ré-utilisation de la machinerie projet** : un numéro isolé *est* un `Project` du point de vue du frontend et de `usePlayer`. Le backend choisit simplement `numero.json` au lieu de `projet.json` dans `save_project_to_disk` via le flag `singleNumero`. Zéro duplication de logique de lecture / sauvegarde / migration.

---

## 10. Flux d'erreur

Les commandes Rust renvoient `Result<_, String>` — les messages d'erreur sont rédigés **en français** car ils remontent directement à l'utilisateur via les `throw` côté front. [`friendlyError`](src/friendlyError.ts) applique des patterns de rewriting pour les erreurs connues (ex. traduction d'erreurs bas niveau en messages lisibles).

---

## 11. Tests

Localisation | Cible
---|---
[src/friendlyError.test.ts](src/friendlyError.test.ts) | Patterns de ré-écriture d'erreurs.
[src/mime.test.ts](src/mime.test.ts) | Mapping extension → MIME type.
[src/playerNav.test.ts](src/playerNav.test.ts) | Logique de navigation entre items (26 cas, largement couvert).

> Pas de tests côté Rust ni e2e Tauri.

---

## 12. Gotchas connus

- `PresentationSettings.exe` existe sur Windows 11 mais est **un no-op** — c'est pour ça que le mode spectacle Windows passe désormais par WASAPI.
- La session `SystemSounds` WASAPI peut ne **pas exister au premier lancement** — l'utilisateur doit alors produire un son système d'abord (notification, beep).
- `setSinkId` (sélection sortie audio) n'est dispo qu'en Chromium → fonctionne dans WebView2 Windows, peut silent-fail ailleurs.
- `response.bytes().await` de reqwest buffer tout en mémoire — le code utilise `chunk()` en boucle pour streamer les gros downloads.
- Les projets existants avec l'ancien schéma (`audio_files[]`) sont migrés automatiquement via `migrate_project` au premier `open_project`.
- Ne pas faire `git add -A` — ajoute `.vscode/` par accident.

---

## 13. Points d'entrée pour modifier le code

| Objectif | Fichier à ouvrir |
|---|---|
| Ajouter une commande Tauri | [src-tauri/src/lib.rs](src-tauri/src/lib.rs) + enregistrer dans `invoke_handler!` ligne 833 |
| Changer le format de projet | [src-tauri/src/lib.rs:55-104](src-tauri/src/lib.rs#L55-L104) **et** [src/types.ts](src/types.ts) — prévoir migration dans `migrate_project` |
| Modifier le moteur de lecture | [src/usePlayer.ts](src/usePlayer.ts) — attention aux patterns version-guard et ref-sync |
| Ajouter un type de numéro | `NumeroType` dans [src/types.ts](src/types.ts) + Rust `Numero.type` + UI dans [ProjectEditor.tsx](src/components/ProjectEditor.tsx) + logique nav dans [playerNav.ts](src/playerNav.ts) |
| Personnaliser l'apparence | [src/styles/](src/styles/) — ne pas casser la chaîne `html/body/#root` |
| Changer le comportement updater | [src/useUpdater.ts](src/useUpdater.ts) + [tauri.conf.json](src-tauri/tauri.conf.json) pour l'endpoint |
| Ajouter une permission | [src-tauri/capabilities/default.json](src-tauri/capabilities/default.json) |
| CI/release | [.github/workflows/release.yml](.github/workflows/release.yml) |
