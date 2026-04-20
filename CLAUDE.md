# Régie Son — Conventions et notes pour Claude

Application desktop Tauri 2 + React/TypeScript pour la gestion du son pendant les spectacles cabaret. Utilisateur : un dev unique (pcomble).

## Langue

- **UI / messages utilisateur** : français (labels, placeholders, erreurs)
- **Code** : anglais (noms de variables, fonctions, commentaires de logique)
- **Messages d'erreur renvoyés par Rust** : français (ils remontent directement à l'utilisateur)

## Stack

- **Backend** : Rust + Tauri 2 (tout dans [src-tauri/src/lib.rs](src-tauri/src/lib.rs))
- **Frontend** : React 18 + TypeScript + Vite
- **State** : hooks custom (`usePlayer`, `useSettings`, `useRecentProjects`, `useUpdater`) + prop drilling. Pas de Redux/Zustand.
- **Audio** : HTML5 `<audio>` via blob URLs (pas de rodio/cpal côté Rust)
- **Icons** : lucide-react
- **D&D** : @dnd-kit
- **Updater** : tauri-plugin-updater avec signature minisign

## Conventions critiques

### Serde rename (Rust ↔ JSON ↔ TypeScript)

Les champs Rust sont en `snake_case`, mais le JSON échangé avec le frontend TypeScript est en `camelCase`. Utiliser `#[serde(rename = "…")]` par champ :

```rust
#[serde(skip_serializing_if = "Option::is_none", rename = "startTime")]
pub start_time: Option<f64>,
```

Les champs sans camelCase custom (ex. `original_name`) restent en `snake_case` côté TypeScript aussi — **ne pas tout passer en camelCase** sans vérifier. Les types TS sont la source de vérité pour le format JSON attendu.

### Pattern version guard pour les async annulables

Dans [src/usePlayer.ts](src/usePlayer.ts) : `loadVersionRef` est incrémenté à chaque `playAt()`. Les callbacks `.then()` vérifient `version !== loadVersionRef.current` et bailent si stale. Ça évite qu'un chargement async tardif n'écrase le state d'une piste plus récente.

Ce pattern est aussi utilisé au démontage du hook : on incrémente `loadVersionRef.current++` dans le cleanup pour invalider tous les chargements en vol.

### Pattern ref-sync pour callbacks stables

`useCallback` avec `[]` comme deps → on lit le state courant via des refs synchronisés à chaque render :

```ts
const stateRef = useRef(state);
stateRef.current = state;
const projectRef = useRef(project);
projectRef.current = project;
```

Les fonctions `next`, `togglePlay`, etc. lisent `stateRef.current`/`projectRef.current` → toujours à jour, sans nouveau render.

### Cross-refs pour rompre les cycles

`nextRef.current = next` et `playAtRef.current = playAt` permettent à des callbacks définis avant d'appeler ceux définis après. Pattern nécessaire parce que `playAt` est utilisé dans le listener `ended` configuré au montage.

### Commandes Tauri par plateforme

`#[cfg(target_os = "windows")]` / `"macos"` / `"linux"` — une impl par OS pour les fonctionnalités système (ex. `set_show_mode_impl`). Ajouter une impl fallback `#[cfg(not(any(...)))]` pour les autres.

### Événements Tauri pour la progression async

Pour les tâches longues (yt-dlp), émettre des événements depuis Rust :

```rust
use tauri::Emitter;
app.emit("yt-dlp-progress", YtDlpProgress { step: "…".into() })
```

Frontend écoute avec `listen("yt-dlp-progress", …)` dans un `useEffect`. Nettoyer le listener dans le cleanup.

### Écritures atomiques

`save_project_to_disk` écrit dans `projet.json.tmp` puis `fs::rename` — atomique sur Windows (MOVEFILE_REPLACE_EXISTING) et Unix. Reproduire ce pattern pour toute écriture critique.

### Fermeture silencieuse des subprocess

Sur Windows, utiliser `silent_command(path)` (helper dans lib.rs) qui ajoute `CREATE_NO_WINDOW` pour éviter qu'une fenêtre console clignote quand on spawn yt-dlp ou une commande système.

## Pipeline de release

- Tag `v*` déclenche [.github/workflows/release.yml](.github/workflows/release.yml)
- Matrice : Linux x86_64, Windows x86_64, macOS x86_64/aarch64
- Patch automatique de la version dans `tauri.conf.json` ET `Cargo.toml` depuis le tag
- yt-dlp téléchargé par plateforme avant le build (sidecar via `externalBin`)
- Signature minisign via secrets GitHub (`TAURI_SIGNING_PRIVATE_KEY` + password)
- Pas de CI sur push — juste sur tag

### Clé de signature

La clé publique est dans [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json) sous `plugins.updater.pubkey`. La clé privée est dans les secrets du repo GitHub. **Ne jamais régénérer** sans prévenir l'utilisateur — toute nouvelle clé cassera l'updater pour tous les utilisateurs existants.

## Gotchas connus

- `PresentationSettings.exe` existe sur Windows 11 mais est un no-op. Le mode spectacle Windows utilise maintenant WASAPI pour muter la session SystemSounds (PID 0). Nécessite crate `windows` (target-specific).
- La session SystemSounds n'existe parfois pas au premier lancement — l'utilisateur peut avoir à produire un son système d'abord.
- `setSinkId` n'est dispo qu'en Chrome/Edge (WebView2 sur Windows). Silent fail sur les autres.
- `response.bytes().await` buffer tout en mémoire — utiliser `chunk()` en boucle pour stream.
- Les projets existants avec l'ancien schéma (`audio_files[]` au lieu de `items[]`) sont migrés automatiquement via `migrate_project`.

## CSS

Tout dans [src/App.css](src/App.css), ~1400 lignes. Variables CSS dans `:root` (var(--accent), etc.). Chaîne de hauteur critique : `html, body, #root` → `height: 100%; overflow: hidden`. Toute dérogation casse le scroll de `.editor-body`.

## Ce qu'il ne faut PAS faire

- Ajouter des commits/tags sans demander explicitement.
- Force-push sur main.
- Régénérer la clé de signature minisign.
- Utiliser `git add -A` (ajoute .vscode/ par accident).
- Mettre des emojis dans le code sauf si demandé.
- Créer des docs/readmes sauf si demandé.
