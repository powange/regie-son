import { useState, useCallback } from "react";

export interface RecentNumero {
  name: string;
  path: string;
  lastOpened: string;
}

const KEY = "regie-son:recent-numeros";
const MAX = 10;

function load(): RecentNumero[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

function save(list: RecentNumero[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function useRecentNumeros() {
  const [recents, setRecents] = useState<RecentNumero[]>(load);

  const add = useCallback((name: string, path: string) => {
    setRecents((prev) => {
      const filtered = prev.filter((r) => r.path !== path);
      const updated = [{ name, path, lastOpened: new Date().toISOString() }, ...filtered].slice(0, MAX);
      save(updated);
      return updated;
    });
  }, []);

  const remove = useCallback((path: string) => {
    setRecents((prev) => {
      const updated = prev.filter((r) => r.path !== path);
      save(updated);
      return updated;
    });
  }, []);

  return { recents, add, remove };
}
