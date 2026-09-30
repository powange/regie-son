import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Project } from "./types";

function measure(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = "metadata";
    const done = (value: number | null) => {
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("error", onError);
      // Release the element's connection and buffers right away.
      audio.removeAttribute("src");
      audio.load();
      resolve(value);
    };
    const onLoaded = () => done(isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    const onError = () => done(null);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("error", onError);
    audio.src = url;
  });
}

// Reads only the metadata of each audio file (first few KB, not the whole
// buffer) via Tauri's asset:// protocol. Files already measured, or that
// failed, are skipped, so this is cheap on subsequent edits.
export function useAudioDurations(project: Project): Map<string, number> {
  const [durations, setDurations] = useState<Map<string, number>>(() => new Map());
  // Filled only once a file has actually been read: a pass interrupted by an
  // edit leaves the rest to the next pass instead of marking it done.
  const doneRef = useRef<Set<string>>(new Set());

  // Editing a cue or a volume creates a new project object; only a change in
  // the set of files is worth another pass.
  const filesKey = useMemo(() => {
    const names = new Set<string>();
    for (const n of project.numeros) for (const i of n.items) if (i.type === "audio") names.add(i.filename);
    return [...names].sort().join("\n");
  }, [project]);
  const projectPath = project.path;

  useEffect(() => {
    const todo = filesKey === "" ? [] : filesKey.split("\n").filter((f) => !doneRef.current.has(f));
    if (todo.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const filename of todo) {
        if (cancelled) return;
        const d = await measure(convertFileSrc(projectPath + "/musiques/" + filename));
        if (cancelled) return;
        doneRef.current.add(filename);
        if (d !== null) {
          setDurations((prev) => new Map(prev).set(filename, d));
        }
      }
    })();

    return () => { cancelled = true; };
  }, [filesKey, projectPath]);

  return durations;
}
