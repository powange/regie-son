import { Numero, PlaylistItem, Project } from "./types";
import type { PlayerPosition, PlayerProgress } from "./usePlayer";
import type { ShowDuration } from "./preflight";

// Playing time of one item, counted like estimateShowDuration: the excerpt of
// a track, the delay of a timed pause. Null when it cannot be known: an
// untimed pause waits for the operator, and a file whose metadata has not
// been read yet has no length.
export function itemDuration(item: PlaylistItem, durations: Map<string, number>): number | null {
  if (item.type === "pause") return typeof item.duration === "number" ? item.duration : null;
  const end = item.endTime ?? durations.get(item.filename);
  if (end === undefined) return null;
  return Math.max(0, end - (item.startTime ?? 0));
}

function sum(items: PlaylistItem[], durations: Map<string, number>): ShowDuration {
  let seconds = 0;
  let complete = true;
  for (const item of items) {
    const d = itemDuration(item, durations);
    if (d === null) complete = false;
    else seconds += d;
  }
  return { seconds, complete };
}

export function numeroDuration(numero: Numero, durations: Map<string, number>): ShowDuration {
  return sum(numero.items, durations);
}

// What is left to play from the current item on. With nothing current, the
// whole show. The current item counts for what is left of it: the player's
// progress is relative to the excerpt or to the timed pause.
export function remainingShowDuration(
  project: Project,
  durations: Map<string, number>,
  position: PlayerPosition | null,
  progress: PlayerProgress,
): ShowDuration {
  if (!position) return sum(project.numeros.flatMap((n) => n.items), durations);

  const after: PlaylistItem[] = [
    ...(project.numeros[position.numeroIndex]?.items.slice(position.audioIndex + 1) ?? []),
    ...project.numeros.slice(position.numeroIndex + 1).flatMap((n) => n.items),
  ];
  const rest = sum(after, durations);

  const current = project.numeros[position.numeroIndex]?.items[position.audioIndex];
  if (!current) return rest;
  const full = current.type === "audio" && progress.duration > 0
    ? progress.duration
    : itemDuration(current, durations);
  if (full === null) return { seconds: rest.seconds, complete: false };
  return { seconds: rest.seconds + Math.max(0, full - progress.position), complete: rest.complete };
}
