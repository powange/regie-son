import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import i18next from "i18next";
import { AudioFile, Project } from "./types";
import { findItemPosition, firstItemPosition, itemAtOrAfter, nextItemPosition } from "./playerNav";

export interface PlayerPosition {
  numeroIndex: number;
  audioIndex: number;
}

// For a track, relative to its [startTime, endTime] window: what the operator
// cares about is the excerpt that plays, not the file it is cut from.
export interface PlayerProgress {
  position: number;
  duration: number;
}

export interface FadeState {
  type: "in" | "out";
  remaining: number;
  total: number;
}

export interface PlayerState {
  position: PlayerPosition | null;
  isPlaying: boolean;
  progress: PlayerProgress;
  audioError: string | null;
  // The chosen output could not be used; sound goes to the system default.
  outputError: string | null;
  fade: FadeState | null;
}

// The current item is held by id; `position` is derived from it on each render
// so that editing the list during the show never shifts what is playing.
interface InternalState extends Omit<PlayerState, "position"> {
  itemId: string | null;
}

const IDLE: InternalState = {
  itemId: null,
  isPlaying: false,
  progress: { position: 0, duration: 0 },
  audioError: null,
  outputError: null,
  fade: null,
};

const PAUSE_FADE_SECONDS = 0.15;

function itemVolume(item: AudioFile): number {
  return Math.max(0, Math.min(1, (item.volume ?? 100) / 100));
}

// The window of the file that plays, in file time.
function playWindow(item: AudioFile, fileDuration: number): { start: number; end: number } {
  const start = item.startTime ?? 0;
  const end = item.endTime ?? (isFinite(fileDuration) ? fileDuration : start);
  return { start, end: Math.max(start, end) };
}

function playbackError(): string {
  return i18next.t("audio:player.playbackError");
}

// Fades and timed pauses run on timers rather than requestAnimationFrame: rAF
// stops altogether while the window is minimised or covered, which froze a
// fade mid-volume and left the next track waiting until the window came back.
const TICK_MS = 25;

export function usePlayer(project: Project, audioDeviceId: string | null) {
  const [state, setState] = useState<InternalState>(IDLE);
  const stateRef = useRef(state);
  stateRef.current = state;
  const projectRef = useRef(project);
  projectRef.current = project;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const itemIdRef = useRef<string | null>(null);
  // Last index the current item was seen at: where Next resumes if it is deleted.
  const lastPosRef = useRef<PlayerPosition | null>(null);
  // Item whose file is loaded in the <audio> element, null while loading or after an error.
  const loadedItemIdRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const loadVersionRef = useRef(0);
  const playAtRef = useRef<(nIdx: number, iIdx: number) => void>(() => {});
  const advanceRef = useRef<(fadeSeconds?: number) => void>(() => {});
  const stopRef = useRef<() => void>(() => {});
  const fadeTimerRef = useRef<number | null>(null);
  const fadingOutRef = useRef(false);
  const ignoreSrcErrorRef = useRef(false);

  function currentPosition(): PlayerPosition | null {
    const id = itemIdRef.current;
    if (id === null) return null;
    const pos = findItemPosition(projectRef.current, id);
    if (pos) lastPosRef.current = pos;
    return pos;
  }

  function cancelFade() {
    if (fadeTimerRef.current !== null) {
      window.clearInterval(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    fadingOutRef.current = false;
    setState((s) => (s.fade === null ? s : { ...s, fade: null }));
  }

  // Drives a fade from wall-clock time on an interval. `apply` receives the
  // progress in [0, 1]; a late tick jumps straight to the right volume.
  // `isStale` lets a fade-in stand down once a newer track has been requested.
  function runFade(
    type: "in" | "out",
    duration: number,
    apply: (progress: number) => void,
    onDone: () => void,
    isStale: () => boolean = () => false,
    // Short de-click fades around pause/resume are not shown to the operator.
    quiet = false,
  ) {
    const startedAt = performance.now();
    if (!quiet) setState((s) => ({ ...s, fade: { type, remaining: duration, total: duration } }));
    const id = window.setInterval(() => {
      if (isStale()) {
        window.clearInterval(id);
        if (fadeTimerRef.current === id) fadeTimerRef.current = null;
        return;
      }
      const elapsed = (performance.now() - startedAt) / 1000;
      if (elapsed >= duration) {
        window.clearInterval(id);
        fadeTimerRef.current = null;
        apply(1);
        onDone();
        return;
      }
      apply(elapsed / duration);
      if (!quiet) setState((s) => ({ ...s, fade: { type, remaining: duration - elapsed, total: duration } }));
    }, TICK_MS);
    fadeTimerRef.current = id;
  }

  // Timed pause: counts down in real time and advances to the next item when done.
  const pauseTimerRef = useRef<{
    duration: number;
    elapsed: number;       // seconds accumulated across pause/resume cycles
    startedAt: number | null; // performance.now() when currently running, null when paused
    timerId: number | null;
  } | null>(null);

  function cancelPauseTimer() {
    const t = pauseTimerRef.current;
    if (!t) return;
    if (t.timerId !== null) window.clearInterval(t.timerId);
    pauseTimerRef.current = null;
  }

  function runPauseTimerTick() {
    const t = pauseTimerRef.current;
    if (!t || t.startedAt === null) return;
    if (t.timerId !== null) window.clearInterval(t.timerId);
    t.timerId = window.setInterval(() => {
      const cur = pauseTimerRef.current;
      if (!cur || cur.startedAt === null) return;
      const totalElapsed = cur.elapsed + (performance.now() - cur.startedAt) / 1000;
      if (totalElapsed >= cur.duration) {
        cancelPauseTimer();
        setState((s) => ({ ...s, progress: { position: cur.duration, duration: cur.duration } }));
        advanceRef.current();
        return;
      }
      setState((s) => ({ ...s, progress: { position: totalElapsed, duration: cur.duration } }));
    }, TICK_MS);
  }

  // Drops whatever file the <audio> element holds, so that play() can never
  // resume a previous track once the player has moved on.
  function unloadAudio(audio: HTMLAudioElement) {
    audio.pause();
    // Emptying src raises an "error" event, but only if there was a source:
    // arming the flag otherwise would swallow the next real error.
    if (audio.getAttribute("src")) {
      ignoreSrcErrorRef.current = true;
      audio.src = "";
    }
    loadedItemIdRef.current = null;
  }

  const playAt = useCallback((nIdx: number, iIdx: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    cancelFade();
    cancelPauseTimer();
    const proj = projectRef.current;
    const item = proj.numeros[nIdx]?.items[iIdx];
    if (!item) return;

    // The target becomes current right away, before it has loaded: if the
    // load fails, Next moves past it instead of retrying it forever.
    itemIdRef.current = item.id;
    lastPosRef.current = { numeroIndex: nIdx, audioIndex: iIdx };
    // Any audio load still in flight must not start over the new item.
    const version = ++loadVersionRef.current;

    if (item.type === "pause") {
      loadingRef.current = false;
      unloadAudio(audio);
      const duration = item.duration && item.duration > 0 ? item.duration : 0;
      if (duration > 0) {
        pauseTimerRef.current = { duration, elapsed: 0, startedAt: performance.now(), timerId: null };
        setState((s) => ({
          ...s,
          itemId: item.id,
          isPlaying: true,
          progress: { position: 0, duration },
          audioError: null,
        }));
        runPauseTimerTick();
      } else {
        setState((s) => ({
          ...s,
          itemId: item.id,
          isPlaying: false,
          progress: { position: 0, duration: 0 },
          audioError: null,
        }));
      }
      return;
    }

    audio.pause();
    loadedItemIdRef.current = null;
    loadingRef.current = true;
    setState((s) => ({
      ...s,
      itemId: item.id,
      isPlaying: false,
      progress: { position: 0, duration: 0 },
      audioError: null,
    }));

    const targetVolume = itemVolume(item);
    // Streamed from disk through the asset protocol, which serves Range
    // requests: playback starts after the first chunk, with no IPC transfer
    // and no copy of the whole file in memory.
    audio.src = convertFileSrc(proj.path + "/musiques/" + item.filename);
    audio.load();
    audio.currentTime = item.startTime ?? 0;
    audio.volume = (item.fadeIn && item.fadeIn > 0) ? 0 : targetVolume;
    loadedItemIdRef.current = item.id;

    audio.play()
      .then(() => {
        if (version !== loadVersionRef.current) return;
        loadingRef.current = false;
        setState((s) => ({ ...s, isPlaying: true, audioError: null }));
        if (item.fadeIn && item.fadeIn > 0) {
          runFade(
            "in",
            item.fadeIn,
            (t) => { audio.volume = targetVolume * t * t; }, // courbe quadratique (perçue comme naturelle)
            () => setState((s) => ({ ...s, fade: null })),
            () => version !== loadVersionRef.current,
          );
        } else {
          setState((s) => (s.fade === null ? s : { ...s, fade: null }));
        }
      })
      .catch(() => {
        if (version !== loadVersionRef.current) return;
        loadingRef.current = false;
        unloadAudio(audio);
        setState((s) => ({ ...s, isPlaying: false, audioError: playbackError() }));
      });
  }, []);

  playAtRef.current = playAt;

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    audio.addEventListener("timeupdate", () => {
      const id = itemIdRef.current;
      if (id !== null && loadedItemIdRef.current === id && !fadingOutRef.current) {
        const pos = findItemPosition(projectRef.current, id);
        const item = pos ? projectRef.current.numeros[pos.numeroIndex].items[pos.audioIndex] : null;
        if (item?.type === "audio") {
          const end = item.endTime ?? (isFinite(audio.duration) ? audio.duration : null);
          if (end !== null) {
            const left = end - audio.currentTime;
            // Start the fade-out early enough that it ends on the cut point.
            const fadeOut = item.fadeOut ?? 0;
            if (fadeOut > 0 && left <= fadeOut) { advanceRef.current(Math.max(left, 0)); return; }
            if (item.endTime !== undefined && left <= 0) { advanceRef.current(0); return; }
          }
        }
      }
      const cur = id !== null ? findItemPosition(projectRef.current, id) : null;
      const curItem = cur ? projectRef.current.numeros[cur.numeroIndex].items[cur.audioIndex] : null;
      if (curItem?.type !== "audio" || loadedItemIdRef.current !== id) return;
      const { start, end } = playWindow(curItem, audio.duration);
      setState((s) => ({
        ...s,
        progress: {
          position: Math.max(0, Math.min(audio.currentTime - start, end - start)),
          duration: end - start,
        },
      }));
    });

    audio.addEventListener("ended", () => {
      if (!fadingOutRef.current) advanceRef.current(0);
    });

    audio.addEventListener("error", () => {
      if (ignoreSrcErrorRef.current) { ignoreSrcErrorRef.current = false; return; }
      if (!itemIdRef.current) return;
      setState((s) => ({ ...s, isPlaying: false, audioError: playbackError() }));
    });

    return () => {
      if (fadeTimerRef.current !== null) {
        window.clearInterval(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
      fadingOutRef.current = false;
      loadVersionRef.current++;
      audio.pause();
      audio.src = "";
      cancelPauseTimer();
    };
  }, []);

  // Routes to the chosen output, back to the system default when none is
  // chosen, and again whenever a device comes or goes. A failure is shown:
  // silently playing on the laptop speakers is the worst outcome in a show.
  // Where setSinkId does not exist (WebKit), the preflight says so instead.
  useEffect(() => {
    const audio = audioRef.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!audio || typeof audio.setSinkId !== "function") return;
    const apply = () => {
      audio.setSinkId!(audioDeviceId ?? "")
        .then(() => setState((s) => (s.outputError === null ? s : { ...s, outputError: null })))
        .catch((err: unknown) => {
          const detail = err instanceof Error ? err.message : String(err);
          setState((s) => ({ ...s, outputError: i18next.t("audio:player.outputFailed", { detail }) }));
        });
    };
    apply();
    const devices = navigator.mediaDevices;
    devices?.addEventListener?.("devicechange", apply);
    return () => devices?.removeEventListener?.("devicechange", apply);
  }, [audioDeviceId]);

  // Sync volume in real-time when the project changes (e.g. user drags volume slider)
  useEffect(() => {
    const audio = audioRef.current;
    const id = itemIdRef.current;
    if (!audio || id === null || loadedItemIdRef.current !== id) return;
    if (fadingOutRef.current || fadeTimerRef.current !== null) return;
    const pos = findItemPosition(project, id);
    const item = pos ? project.numeros[pos.numeroIndex].items[pos.audioIndex] : null;
    if (item?.type === "audio") {
      audio.volume = itemVolume(item);
    }
  }, [project]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const id = itemIdRef.current;

    if (id === null) {
      const first = firstItemPosition(projectRef.current);
      if (first) playAtRef.current(first.numeroIndex, first.audioIndex);
      return;
    }

    const pos = currentPosition();
    const item = pos ? projectRef.current.numeros[pos.numeroIndex].items[pos.audioIndex] : null;

    if (item?.type === "pause") {
      const t = pauseTimerRef.current;
      // Untimed pause: Space moves on exactly like Next does, to the item the
      // preview shows, even if that is another pause carrying a cue.
      if (!t || t.duration <= 0) {
        const nxt = nextItemPosition(projectRef.current, pos!);
        if (nxt) playAtRef.current(nxt.numeroIndex, nxt.audioIndex);
        return;
      }
      // Timed pause: toggle the countdown.
      if (stateRef.current.isPlaying) {
        if (t.timerId !== null) { window.clearInterval(t.timerId); t.timerId = null; }
        if (t.startedAt !== null) {
          t.elapsed += (performance.now() - t.startedAt) / 1000;
          t.startedAt = null;
        }
        setState((s) => ({ ...s, isPlaying: false }));
      } else {
        t.startedAt = performance.now();
        runPauseTimerTick();
        setState((s) => ({ ...s, isPlaying: true }));
      }
      return;
    }

    if (loadingRef.current) return;

    // Nothing of this item in the <audio> element (its load failed): load it
    // again rather than resume whatever played before.
    if (loadedItemIdRef.current !== id) {
      if (pos) playAtRef.current(pos.numeroIndex, pos.audioIndex);
      return;
    }

    // A short fade on both sides of a pause avoids the click of a hard cut.
    if (stateRef.current.isPlaying) {
      cancelFade();
      const startVolume = audio.volume;
      setState((s) => ({ ...s, isPlaying: false }));
      runFade(
        "out",
        PAUSE_FADE_SECONDS,
        (t) => { audio.volume = startVolume * (1 - t); },
        () => audio.pause(),
        undefined,
        true,
      );
    } else {
      // Cancels a pause fade still running, which would pause right after.
      cancelFade();
      const target = item?.type === "audio" ? itemVolume(item) : audio.volume;
      audio.volume = 0;
      const version = loadVersionRef.current;
      audio.play()
        .then(() => {
          setState((s) => ({ ...s, isPlaying: true, audioError: null }));
          runFade(
            "in",
            PAUSE_FADE_SECONDS,
            (t) => { audio.volume = target * t; },
            () => {},
            () => version !== loadVersionRef.current,
            true,
          );
        })
        .catch(() => {
          audio.volume = target;
          setState((s) => ({ ...s, isPlaying: false, audioError: playbackError() }));
        });
    }
  }, []);

  // Moves to the next item, fading the current track out first when it is
  // audible. `fadeSeconds` overrides the item's own fadeOut: 0 when the track
  // has already ended, the time left when an automatic fade starts late.
  const advance = useCallback((fadeSeconds?: number): void => {
    if (fadingOutRef.current) return;

    const id = itemIdRef.current;
    if (id === null) {
      const first = firstItemPosition(projectRef.current);
      if (first) playAtRef.current(first.numeroIndex, first.audioIndex);
      return;
    }

    const audio = audioRef.current;
    const pos = currentPosition();
    const item = pos ? projectRef.current.numeros[pos.numeroIndex].items[pos.audioIndex] : null;

    // Resolved when the fade is over: the list may have changed meanwhile.
    const doAdvance = () => {
      const proj = projectRef.current;
      const cur = currentPosition();
      const last = lastPosRef.current;
      const nxt = cur ? nextItemPosition(proj, cur) : last ? itemAtOrAfter(proj, last) : null;
      if (nxt) playAtRef.current(nxt.numeroIndex, nxt.audioIndex);
      // End of the show: stop cleanly instead of leaving a silent track playing.
      else stopRef.current();
    };

    const audible = !!audio && loadedItemIdRef.current === id && !audio.paused && !audio.ended;
    const duration = fadeSeconds ?? (item?.type === "audio" ? item.fadeOut ?? 0 : 0);
    if (audio && audible && duration > 0) {
      // A fade-in still running would fight this one for the volume.
      cancelFade();
      fadingOutRef.current = true;
      const startVolume = audio.volume;
      runFade(
        "out",
        duration,
        (t) => { const r = 1 - t; audio.volume = startVolume * r * r; }, // courbe quadratique descendante
        () => {
          fadingOutRef.current = false;
          setState((s) => ({ ...s, fade: null }));
          doAdvance();
        },
      );
    } else {
      doAdvance();
    }
  }, []);

  advanceRef.current = advance;

  const next = useCallback(() => advance(), [advance]);

  // `position` is relative to the track's window, like `progress`; the seek
  // never leaves the excerpt.
  const seek = useCallback((position: number) => {
    const audio = audioRef.current;
    const pos = currentPosition();
    if (!audio || !pos || loadedItemIdRef.current !== itemIdRef.current) return;
    const item = projectRef.current.numeros[pos.numeroIndex].items[pos.audioIndex];
    if (item.type !== "audio") return;
    const { start, end } = playWindow(item, audio.duration);
    audio.currentTime = start + Math.max(0, Math.min(position, end - start));
  }, []);

  const stop = useCallback(() => {
    // Invalidate any load in flight, or the track would start after Stop.
    loadVersionRef.current++;
    loadingRef.current = false;
    const audio = audioRef.current;
    const wasPlaying = !!audio && !audio.paused && audio.volume > 0;
    const finalize = () => {
      if (audio) { unloadAudio(audio); audio.currentTime = 0; }
      itemIdRef.current = null;
      lastPosRef.current = null;
      setState(IDLE);
    };

    cancelFade();
    cancelPauseTimer();

    if (!wasPlaying || !audio) {
      finalize();
      return;
    }

    // Safety fade-out: avoid audible pop on abrupt cut.
    const startVolume = audio.volume;
    fadingOutRef.current = true;
    runFade(
      "out",
      0.25,
      (t) => { const r = 1 - t; audio.volume = startVolume * r * r; },
      () => {
        fadingOutRef.current = false;
        finalize();
      },
    );
  }, []);

  stopRef.current = stop;

  const position = useMemo(
    () => (state.itemId === null ? null : findItemPosition(project, state.itemId)),
    [state.itemId, project],
  );
  const publicState = useMemo<PlayerState>(
    () => ({
      position,
      isPlaying: state.isPlaying,
      progress: state.progress,
      audioError: state.audioError,
      outputError: state.outputError,
      fade: state.fade,
    }),
    [position, state.isPlaying, state.progress, state.audioError, state.outputError, state.fade],
  );

  return { state: publicState, playAt, togglePlay, next, stop, seek };
}
