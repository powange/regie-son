import { useState, useEffect } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdaterState {
  update: Update | null;
  checking: boolean;
  installing: boolean;
  progress: number | null; // 0–100
  error: string | null;
}

export function useUpdater() {
  const [state, setState] = useState<UpdaterState>({
    update: null,
    checking: false,
    installing: false,
    progress: null,
    error: null,
  });

  function checkUpdate() {
    setState((s) => ({ ...s, checking: true, update: null, error: null }));
    check()
      .then((update) => setState((s) => ({ ...s, checking: false, update: update ?? null })))
      .catch(() => setState((s) => ({ ...s, checking: false })));
  }

  useEffect(() => { checkUpdate(); }, []);

  async function install() {
    if (!state.update) return;
    setState((s) => ({ ...s, installing: true, progress: 0, error: null }));
    try {
      let downloaded = 0;
      let total = 0;
      await state.update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setState((s) => ({
            ...s,
            progress: total > 0 ? Math.round((downloaded / total) * 100) : null,
          }));
        }
      });
      await relaunch();
    } catch (err) {
      setState((s) => ({ ...s, installing: false, progress: null, error: String(err) }));
    }
  }

  function dismiss() {
    setState((s) => ({ ...s, update: null }));
  }

  return { state, install, dismiss, checkUpdate };
}
