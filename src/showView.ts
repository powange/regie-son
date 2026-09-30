import { Numero, PlaylistItem, Project } from "./types";
import type { PlayerState } from "./usePlayer";
import { getNextContext, nextItemPosition, NextContext } from "./playerNav";

export interface ShowViewModel {
  current: { numero: Numero; item: PlaylistItem } | null;
  next: NextContext | null;
  // What the big clock shows: seconds left in the excerpt or in a timed
  // pause. Null when there is nothing to count down (untimed pause, nothing
  // loaded, duration still unknown).
  remaining: number | null;
  // Share of the excerpt or timed pause already played, in [0, 1].
  elapsedRatio: number;
  onUntimedPause: boolean;
  hasAudio: boolean;
}

// Everything the show view displays, derived from the player state alone so
// that it always agrees with the player bar.
export function showViewModel(state: PlayerState, project: Project): ShowViewModel {
  const { position, progress } = state;
  const numero = position ? project.numeros[position.numeroIndex] : undefined;
  const item = position ? numero?.items[position.audioIndex] : undefined;
  const current = numero && item ? { numero, item } : null;

  let remaining: number | null = null;
  let elapsedRatio = 0;
  let onUntimedPause = false;
  if (item?.type === "pause") {
    const duration = item.duration ?? 0;
    if (duration > 0) {
      remaining = Math.max(0, duration - progress.position);
      elapsedRatio = Math.min(1, progress.position / duration);
    } else {
      onUntimedPause = true;
    }
  } else if (item && progress.duration > 0) {
    remaining = Math.max(0, progress.duration - progress.position);
    elapsedRatio = Math.min(1, progress.position / progress.duration);
  }

  // Stopped on a track, the player bar previews that very track, since Play
  // starts it. The show view already has it under "now": it shows the one
  // after instead.
  let next = getNextContext(state, project);
  if (next && position && next.item.id === current?.item.id) {
    const after = nextItemPosition(project, position);
    const n = after ? project.numeros[after.numeroIndex] : undefined;
    const i = after ? n?.items[after.audioIndex] : undefined;
    next = n && i ? { numero: n, item: i } : null;
  }

  return {
    current,
    next,
    remaining,
    elapsedRatio,
    onUntimedPause,
    hasAudio: project.numeros.some((n) => n.items.some((i) => i.type === "audio")),
  };
}

// m:ss, rounded up: "0:01" stays on screen until the very end, and the clock
// reaches "0:00" when the excerpt does.
export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds - 1e-6));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
