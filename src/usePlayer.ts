import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Project, PlaylistItem } from "./types";

function mimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav",
    flac: "audio/flac", m4a: "audio/mp4", aac: "audio/aac",
    wma: "audio/x-ms-wma", opus: "audio/ogg; codecs=opus", webm: "audio/webm",
  };
  return map[ext] ?? "audio/mpeg";
}

export interface PlayerPosition {
  numeroIndex: number;
  audioIndex: number;
}

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
  fade: FadeState | null;
}

export function usePlayer(project: Project, audioDeviceId: string | null) {
  const [state, setState] = useState<PlayerState>({
    position: null,
    isPlaying: false,
    progress: { position: 0, duration: 0 },
    audioError: null,
    fade: null,
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const projectRef = useRef(project);
  projectRef.current = project;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const posRef = useRef<PlayerPosition | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const loadVersionRef = useRef(0);
  const playAtRef = useRef<(nIdx: number, iIdx: number) => void>(() => {});
  const endTimeRef = useRef<number | null>(null);
  const nextRef = useRef<() => void>(() => {});
  const fadeAnimRef = useRef<number | null>(null);
  const fadingOutRef = useRef(false);
  const ignoreSrcErrorRef = useRef(false);

  function cancelFade() {
    if (fadeAnimRef.current !== null) {
      cancelAnimationFrame(fadeAnimRef.current);
      fadeAnimRef.current = null;
    }
    fadingOutRef.current = false;
    setState((s) => (s.fade === null ? s : { ...s, fade: null }));
  }

  const playAt = useCallback((nIdx: number, iIdx: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    cancelFade();
    const proj = projectRef.current;
    const item = proj.numeros[nIdx]?.items[iIdx];
    if (!item) return;

    if (item.type === "pause") {
      audio.pause();
      ignoreSrcErrorRef.current = true;
      audio.src = "";
      posRef.current = { numeroIndex: nIdx, audioIndex: iIdx };
      setState((s) => ({
        ...s,
        position: { numeroIndex: nIdx, audioIndex: iIdx },
        isPlaying: false,
        progress: { position: 0, duration: 0 },
        audioError: null,
      }));
      return;
    }

    const filePath = proj.path + "/musiques/" + item.filename;
    const version = ++loadVersionRef.current;
    audio.pause();

    const targetVolume = Math.max(0, Math.min(1, (item.volume ?? 100) / 100));

    invoke<ArrayBuffer>("read_audio_file", { path: filePath })
      .then((buffer) => {
        if (version !== loadVersionRef.current) return;
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        const blob = new Blob([buffer], { type: mimeType(item.filename) });
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        audio.src = url;
        audio.load();
        audio.currentTime = item.startTime ?? 0;
        endTimeRef.current = item.endTime ?? null;
        audio.volume = (item.fadeIn && item.fadeIn > 0) ? 0 : targetVolume;
        return audio.play();
      })
      .then(() => {
        if (version !== loadVersionRef.current) return;
        posRef.current = { numeroIndex: nIdx, audioIndex: iIdx };
        setState((s) => ({
          ...s,
          position: { numeroIndex: nIdx, audioIndex: iIdx },
          isPlaying: true,
          audioError: null,
        }));
        if (item.type === "audio" && item.fadeIn && item.fadeIn > 0) {
          const duration = item.fadeIn;
          const startTime = performance.now();
          setState((s) => ({ ...s, fade: { type: "in", remaining: duration, total: duration } }));
          const tick = () => {
            if (version !== loadVersionRef.current) return;
            const elapsed = (performance.now() - startTime) / 1000;
            if (elapsed >= duration) {
              audio.volume = targetVolume;
              fadeAnimRef.current = null;
              setState((s) => ({ ...s, fade: null }));
              return;
            }
            const t = elapsed / duration;
            audio.volume = targetVolume * t * t; // courbe quadratique (perçue comme naturelle)
            setState((s) => ({ ...s, fade: { type: "in", remaining: duration - elapsed, total: duration } }));
            fadeAnimRef.current = requestAnimationFrame(tick);
          };
          fadeAnimRef.current = requestAnimationFrame(tick);
        } else {
          setState((s) => (s.fade === null ? s : { ...s, fade: null }));
        }
      })
      .catch((err) => {
        if (version !== loadVersionRef.current) return;
        setState((s) => ({ ...s, isPlaying: false, audioError: String(err) }));
      });
  }, []);

  playAtRef.current = playAt;

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    audio.addEventListener("timeupdate", () => {
      const endTime = endTimeRef.current;
      if (endTime !== null && audio.currentTime >= endTime) {
        endTimeRef.current = null;
        nextRef.current();
        return;
      }
      setState((s) => ({
        ...s,
        progress: {
          position: audio.currentTime,
          duration: isFinite(audio.duration) ? audio.duration : 0,
        },
      }));
    });

    audio.addEventListener("ended", () => {
      if (!fadingOutRef.current) nextRef.current();
    });

    audio.addEventListener("error", () => {
      if (ignoreSrcErrorRef.current) { ignoreSrcErrorRef.current = false; return; }
      if (!posRef.current) return;
      setState((s) => ({ ...s, isPlaying: false, audioError: "Erreur de lecture audio" }));
    });

    return () => {
      if (fadeAnimRef.current !== null) {
        cancelAnimationFrame(fadeAnimRef.current);
        fadeAnimRef.current = null;
      }
      fadingOutRef.current = false;
      loadVersionRef.current++;
      audio.pause();
      audio.src = "";
      if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioDeviceId) return;
    (audio as any).setSinkId?.(audioDeviceId).catch(() => {});
  }, [audioDeviceId]);

  // Sync volume in real-time when the project changes (e.g. user drags volume slider)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !posRef.current || fadingOutRef.current || fadeAnimRef.current !== null) return;
    const { numeroIndex, audioIndex } = posRef.current;
    const item = project.numeros[numeroIndex]?.items[audioIndex];
    if (item?.type === "audio") {
      audio.volume = Math.max(0, Math.min(1, (item.volume ?? 100) / 100));
    }
  }, [project]);

  const togglePlay = useCallback(() => {
    const { position, isPlaying } = stateRef.current;
    const audio = audioRef.current;
    if (!audio) return;

    if (!position) {
      const first = firstAudioPosition(projectRef.current);
      if (first) playAtRef.current(first.numeroIndex, first.audioIndex);
      return;
    }

    const item = projectRef.current.numeros[position.numeroIndex]?.items[position.audioIndex];
    if (!item || item.type === "pause") {
      const nxt = nextAudioPosition(projectRef.current, position);
      if (nxt) playAtRef.current(nxt.numeroIndex, nxt.audioIndex);
      return;
    }

    if (isPlaying) {
      audio.pause();
      setState((s) => ({ ...s, isPlaying: false }));
    } else {
      audio.play().then(() => setState((s) => ({ ...s, isPlaying: true })));
    }
  }, []);

  const next = useCallback((): void => {
    if (fadingOutRef.current) return;

    const pos = stateRef.current.position ?? firstItemPosition(projectRef.current);
    if (!pos) return;

    const audio = audioRef.current;
    const item = projectRef.current.numeros[pos.numeroIndex]?.items[pos.audioIndex];

    const doAdvance = () => {
      const nxt = nextItemPosition(projectRef.current, pos);
      if (nxt) playAtRef.current(nxt.numeroIndex, nxt.audioIndex);
    };

    if (
      audio &&
      stateRef.current.isPlaying &&
      item?.type === "audio" &&
      item.fadeOut && item.fadeOut > 0
    ) {
      fadingOutRef.current = true;
      const startVolume = audio.volume;
      const duration = item.fadeOut;
      const startTime = performance.now();
      setState((s) => ({ ...s, fade: { type: "out", remaining: duration, total: duration } }));
      const tick = () => {
        const elapsed = (performance.now() - startTime) / 1000;
        if (elapsed >= duration) {
          audio.volume = 0;
          fadingOutRef.current = false;
          fadeAnimRef.current = null;
          setState((s) => ({ ...s, fade: null }));
          doAdvance();
          return;
        }
        const r = 1 - elapsed / duration;
        audio.volume = startVolume * r * r; // courbe quadratique descendante
        setState((s) => ({ ...s, fade: { type: "out", remaining: duration - elapsed, total: duration } }));
        fadeAnimRef.current = requestAnimationFrame(tick);
      };
      fadeAnimRef.current = requestAnimationFrame(tick);
    } else {
      doAdvance();
    }
  }, []);

  nextRef.current = next;

  const seek = useCallback((position: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = position;
  }, []);

  const stop = useCallback(() => {
    cancelFade();
    const audio = audioRef.current;
    if (audio) { audio.pause(); audio.currentTime = 0; audio.src = ""; }
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    posRef.current = null;
    endTimeRef.current = null;
    setState({ position: null, isPlaying: false, progress: { position: 0, duration: 0 }, audioError: null, fade: null });
  }, []);

  return { state, playAt, togglePlay, next, stop, seek };
}

function firstAudioPosition(project: Project): PlayerPosition | null {
  for (let ni = 0; ni < project.numeros.length; ni++) {
    const items = project.numeros[ni].items;
    for (let ii = 0; ii < items.length; ii++) {
      if (items[ii].type === "audio") return { numeroIndex: ni, audioIndex: ii };
    }
  }
  return null;
}

function firstItemPosition(project: Project): PlayerPosition | null {
  for (let ni = 0; ni < project.numeros.length; ni++) {
    if (project.numeros[ni].items.length > 0) return { numeroIndex: ni, audioIndex: 0 };
  }
  return null;
}

function nextItemPosition(project: Project, pos: PlayerPosition): PlayerPosition | null {
  const items = project.numeros[pos.numeroIndex].items;
  if (pos.audioIndex + 1 < items.length) {
    return { numeroIndex: pos.numeroIndex, audioIndex: pos.audioIndex + 1 };
  }
  for (let ni = pos.numeroIndex + 1; ni < project.numeros.length; ni++) {
    if (project.numeros[ni].items.length > 0) return { numeroIndex: ni, audioIndex: 0 };
  }
  return null;
}

function nextAudioPosition(project: Project, pos: PlayerPosition): PlayerPosition | null {
  const nxt = nextItemPosition(project, pos);
  if (!nxt) return null;
  const item = project.numeros[nxt.numeroIndex].items[nxt.audioIndex];
  if (item.type === "audio") return nxt;
  return nextAudioPosition(project, nxt);
}

void (null as unknown as PlaylistItem); // keep type import
