import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Project } from "./types";

// Reads only the metadata of each audio file (first few KB, not the whole
// buffer) via Tauri's asset:// protocol. Files already measured in a
// previous render are skipped, so this is cheap on subsequent edits.
export function useAudioDurations(project: Project): Map<string, number> {
  const [durations, setDurations] = useState<Map<string, number>>(() => new Map());
  const knownRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const todo: string[] = [];
    for (const n of project.numeros) {
      for (const i of n.items) {
        if (i.type === "audio" && !knownRef.current.has(i.filename)) {
          knownRef.current.add(i.filename);
          todo.push(i.filename);
        }
      }
    }
    if (todo.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const filename of todo) {
        if (cancelled) return;
        const url = convertFileSrc(project.path + "/musiques/" + filename);
        const audio = new Audio();
        audio.preload = "metadata";
        await new Promise<void>((resolve) => {
          const cleanup = () => {
            audio.removeEventListener("loadedmetadata", onLoaded);
            audio.removeEventListener("error", onError);
          };
          const onLoaded = () => {
            cleanup();
            const d = audio.duration;
            if (!cancelled && isFinite(d) && d > 0) {
              setDurations((prev) => {
                const next = new Map(prev);
                next.set(filename, d);
                return next;
              });
            }
            resolve();
          };
          const onError = () => { cleanup(); resolve(); };
          audio.addEventListener("loadedmetadata", onLoaded);
          audio.addEventListener("error", onError);
          audio.src = url;
        });
      }
    })();

    return () => { cancelled = true; };
  }, [project]);

  return durations;
}
