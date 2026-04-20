import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Project, PlaylistItem } from "./types";

function mimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav",
    flac: "audio/flac", m4a: "audio/mp4", aac: "audio/aac",
    wma: "audio/x-ms-wma", opus: "audio/ogg; codecs=opus",
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

export interface PlayerState {
  position: PlayerPosition | null;
  isPlaying: boolean;
  progress: PlayerProgress;
  audioError: string | null;
}

export function usePlayer(project: Project, audioDeviceId: string | null) {
  const [state, setState] = useState<PlayerState>({
    position: null,
    isPlaying: false,
    progress: { position: 0, duration: 0 },
    audioError: null,
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
  const handleEndedRef = useRef<() => void>(() => {});

  const playAt = useCallback((nIdx: number, iIdx: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const proj = projectRef.current;
    const item = proj.numeros[nIdx]?.items[iIdx];
    if (!item) return;

    if (item.type === "pause") {
      audio.pause();
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
        audio.volume = Math.max(0, Math.min(1, (item.volume ?? 100) / 100));
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
      })
      .catch((err) => {
        if (version !== loadVersionRef.current) return;
        setState((s) => ({ ...s, isPlaying: false, audioError: String(err) }));
      });
  }, []);

  playAtRef.current = playAt;

  handleEndedRef.current = () => {
    const audio = audioRef.current;
    const pos = posRef.current;
    if (!pos || !audio) return;
    const nxt = nextItemPosition(projectRef.current, pos);
    if (!nxt) {
      setState((s) => ({ ...s, isPlaying: false }));
      return;
    }
    if (nxt.numeroIndex !== pos.numeroIndex) {
      audio.src = "";
      if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
      posRef.current = nxt;
      setState((s) => ({ ...s, position: nxt, isPlaying: false, progress: { position: 0, duration: 0 } }));
      return;
    }
    playAtRef.current(nxt.numeroIndex, nxt.audioIndex);
  };

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    audio.addEventListener("timeupdate", () => {
      const endTime = endTimeRef.current;
      if (endTime !== null && audio.currentTime >= endTime) {
        endTimeRef.current = null;
        audio.pause();
        handleEndedRef.current();
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

    audio.addEventListener("ended", () => handleEndedRef.current());

    audio.addEventListener("error", () => {
      setState((s) => ({ ...s, isPlaying: false, audioError: "Erreur de lecture audio" }));
    });

    return () => {
      audio.pause();
      audio.src = "";
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioDeviceId) return;
    (audio as any).setSinkId?.(audioDeviceId).catch(() => {});
  }, [audioDeviceId]);

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

  const next = useCallback(() => {
    const { position, isPlaying } = stateRef.current;
    const pos = position ?? firstItemPosition(projectRef.current);
    if (!pos) return;

    // Si le player est à l'arrêt (en attente entre deux numéros), démarrer l'item courant
    if (!isPlaying) {
      playAtRef.current(pos.numeroIndex, pos.audioIndex);
      return;
    }

    const nxt = nextItemPosition(projectRef.current, pos);
    if (!nxt) return;

    // Franchissement de frontière entre numéros : s'arrêter et préparer le suivant
    if (nxt.numeroIndex !== pos.numeroIndex) {
      const audio = audioRef.current;
      if (audio) { audio.pause(); audio.src = ""; }
      if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
      posRef.current = nxt;
      setState((s) => ({ ...s, position: nxt, isPlaying: false, progress: { position: 0, duration: 0 } }));
      return;
    }

    playAtRef.current(nxt.numeroIndex, nxt.audioIndex);
  }, []);

  const seek = useCallback((position: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = position;
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) { audio.pause(); audio.currentTime = 0; audio.src = ""; }
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    posRef.current = null;
    setState({ position: null, isPlaying: false, progress: { position: 0, duration: 0 }, audioError: null });
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
