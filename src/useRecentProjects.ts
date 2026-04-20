import { useState, useCallback } from "react";

export interface RecentProject {
  name: string;
  path: string;
  lastOpened: string;
}

const KEY = "regie-son:recent-projects";
const MAX = 10;

function load(): RecentProject[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

function save(list: RecentProject[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function useRecentProjects() {
  const [recents, setRecents] = useState<RecentProject[]>(load);

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
