import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { translateError } from "./errorMessage";
import { Project } from "./types";

const SAVE_DELAY_MS = 600;
const CLOSE_SAVE_TIMEOUT_MS = 3000;

/**
 * Debounced writes of the open project. `flushSave` writes what is pending
 * now; it is also run when the editor unmounts and when the window closes.
 */
export function useAutosave() {
  const [saved, setSaved] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<Project | null>(null);
  const saveChainRef = useRef<Promise<boolean>>(Promise.resolve(true));

  // Writes the pending project now, one save at a time: two writes never
  // overlap, and "saved" only shows once nothing newer is waiting. Resolves to
  // false when the write failed; the project then stays pending for a retry.
  const flushSave = useCallback((): Promise<boolean> => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const p = pendingSaveRef.current;
    if (!p) return saveChainRef.current;
    pendingSaveRef.current = null;
    saveChainRef.current = saveChainRef.current.then(async () => {
      try {
        await invoke("save_project", { project: p });
        if (pendingSaveRef.current === null) setSaved(true);
        setSaveError(null);
        return true;
      } catch (err) {
        if (pendingSaveRef.current === null) pendingSaveRef.current = p;
        setSaveError(translateError(err));
        return false;
      }
    });
    return saveChainRef.current;
  }, []);

  const scheduleSave = useCallback((p: Project) => {
    setSaved(false);
    pendingSaveRef.current = p;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flushSave(); }, SAVE_DELAY_MS);
  }, [flushSave]);

  // Leaving the editor writes what the debounce still held.
  useEffect(() => () => { void flushSave(); }, [flushSave]);

  // Same when the window itself is closed. Bounded, so that a hung write
  // cannot keep the window open.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWindow()
      .onCloseRequested(async () => {
        await Promise.race([flushSave(), new Promise((r) => setTimeout(r, CLOSE_SAVE_TIMEOUT_MS))]);
      })
      .then((fn) => { if (cancelled) fn(); else unlisten = fn; })
      .catch((err) => console.error("onCloseRequested:", err));
    return () => { cancelled = true; unlisten?.(); };
  }, [flushSave]);

  return { saved, saveError, flushSave, scheduleSave };
}
