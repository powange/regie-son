import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import i18next from "i18next";
import { AudioFile, PlaylistItem, Project } from "./types";
import {
  findItemPosition,
  firstItemPosition,
  itemAtOrAfter,
  nextItemPosition,
  prevItemPosition,
} from "./playerNav";

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

export interface PlayerOptions {
  // Seconds of overlap between a track and the next one; 0 (the default)
  // plays them one after the other.
  crossfadeSeconds?: number;
}

// Where playback stood when the app last ran, offered back after a crash.
export interface ResumeOffer {
  itemId: string;
  time: number;
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
const STOP_FADE_SECONDS = 0.25;
const PANIC_FADE_SECONDS = 2;
const RESUME_FADE_SECONDS = 1;
// Past this point into a track, Previous goes back to its start rather than
// to the item before it, like the previous button of any player.
const RESTART_THRESHOLD_SECONDS = 3;

const RESUME_KEY = "regie-son:resume";
const RESUME_SAVE_EVERY_MS = 2000;
const RESUME_MAX_AGE_MS = 12 * 3600 * 1000;

interface StoredResume extends ResumeOffer {
  projectPath: string;
  savedAt: number;
}

function saveResume(entry: StoredResume) {
  try { localStorage.setItem(RESUME_KEY, JSON.stringify(entry)); } catch { /* best effort */ }
}

function clearResume() {
  try { localStorage.removeItem(RESUME_KEY); } catch { /* best effort */ }
}

function readResume(project: Project): ResumeOffer | null {
  try {
    const raw = JSON.parse(localStorage.getItem(RESUME_KEY) ?? "null") as Partial<StoredResume> | null;
    if (
      !raw || raw.projectPath !== project.path ||
      typeof raw.itemId !== "string" || typeof raw.time !== "number" || typeof raw.savedAt !== "number" ||
      Date.now() - raw.savedAt > RESUME_MAX_AGE_MS ||
      !findItemPosition(project, raw.itemId)
    ) return null;
    return { itemId: raw.itemId, time: raw.time };
  } catch {
    return null;
  }
}

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

type SinkAudio = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };

// Fades and timed pauses run on timers rather than requestAnimationFrame: rAF
// stops altogether while the window is minimised or covered, which froze a
// fade mid-volume and left the next track waiting until the window came back.
const TICK_MS = 25;

interface PlayOptions {
  // File time to start from instead of the track's startTime (resume).
  fromTime?: number;
  // Fade-in to use instead of the track's own (crossfade, resume).
  fadeIn?: number;
}

export function usePlayer(project: Project, audioDeviceId: string | null, options: PlayerOptions = {}) {
  const [state, setState] = useState<InternalState>(IDLE);
  const stateRef = useRef(state);
  stateRef.current = state;
  const projectRef = useRef(project);
  projectRef.current = project;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  // The element currently playing. A crossfade hands this role to a second
  // element while the first one fades out on its own.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const spareRef = useRef<HTMLAudioElement | null>(null);
  const makeElementRef = useRef<() => HTMLAudioElement>(() => new Audio());
  const outgoingRef = useRef<{ el: HTMLAudioElement; timer: number } | null>(null);
  const sinkIdRef = useRef(audioDeviceId);
  const itemIdRef = useRef<string | null>(null);
  // Last index the current item was seen at: where Next resumes if it is deleted.
  const lastPosRef = useRef<PlayerPosition | null>(null);
  // Item whose file is loaded in the <audio> element, null while loading or after an error.
  const loadedItemIdRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const loadVersionRef = useRef(0);
  const playItemRef = useRef<(nIdx: number, iIdx: number, opts?: PlayOptions) => void>(() => {});
  const advanceRef = useRef<(fadeSeconds?: number) => void>(() => {});
  const stopRef = useRef<() => void>(() => {});
  const fadeTimerRef = useRef<number | null>(null);
  const fadingOutRef = useRef(false);
  const ignoreSrcErrorRef = useRef(false);
  const lastResumeSaveRef = useRef(0);
  const [resumeOffer, setResumeOffer] = useState<ResumeOffer | null>(() => readResume(project));

  function currentPosition(): PlayerPosition | null {
    const id = itemIdRef.current;
    if (id === null) return null;
    const pos = findItemPosition(projectRef.current, id);
    if (pos) lastPosRef.current = pos;
    return pos;
  }

  function itemAt(pos: PlayerPosition | null): PlaylistItem | null {
    return pos ? projectRef.current.numeros[pos.numeroIndex]?.items[pos.audioIndex] ?? null : null;
  }

  // The item as it is now in the project, so that a volume changed during a
  // fade is the one the fade ends on.
  function liveVolume(itemId: string, fallback: number): number {
    const item = itemAt(findItemPosition(projectRef.current, itemId));
    return item?.type === "audio" ? itemVolume(item) : fallback;
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

  // Silences and empties an element that is no longer the playing one. Its
  // events are ignored, so no flag is involved.
  function releaseOutgoing() {
    const out = outgoingRef.current;
    if (!out) return;
    window.clearInterval(out.timer);
    out.el.pause();
    out.el.removeAttribute("src");
    out.el.load();
    outgoingRef.current = null;
  }

  // Lets the current element fade out on its own over `seconds` while the
  // next track starts on the other element.
  function handOver(seconds: number): HTMLAudioElement {
    releaseOutgoing();
    const out = audioRef.current!;
    const startVolume = out.volume;
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      const t = Math.min(1, (performance.now() - startedAt) / 1000 / seconds);
      const r = 1 - t;
      out.volume = startVolume * r * r;
      if (t >= 1) releaseOutgoing();
    }, TICK_MS);
    outgoingRef.current = { el: out, timer };
    spareRef.current ??= makeElementRef.current();
    const incoming = spareRef.current;
    spareRef.current = out;
    audioRef.current = incoming;
    loadedItemIdRef.current = null;
    return incoming;
  }

  const playItem = useCallback((nIdx: number, iIdx: number, opts: PlayOptions = {}) => {
    const audio = audioRef.current;
    if (!audio) return;
    cancelFade();
    cancelPauseTimer();
    const proj = projectRef.current;
    const item = proj.numeros[nIdx]?.items[iIdx];
    if (!item) return;
    setResumeOffer(null);

    // The target becomes current right away, before it has loaded: if the
    // load fails, Next moves past it instead of retrying it forever.
    itemIdRef.current = item.id;
    lastPosRef.current = { numeroIndex: nIdx, audioIndex: iIdx };
    // Any audio load still in flight must not start over the new item.
    const version = ++loadVersionRef.current;
    saveResume({ projectPath: proj.path, itemId: item.id, time: 0, savedAt: Date.now() });

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

    const initialVolume = itemVolume(item);
    const fadeIn = opts.fadeIn ?? item.fadeIn ?? 0;
    const startAt = opts.fromTime ?? item.startTime ?? 0;
    // Streamed from disk through the asset protocol, which serves Range
    // requests: playback starts after the first chunk, with no IPC transfer
    // and no copy of the whole file in memory.
    audio.src = convertFileSrc(proj.path + "/musiques/" + item.filename);
    audio.load();
    audio.currentTime = startAt;
    // Some engines reset a position set before the metadata is known.
    const onMetadata = () => {
      audio.removeEventListener("loadedmetadata", onMetadata);
      if (version === loadVersionRef.current && Math.abs(audio.currentTime - startAt) > 0.25) {
        audio.currentTime = startAt;
      }
    };
    audio.addEventListener("loadedmetadata", onMetadata);
    audio.volume = fadeIn > 0 ? 0 : initialVolume;
    loadedItemIdRef.current = item.id;

    audio.play()
      .then(() => {
        if (version !== loadVersionRef.current) return;
        loadingRef.current = false;
        setState((s) => ({ ...s, isPlaying: true, audioError: null }));
        if (fadeIn > 0) {
          runFade(
            "in",
            fadeIn,
            (t) => { audio.volume = liveVolume(item.id, initialVolume) * t * t; }, // courbe quadratique (perçue comme naturelle)
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

  playItemRef.current = playItem;
  const playAt = useCallback((nIdx: number, iIdx: number) => playItem(nIdx, iIdx), [playItem]);

  useEffect(() => {
    // Every element gets the same listeners; only the playing one is heard.
    const attach = (audio: HTMLAudioElement) => {
      audio.addEventListener("timeupdate", () => {
        if (audio !== audioRef.current) return;
        const id = itemIdRef.current;
        if (id === null || loadedItemIdRef.current !== id) return;
        const pos = findItemPosition(projectRef.current, id);
        const item = itemAt(pos);
        if (item?.type !== "audio") return;

        if (!fadingOutRef.current) {
          const end = item.endTime ?? (isFinite(audio.duration) ? audio.duration : null);
          if (end !== null) {
            const left = end - audio.currentTime;
            // Start leaving the track early enough that the fade (or the
            // crossfade into an audio track) ends on the cut point.
            const nextItem = itemAt(pos ? nextItemPosition(projectRef.current, pos) : null);
            const cross = nextItem?.type === "audio" ? optionsRef.current.crossfadeSeconds ?? 0 : 0;
            const lead = cross > 0 ? cross : item.fadeOut ?? 0;
            if (lead > 0 && left <= lead) { advanceRef.current(Math.max(left, 0)); return; }
            if (item.endTime !== undefined && left <= 0) { advanceRef.current(0); return; }
          }
        }

        const now = Date.now();
        if (now - lastResumeSaveRef.current >= RESUME_SAVE_EVERY_MS) {
          lastResumeSaveRef.current = now;
          saveResume({ projectPath: projectRef.current.path, itemId: id, time: audio.currentTime, savedAt: now });
        }

        const { start, end } = playWindow(item, audio.duration);
        setState((s) => ({
          ...s,
          progress: {
            position: Math.max(0, Math.min(audio.currentTime - start, end - start)),
            duration: end - start,
          },
        }));
      });

      audio.addEventListener("ended", () => {
        if (audio !== audioRef.current) return;
        if (!fadingOutRef.current) advanceRef.current(0);
      });

      audio.addEventListener("error", () => {
        if (audio !== audioRef.current) return;
        if (ignoreSrcErrorRef.current) { ignoreSrcErrorRef.current = false; return; }
        if (!itemIdRef.current) return;
        setState((s) => ({ ...s, isPlaying: false, audioError: playbackError() }));
      });
    };

    const makeElement = () => {
      const el = new Audio() as SinkAudio;
      attach(el);
      if (typeof el.setSinkId === "function") el.setSinkId(sinkIdRef.current ?? "").catch(() => {});
      return el;
    };
    makeElementRef.current = makeElement;
    const audio = new Audio();
    attach(audio);
    audioRef.current = audio;

    return () => {
      if (fadeTimerRef.current !== null) {
        window.clearInterval(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
      fadingOutRef.current = false;
      loadVersionRef.current++;
      releaseOutgoing();
      for (const el of [audioRef.current, spareRef.current]) {
        if (!el) continue;
        el.pause();
        el.src = "";
      }
      cancelPauseTimer();
      // Leaving the editor is a normal end: nothing to resume next time.
      clearResume();
    };
  }, []);

  // Routes to the chosen output, back to the system default when none is
  // chosen, and again whenever a device comes or goes. A failure is shown:
  // silently playing on the laptop speakers is the worst outcome in a show.
  // Where setSinkId does not exist (WebKit), the preflight says so instead.
  useEffect(() => {
    sinkIdRef.current = audioDeviceId;
    const apply = () => {
      for (const el of [audioRef.current, spareRef.current] as Array<SinkAudio | null>) {
        if (!el || typeof el.setSinkId !== "function") continue;
        const isActive = el === audioRef.current;
        el.setSinkId(audioDeviceId ?? "")
          .then(() => { if (isActive) setState((s) => (s.outputError === null ? s : { ...s, outputError: null })); })
          .catch((err: unknown) => {
            if (!isActive) return;
            const detail = err instanceof Error ? err.message : String(err);
            setState((s) => ({ ...s, outputError: i18next.t("audio:player.outputFailed", { detail }) }));
          });
      }
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
    const item = itemAt(findItemPosition(project, id));
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
      if (first) playItemRef.current(first.numeroIndex, first.audioIndex);
      return;
    }

    const pos = currentPosition();
    const item = itemAt(pos);

    if (item?.type === "pause") {
      const t = pauseTimerRef.current;
      // Untimed pause: Space moves on exactly like Next does, to the item the
      // preview shows, even if that is another pause carrying a cue.
      if (!t || t.duration <= 0) {
        const nxt = nextItemPosition(projectRef.current, pos!);
        if (nxt) playItemRef.current(nxt.numeroIndex, nxt.audioIndex);
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
      if (pos) playItemRef.current(pos.numeroIndex, pos.audioIndex);
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
      if (first) playItemRef.current(first.numeroIndex, first.audioIndex);
      return;
    }

    const audio = audioRef.current;
    const pos = currentPosition();
    const item = itemAt(pos);

    // Resolved when the fade is over: the list may have changed meanwhile.
    const nextPosition = () => {
      const proj = projectRef.current;
      const cur = currentPosition();
      const last = lastPosRef.current;
      return cur ? nextItemPosition(proj, cur) : last ? itemAtOrAfter(proj, last) : null;
    };
    const doAdvance = () => {
      const nxt = nextPosition();
      if (nxt) playItemRef.current(nxt.numeroIndex, nxt.audioIndex);
      // End of the show: stop cleanly instead of leaving a silent track playing.
      else stopRef.current();
    };

    const audible = !!audio && loadedItemIdRef.current === id && !audio.paused && !audio.ended;

    // Crossfade: the next track starts now while this one fades out on its
    // own element. Only between two tracks: a pause keeps its silence.
    const cross = optionsRef.current.crossfadeSeconds ?? 0;
    const nxt = nextPosition();
    const nextItem = itemAt(nxt);
    if (audible && cross > 0 && nxt && nextItem?.type === "audio") {
      const overlap = fadeSeconds !== undefined ? Math.min(fadeSeconds, cross) : cross;
      if (overlap > 0) {
        cancelFade();
        handOver(overlap);
        playItemRef.current(nxt.numeroIndex, nxt.audioIndex, {
          fadeIn: nextItem.fadeIn && nextItem.fadeIn > 0 ? nextItem.fadeIn : overlap,
        });
        return;
      }
    }

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

  // Back to the start of the current track once it has been playing a few
  // seconds, otherwise to the item before it.
  const previous = useCallback(() => {
    const audio = audioRef.current;
    const pos = currentPosition();
    if (!audio || !pos) return;
    const item = itemAt(pos);
    if (item?.type === "audio" && loadedItemIdRef.current === item.id) {
      const { start } = playWindow(item, audio.duration);
      if (audio.currentTime - start > RESTART_THRESHOLD_SECONDS) {
        audio.currentTime = start;
        setState((s) => ({ ...s, progress: { ...s.progress, position: 0 } }));
        return;
      }
    }
    const prev = prevItemPosition(projectRef.current, pos);
    const target = prev ?? pos;
    playItemRef.current(target.numeroIndex, target.audioIndex);
  }, []);

  // `position` is relative to the track's window, like `progress`; the seek
  // never leaves the excerpt.
  const seek = useCallback((position: number) => {
    const audio = audioRef.current;
    const pos = currentPosition();
    if (!audio || !pos || loadedItemIdRef.current !== itemIdRef.current) return;
    const item = itemAt(pos);
    if (item?.type !== "audio") return;
    const { start, end } = playWindow(item, audio.duration);
    audio.currentTime = start + Math.max(0, Math.min(position, end - start));
  }, []);

  const stopWithFade = useCallback((seconds: number) => {
    // Invalidate any load in flight, or the track would start after Stop.
    loadVersionRef.current++;
    loadingRef.current = false;
    releaseOutgoing();
    const audio = audioRef.current;
    const wasPlaying = !!audio && !audio.paused && audio.volume > 0;
    const finalize = () => {
      if (audio) { unloadAudio(audio); audio.currentTime = 0; }
      itemIdRef.current = null;
      lastPosRef.current = null;
      clearResume();
      setState((s) => ({ ...IDLE, outputError: s.outputError }));
    };

    cancelFade();
    cancelPauseTimer();

    if (!wasPlaying || !audio) {
      finalize();
      return;
    }

    // Avoid the pop of an abrupt cut; the panic fade is just a longer one.
    const startVolume = audio.volume;
    fadingOutRef.current = true;
    runFade(
      "out",
      seconds,
      (t) => { const r = 1 - t; audio.volume = startVolume * r * r; },
      () => {
        fadingOutRef.current = false;
        finalize();
      },
    );
  }, []);

  const stop = useCallback(() => stopWithFade(STOP_FADE_SECONDS), [stopWithFade]);
  const panicFade = useCallback(() => stopWithFade(PANIC_FADE_SECONDS), [stopWithFade]);
  stopRef.current = stop;

  const resume = useCallback(() => {
    const offer = resumeOffer;
    if (!offer) return;
    const pos = findItemPosition(projectRef.current, offer.itemId);
    setResumeOffer(null);
    if (!pos) return;
    playItemRef.current(pos.numeroIndex, pos.audioIndex, { fromTime: offer.time, fadeIn: RESUME_FADE_SECONDS });
  }, [resumeOffer]);

  const dismissResume = useCallback(() => {
    setResumeOffer(null);
    clearResume();
  }, []);

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

  return {
    state: publicState,
    playAt,
    togglePlay,
    next,
    previous,
    stop,
    panicFade,
    seek,
    resumeOffer,
    resume,
    dismissResume,
  };
}
