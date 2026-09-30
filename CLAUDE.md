# Régie Son — Conventions et notes pour Claude

Application desktop Tauri 2 + React/TypeScript pour la gestion du son pendant les spectacles cabaret. Utilisateur : un dev unique (pcomble).

## Langue

- **UI / messages utilisateur** : multilingue via i18next — voir [Internationalisation](#internationalisation-i18n)
- **Code** : anglais (noms de variables, fonctions, commentaires de logique)
- **Langue de référence des catalogues** : français (`fallbackLng: "fr"`)

## Internationalisation (i18n)

Outillage : `i18next` + `react-i18next` + `i18next-cli` (extraction, génération de types, lint).

### Glossaire — à respecter sans exception

| FR | EN |
|---|---|
| spectacle | Show |
| numéro | Act |
| entracte | Intermission |
| présentation | Host segment |

Le nom « Régie Son » ne se traduit pas : c'est la marque, et c'est aussi un identifiant système (session audio WASAPI, `--who` de systemd-inhibit, associations de fichiers).

### Chaînes françaises qu'il ne faut PAS traduire

Ce sont des chemins ou du format de fichier, pas de l'interface :

- `Spectacles` et `Numéros` ([lib.rs](src-tauri/src/lib.rs)) — dossiers créés dans les Documents de l'utilisateur. Les traduire casse les installations existantes.
- `musiques/` — structure interne de l'archive `.regieson`. La traduire casse le format de fichier.
- `NumeroType = "numero" | "entracte" | "presentation"` — valeurs persistées dans le JSON projet. Seuls leurs libellés d'affichage se traduisent.

### Décisions arrêtées

- Locales : `fr` et `en` (anglais US ; un seul catalogue anglophone, pas de `en-GB`).
- Repli : `fr`. Un catalogue `en` incomplet n'affiche donc jamais de clé brute.
- Premier lancement : détection via `navigator.language`. Le choix explicite de l'utilisateur est persisté dans `Settings.language` (`null` = suivre l'OS).
- Noms par défaut générés (`Intermission 2`) : produits dans la langue active puis figés comme donnée utilisateur. Un projet créé en anglais garde ses noms anglais ouvert en français.
- Métadonnées OS (descriptions d'associations `.regieson`, filtres des dialogues natifs) : restent en français. Elles sont figées à l'installation, les traduire ne changerait rien pour un utilisateur déjà installé.

### Ajouter une langue

1. Créer `src/i18n/locales/<lng>/` et y copier les fichiers de `fr/`
2. `npm run i18n:extract` complète les clés manquantes
3. Traduire
4. `npm run i18n:check`

Rien d'autre : les catalogues sont chargés par `import.meta.glob` et le sélecteur de langue est dérivé de `supportedLngs`. Ni import ni liste à mettre à jour.

### Conventions

- **Une clé par phrase complète, jamais de fragment interpolé.** `preflight.batteryShorterThanShow` et `preflight.batteryShorterThanAct` sont deux clés distinctes, parce que « la durée **du** spectacle » / « **du** numéro » ne se recompose pas d'une langue à l'autre.
- **Pluriels via `count`**, jamais par concaténation d'un `"s"`. i18next s'appuie sur `Intl.PluralRules`, donc les langues à 3 ou 4 formes fonctionneront sans code supplémentaire.
- **La logique métier renvoie des codes, pas des phrases.** `runPreflight` rend des `PreflightIssue` avec un `code` et ses paramètres ; la traduction se fait à l'affichage ([preflightMessage.ts](src/preflightMessage.ts)). Les tests portent sur les codes, ce qui les rend insensibles aux reformulations.
- **Durées** : `formatLongDuration(seconds, lng?)` lit son découpage dans `common:duration.*`, donc `1 h 23` en français et `1h 23m` en anglais viennent du catalogue. Les durées arrivent déjà formatées dans les messages (`{{left}}`, pas `{{left, duration}}`) : les types générés par i18next typent tout paramètre formaté en `string`, et passer par un formateur i18next obligeait à convertir les nombres pour rien.
- Les namespaces dont les clés viennent de données (`preflight` et `errors`) sont **maintenus à la main** — l'extraction statique ne peut pas les voir. D'où `removeUnusedKeys: false`. Deux tests les couvrent : [i18n.test.ts](src/i18n.test.ts) garantit qu'aucune clé de `fr` ne manque dans les autres locales, [errorMessage.test.ts](src/errorMessage.test.ts) que chaque code émis par Rust existe dans le catalogue.
- **Toujours `useTranslation([...])` avec un tableau**, jamais `useTranslation("audio")`. Les clés préfixées (`t("audio:addStep")`) ne sont typées que sous la forme tableau ; avec un namespace unique il faut écrire la clé nue, et le typage refuse la forme préfixée. Erreur facile à commettre : le message du compilateur parle de types de clés, pas du hook.
- Pour un message qui contient du balisage inline, `<Trans>` avec un `ns` explicite et la clé **nue** : `<Trans ns="audio" i18nKey="player.pauseRemaining" components={{ strong: <strong /> }} />`. Un `i18nKey` préfixé n'est pas typé sur `<Trans>`. Seul cas dans l'application aujourd'hui : le décompte de pause du lecteur.
- Dans un `useCallback` dont `t` n'est pas une dépendance, ou dans une fonction de module, utiliser `i18next.t` directement — la closure garderait sinon la langue d'avant le changement. C'est le cas de `newNumero` ([ProjectEditor.tsx](src/components/ProjectEditor.tsx)) et de `formatBinding` ([keyBindings.ts](src/keyBindings.ts)).
- Texte volontairement non traduit : directive `{/* i18next-instrument-ignore-next-line */}` au-dessus. Un seul usage, le `<h1>Régie Son</h1>` de [HomePage.tsx](src/components/HomePage.tsx).

### Erreurs Rust

Les commandes Tauri rendent un [`AppError`](src-tauri/src/error.rs) — `{ code, detail?, params? }` — jamais une phrase :

```rust
fs::write(&path, data).map_err(fail("io.saveFailed"))?;
archive.by_name(name).map_err(|e| AppError::new("archive.readNamedFailed").with("name", name).detail(e))?;
```

- `code` désigne une entrée de `errors.json`, `params` ses interpolations, `detail` le message brut de l'OS ou de la bibliothèque. **`detail` n'est jamais traduit** : c'est ce qu'on lit pour déboguer, et c'est ce que [errorMessage.ts](src/errorMessage.ts) reconnaît par regex — la sortie de yt-dlp et de reqwest est en anglais et le reste.
- `translateError(raw)` lit i18next directement au lieu de recevoir un `t`, contrairement à `preflightMessage` : un message d'erreur est calculé une fois au `catch` puis rangé dans un state, donc il n'a pas à être réactif, et les appelants sont autant des hooks que des composants.
- Un `detail` reconnu **l'emporte** sur le message du code : « Cette vidéo est privée » dit plus que « Erreur yt-dlp : … ».
- `set_show_mode` rend `Result<(), Vec<AppError>>`. Les deux volets sont indépendants et l'opérateur doit savoir lequel a renoncé : c'est le frontend qui traduit puis joint par ` · `, puisque lui seul connaît la langue.
- **Ne jamais faire `String(err)` sur une erreur de commande** — ça rend `[object Object]`. Toujours `translateError(err)`.
- Le code voyage en chaîne de Rust au catalogue : ni rustc ni tsc ne peuvent le vérifier. [errorMessage.test.ts](src/errorMessage.test.ts) le fait à leur place, en relisant les sources Rust par le glob Vite.
- [audio_session.rs](src-tauri/src/audio_session.rs) garde des `Result<(), String>` : son erreur est jetée par l'appelant (`let _ = …`) et ne remonte jamais à l'utilisateur.

### Où en est la migration

Terminée. **323 clés**, 11 namespaces (`app`, `audio`, `common`, `editor`, `errors`, `home`, `parts`, `preflight`, `settings`, `share`, `updater`), `fr` et `en` complets. Plus une seule chaîne française codée en dur hors de la liste « à ne pas traduire » ci-dessus.

Le job `checks` de [release.yml](.github/workflows/release.yml) fait tourner `i18n:check`, `tsc` et les tests avant les quatre builds.

**Attention aux branches `#[cfg]`** : sous Linux, `cargo check` ne compile ni le code Windows ni le code macOS de [show_mode.rs](src-tauri/src/show_mode.rs) et [sleep_guard.rs](src-tauri/src/sleep_guard.rs), et le toolchain MSVC n'est pas installable sous WSL. Une modification de ces branches n'est vérifiée que par la CI (job `rust`, matrice des trois OS) ou le build de release.

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

`save_project_to_disk` écrit dans `projet.json.tmp` (avec `sync_all`) puis `fs::rename` — atomique sur Windows (MOVEFILE_REPLACE_EXISTING) et Unix. La sauvegarde `.bak1` est une **copie**, pas un rename : le fichier cible existe à tout instant, même si le rename final échoue. `open_project_from_file` retombe sur `.bak1` si le fichier principal manque ou est illisible. Reproduire ce pattern pour toute écriture critique.

### Fermeture silencieuse des subprocess

Sur Windows, utiliser `silent_command(path)` (helper dans lib.rs) qui ajoute `CREATE_NO_WINDOW` pour éviter qu'une fenêtre console clignote quand on spawn yt-dlp ou une commande système.

## Pipeline de release

- Tag `v*` déclenche [.github/workflows/release.yml](.github/workflows/release.yml)
- Matrice : Linux x86_64, Windows x86_64, macOS x86_64/aarch64
- Patch automatique de la version dans `tauri.conf.json` ET `Cargo.toml` depuis le tag
- yt-dlp téléchargé par plateforme avant le build (sidecar via `externalBin`), à la version épinglée par `YTDLP_VERSION` en tête du workflow et vérifié contre le `SHA2-256SUMS` de la release. Pour l'actualiser, changer cette seule variable : elle fait aussi partie de la clé de cache.
- Signature minisign via secrets GitHub (`TAURI_SIGNING_PRIVATE_KEY` + password)
- CI sur chaque push et PR ([ci.yml](.github/workflows/ci.yml)) : i18n, types i18n, ESLint, tests, build Vite, puis rustfmt, clippy `-D warnings` et `cargo test` sous Linux, Windows et macOS

### Clé de signature

La clé publique est dans [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json) sous `plugins.updater.pubkey`. La clé privée est dans les secrets du repo GitHub. **Ne jamais régénérer** sans prévenir l'utilisateur — toute nouvelle clé cassera l'updater pour tous les utilisateurs existants.

## Gotchas connus

- `PresentationSettings.exe` existe sur Windows 11 mais est un no-op. Le mode spectacle Windows utilise maintenant WASAPI pour muter la session SystemSounds (PID 0). Nécessite crate `windows` (target-specific).
- La session SystemSounds n'existe parfois pas au premier lancement — l'utilisateur peut avoir à produire un son système d'abord.
- Le mode spectacle a deux volets indépendants, toujours tentés tous les deux : couper les notifications ([show_mode.rs](src-tauri/src/show_mode.rs)) et bloquer la mise en veille ([sleep_guard.rs](src-tauri/src/sleep_guard.rs)). Leurs erreurs sont concaténées par ` · ` dans un seul bandeau.
- Le blocage de veille est conçu pour **se relâcher tout seul si le processus meurt** : thread parqué sous Windows (`ES_CONTINUOUS` est lié au thread), `caffeinate -w <pid>` sous macOS, EOF du tube `systemd-inhibit … cat` sous Linux. Ne pas remplacer par un mécanisme process-wide (`PowerCreateRequest`, D-Bus sans fd) sans conserver cette propriété.
- La coupure des notifications, elle, n'a **pas** cette propriété : un crash ou un kill laisse les notifications muettes définitivement (dconf sous GNOME, DND macOS, session SystemSounds Windows). Connu, non corrigé.
- `set_show_mode` est un `#[tauri::command(async)]` : les commandes non-async tournent sur le thread principal, et ses deux volets bloquent plusieurs centaines de ms. Retirer l'attribut fige l'UI. Même règle pour toute commande qui lit ou écrit beaucoup (`read_audio_file`, imports/exports, `verify_project`…) et pour les dialogues `blocking_*`, que la doc du plugin interdit sur le thread principal. `save_project_to_disk` est protégé par un verrou, puisque les imports sauvegardent hors du thread principal.
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
