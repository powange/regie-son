import { useState, useCallback, useEffect } from "react";
import type { KeyAction, KeyBinding } from "./keyBindings";
import { parseKeyBindings, readStorage, writeStorage } from "./storage";

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

// Field by field: one bad value falls back to its default without taking the
// others with it. Fields this version does not know are kept as they are.
export function parseSettings(raw: string | null): Settings {
  let data: unknown;
  try { data = raw === null ? undefined : JSON.parse(raw); } catch { data = undefined; }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { audioOutputDeviceId: null };
  const d = data as Record<string, unknown>;
  const settings: Settings = {
    ...d,
    audioOutputDeviceId: typeof d.audioOutputDeviceId === "string" && d.audioOutputDeviceId !== ""
      ? d.audioOutputDeviceId
      : null,
  };
  delete settings.keyBindings;
  delete settings.autoUpdateYtDlp;
  delete settings.language;
  const keyBindings = parseKeyBindings(d.keyBindings);
  if (keyBindings) settings.keyBindings = keyBindings;
  if (typeof d.autoUpdateYtDlp === "boolean") settings.autoUpdateYtDlp = d.autoUpdateYtDlp;
  if (typeof d.language === "string" || d.language === null) settings.language = d.language;
  return settings;
}

// Exported because i18next has to be initialised with the stored language
// before React mounts — see main.tsx.
export function loadSettings(): Settings {
  return parseSettings(readStorage(KEY));
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  useEffect(() => { writeStorage(KEY, settings); }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  return { settings, update };
}
