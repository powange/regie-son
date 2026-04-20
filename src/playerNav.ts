import { Project, PlaylistItem, Numero } from "./types";
import { PlayerState } from "./usePlayer";

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
