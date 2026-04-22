import { useState, useCallback } from "react";
import type { KeyAction, KeyBinding } from "./keyBindings";

export interface Settings {
  audioOutputDeviceId: string | null;
  keyBindings?: Partial<Record<KeyAction, KeyBinding>>;
}

const KEY = "regie-son:settings";
const DEFAULT: Settings = { audioOutputDeviceId: null };

function load(): Settings {
  try {
    return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULT;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { settings, update };
}
