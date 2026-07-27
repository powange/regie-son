# Régie Son

Application de régie son pour spectacles cabaret : playlists par numéro, points de pause, fondus, mode spectacle et sortie audio dédiée.

## Téléchargement

Les liens ci-dessous pointent toujours vers la **dernière version publiée**.

| Système | Fichier |
|---|---|
| Windows | [Installeur `.exe`](https://github.com/powange/regie-son/releases/latest/download/Regie.Son_x64-setup.exe) · [`.msi`](https://github.com/powange/regie-son/releases/latest/download/Regie.Son_x64_en-US.msi) |
| macOS (Apple Silicon) | [`.dmg`](https://github.com/powange/regie-son/releases/latest/download/Regie.Son_aarch64.dmg) |
| macOS (Intel) | [`.dmg`](https://github.com/powange/regie-son/releases/latest/download/Regie.Son_x64.dmg) |
| Linux | [`.AppImage`](https://github.com/powange/regie-son/releases/latest/download/Regie.Son_amd64.AppImage) · [`.deb`](https://github.com/powange/regie-son/releases/latest/download/Regie.Son_amd64.deb) · [`.rpm`](https://github.com/powange/regie-son/releases/latest/download/Regie.Son-1.x86_64.rpm) |

Toutes les versions : [page des releases](https://github.com/powange/regie-son/releases).

Une fois installée, l'application se met à jour toute seule : elle propose la nouvelle version au démarrage dès qu'elle est disponible.

## Développement

Stack : Tauri 2 (Rust) + React 18 + TypeScript + Vite.

```bash
npm install
npm run tauri dev
```

Éditeur conseillé : [VS Code](https://code.visualstudio.com/) avec [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) et [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).

Une release est produite en poussant un tag `v*` ; le workflow construit et signe les binaires pour les quatre plateformes.
