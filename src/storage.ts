import { useCallback, useEffect, useState } from "react";
import { KEY_ACTIONS, KeyAction, KeyBinding } from "./keyBindings";

// localStorage holds whatever an older version, a hand edit or a full disk
// left there: everything read back is checked, and what does not fit is
// dropped instead of reaching the UI. Writes never throw either.

export function readStorage(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // Quota exceeded or storage disabled: the value lives on for the session.
    console.warn(`localStorage ${key}:`, err);
  }
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export interface RecentEntry {
  name: string;
  path: string;
  lastOpened: string;
}

export const RECENT_MAX = 10;

export function parseRecentList(raw: string | null): RecentEntry[] {
  const data = parseJson(raw);
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const list: RecentEntry[] = [];
  for (const e of data) {
    if (!isRecord(e) || typeof e.name !== "string" || typeof e.path !== "string" || e.path === "") continue;
    if (seen.has(e.path)) continue;
    seen.add(e.path);
    const lastOpened = typeof e.lastOpened === "string" && !Number.isNaN(Date.parse(e.lastOpened))
      ? e.lastOpened
      : new Date(0).toISOString();
    list.push({ name: e.name, path: e.path, lastOpened });
  }
  return list.slice(0, RECENT_MAX);
}

// Shared by the recent shows and the recent acts: same shape, other key.
export function useRecentList(key: string) {
  const [recents, setRecents] = useState<RecentEntry[]>(() => parseRecentList(readStorage(key)));

  useEffect(() => { writeStorage(key, recents); }, [key, recents]);

  const add = useCallback((name: string, path: string) => {
    setRecents((prev) => [
      { name, path, lastOpened: new Date().toISOString() },
      ...prev.filter((r) => r.path !== path),
    ].slice(0, RECENT_MAX));
  }, []);

  const remove = useCallback((path: string) => {
    setRecents((prev) => prev.filter((r) => r.path !== path));
  }, []);

  return { recents, add, remove };
}

function parseKeyBinding(v: unknown): KeyBinding | null {
  if (!isRecord(v) || typeof v.key !== "string") return null;
  const b: KeyBinding = { key: v.key };
  for (const mod of ["ctrl", "shift", "alt", "meta"] as const) {
    if (v[mod] === true) b[mod] = true;
  }
  return b;
}

export function parseKeyBindings(v: unknown): Partial<Record<KeyAction, KeyBinding>> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Partial<Record<KeyAction, KeyBinding>> = {};
  for (const { id } of KEY_ACTIONS) {
    const b = parseKeyBinding(v[id]);
    if (b) out[id] = b;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
