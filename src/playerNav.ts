import { Project, PlaylistItem, Numero } from "./types";
import type { PlayerState, PlayerPosition } from "./usePlayer";

export interface NextContext {
  item: PlaylistItem;
  numero: Numero;
}

// Détermine quel élément afficher à côté du bouton Suivant :
// - Si rien n'est lu : le premier élément du projet
// - Si arrêté sur un item audio : on affiche cet item (aperçu de ce qui va être lu)
// - Si en lecture OU sur une pause : on cherche l'item qui vient après
export function getNextContext(state: PlayerState, project: Project): NextContext | null {
  const { position, isPlaying } = state;
  if (!position) {
    for (const numero of project.numeros) {
      if (numero.items.length > 0) return { item: numero.items[0], numero };
    }
    return null;
  }
  const currentItem = project.numeros[position.numeroIndex]?.items[position.audioIndex];
  const onPause = currentItem?.type === "pause";
  if (!isPlaying && !onPause) {
    const numero = project.numeros[position.numeroIndex];
    const item = numero?.items[position.audioIndex];
    return item && numero ? { item, numero } : null;
  }
  const currentNumero = project.numeros[position.numeroIndex];
  const items = currentNumero?.items ?? [];
  if (position.audioIndex + 1 < items.length) {
    return { item: items[position.audioIndex + 1], numero: currentNumero };
  }
  for (let ni = position.numeroIndex + 1; ni < project.numeros.length; ni++) {
    if (project.numeros[ni].items.length > 0) {
      return { item: project.numeros[ni].items[0], numero: project.numeros[ni] };
    }
  }
  return null;
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
