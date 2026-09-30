import { useState, useCallback } from "react";
import type { KeyAction, KeyBinding } from "./keyBindings";

export interface Settings {
  audioOutputDeviceId: string | null;
  keyBindings?: Partial<Record<KeyAction, KeyBinding>>;
  autoUpdateYtDlp?: boolean; // defaults to true when absent
  // Explicit language choice. Absent or null means "follow the OS", which is
  // what an existing install gets on first launch after the i18n migration.
  language?: string | null;
  // Stop needs two presses within a second, against a reflex Escape.
  protectStop?: boolean;
  // Overlap between two consecutive tracks, in seconds; 0 or absent = off.
  crossfadeSeconds?: number;
  // Output used to preview a track in its settings, e.g. headphones, so that
  // it never goes out on the PA. Absent or null = system default.
  previewDeviceId?: string | null;
}

const KEY = "regie-son:settings";
const DEFAULT: Settings = { audioOutputDeviceId: null };

// Exported because i18next has to be initialised with the stored language
// before React mounts — see main.tsx.
export function loadSettings(): Settings {
  try {
    return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULT;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { settings, update };
}
