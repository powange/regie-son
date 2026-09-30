import { Project, PlaylistItem, Numero } from "./types";
import type { PlayerState, PlayerPosition } from "./usePlayer";

export interface NextContext {
  item: PlaylistItem;
  numero: Numero;
}

// The one definition of "what comes next", shared by Next, Space and the
// preview next to the Next button, so that the three always agree.
export function firstItemPosition(project: Project): PlayerPosition | null {
  for (let ni = 0; ni < project.numeros.length; ni++) {
    if (project.numeros[ni].items.length > 0) return { numeroIndex: ni, audioIndex: 0 };
  }
  return null;
}

export function nextItemPosition(project: Project, pos: PlayerPosition): PlayerPosition | null {
  const items = project.numeros[pos.numeroIndex]?.items ?? [];
  if (pos.audioIndex + 1 < items.length) {
    return { numeroIndex: pos.numeroIndex, audioIndex: pos.audioIndex + 1 };
  }
  for (let ni = pos.numeroIndex + 1; ni < project.numeros.length; ni++) {
    if (project.numeros[ni].items.length > 0) return { numeroIndex: ni, audioIndex: 0 };
  }
  return null;
}

function contextAt(project: Project, pos: PlayerPosition | null): NextContext | null {
  if (!pos) return null;
  const numero = project.numeros[pos.numeroIndex];
  const item = numero?.items[pos.audioIndex];
  return item && numero ? { item, numero } : null;
}

// Détermine quel élément afficher à côté du bouton Suivant :
// - Si rien n'est lu : le premier élément du projet
// - Si arrêté sur un item audio : on affiche cet item (aperçu de ce qui va être lu)
// - Si en lecture OU sur une pause : on cherche l'item qui vient après
export function getNextContext(state: PlayerState, project: Project): NextContext | null {
  const { position, isPlaying } = state;
  if (!position) return contextAt(project, firstItemPosition(project));
  const currentItem = project.numeros[position.numeroIndex]?.items[position.audioIndex];
  const onPause = currentItem?.type === "pause";
  if (!isPlaying && !onPause) return contextAt(project, position);
  return contextAt(project, nextItemPosition(project, position));
}

// The player remembers the current item by id, not by index: deleting,
// inserting or reordering items during the show must not move it.
export function findItemPosition(project: Project, itemId: string): PlayerPosition | null {
  for (let ni = 0; ni < project.numeros.length; ni++) {
    const ii = project.numeros[ni].items.findIndex((item) => item.id === itemId);
    if (ii !== -1) return { numeroIndex: ni, audioIndex: ii };
  }
  return null;
}

// Where to go on Next once the current item has been deleted: whatever now
// sits at its old index is the item that used to follow it.
export function itemAtOrAfter(project: Project, pos: PlayerPosition): PlayerPosition | null {
  if (project.numeros[pos.numeroIndex]?.items[pos.audioIndex]) return pos;
  for (let ni = pos.numeroIndex + 1; ni < project.numeros.length; ni++) {
    if (project.numeros[ni].items.length > 0) return { numeroIndex: ni, audioIndex: 0 };
  }
  return null;
}
