# Régie Son

Application de régie son pour spectacles cabaret. Elle remplace la playlist improvisée et le lecteur multimédia du commerce : le spectacle est décrit à l'avance numéro par numéro, et le régisseur n'a plus qu'à enchaîner pendant la représentation.

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

## Structurer un spectacle

Un **projet** est une suite de **numéros**, chacun typé : numéro, entracte ou présentation. Un numéro contient une liste d'**étapes** jouées dans l'ordre — des musiques et des pauses — réorganisables au glisser-déposer.

Chaque musique se règle indépendamment :

- **Volume** propre à la piste, de 0 à 100
- **Début et fin** : ne jouer qu'un extrait, sans toucher au fichier d'origine
- **Fade in / fade out** en secondes, avec une courbe quadratique
- **Top de départ** : une note libre affichée au régisseur pour savoir sur quoi lancer

Les points de début et de fin se posent visuellement sur la forme d'onde, plutôt qu'en tapant des secondes à l'aveugle.

Une **pause** avec durée s'enchaîne automatiquement au bout du délai ; sans durée, elle attend une action du régisseur.

Un numéro peut aussi vivre seul, hors de tout spectacle, pour préparer un passage isolé.

## Pendant la représentation

L'enchaînement est automatique d'une étape à la suivante, la piste d'après étant préchargée pour éviter tout blanc. Tout se pilote au clavier :

| Action | Touche par défaut |
|---|---|
| Lecture / Pause | `Espace` |
| Piste suivante | `→` |
| Stop | `Échap` |
| Avance / recul | `↑` / `↓` |

Ces raccourcis sont tous reconfigurables dans les paramètres.

Le **mode spectacle** coupe les sons système pendant la représentation — notifications, bips — pour qu'aucun son parasite ne parte dans la sono.

La **sortie audio** se choisit explicitement : l'application peut jouer sur la carte son de la sono pendant que le reste de l'ordinateur reste sur les haut-parleurs internes.

## Avant de monter sur scène

La **vérification du spectacle** contrôle en un clic tout ce qui casse une représentation :

- fichier audio manquant ou déplacé
- point de début postérieur au point de fin
- fades cumulés plus longs que l'extrait à jouer
- piste laissée à un volume de 0
- périphérique de sortie configuré mais absent

## Ajouter des musiques

Trois sources : un **fichier** de l'ordinateur, une **URL** directe, ou une vidéo **YouTube** dont l'audio est extrait. yt-dlp est embarqué dans l'application et se met à jour depuis les paramètres, sans installation séparée.

Les fichiers sont copiés dans le dossier du projet : celui-ci reste autonome et déplaçable.

## Partager un spectacle

- **Fichier** : export en `.regieson` (spectacle) ou `.regiesonnumero` (numéro seul), une archive contenant la structure et toutes les musiques. Un double-clic sur le fichier l'importe directement.
- **Cloud** : envoi anonyme qui renvoie un **code court** à transmettre, sans compte ni inscription. Les fichiers sont hébergés sur Litterbox et **expirent au bout de 72 h** — c'est fait pour dépanner un collègue, pas pour archiver.

## Sécurité du travail

Les modifications sont enregistrées automatiquement, avec écriture atomique et rotation de sauvegardes : une coupure de courant en pleine édition ne laisse pas de projet à moitié écrit. Un historique d'annulation de 50 niveaux couvre les fausses manœuvres, en regroupant les saisies continues pour qu'annuler ne remonte pas caractère par caractère.

## Développement

Stack : Tauri 2 (Rust) + React 18 + TypeScript + Vite.

```bash
npm install
npm run tauri dev
```

Éditeur conseillé : [VS Code](https://code.visualstudio.com/) avec [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) et [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).

Une release est produite en poussant un tag `v*` ; le workflow construit et signe les binaires pour les quatre plateformes.
