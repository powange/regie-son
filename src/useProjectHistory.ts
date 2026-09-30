import { RefObject, useCallback, useRef, useState } from "react";
import { Project } from "./types";

const UNDO_LIMIT = 50;
const COALESCE_WINDOW_MS = 1500;

/**
 * Every edit of the open project goes through `update`, which keeps the undo
 * and redo stacks. `projectRef` belongs to the editor, which syncs it with the
 * project at each render; edits move it ahead of the re-render, so that the
 * editor's callbacks always build on the latest edit.
 */
export function useProjectHistory(
  projectRef: RefObject<Project>,
  onProjectChange: (p: Project) => void,
  scheduleSave: (p: Project) => void,
  // Called after each change of the stacks.
  onHistoryChange: () => void,
) {
  const undoStackRef = useRef<Project[]>([]);
  const redoStackRef = useRef<Project[]>([]);
  // Mirrors the stack sizes for the Undo / Redo buttons.
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const lastUpdateTagRef = useRef<string | null>(null);
  const lastUpdateAtRef = useRef(0);
  const onProjectChangeRef = useRef(onProjectChange);
  onProjectChangeRef.current = onProjectChange;
  const onHistoryChangeRef = useRef(onHistoryChange);
  onHistoryChangeRef.current = onHistoryChange;

  const syncHistory = useCallback(() => {
    const undo = undoStackRef.current.length;
    const redo = redoStackRef.current.length;
    setHistory((h) => (h.undo === undo && h.redo === redo ? h : { undo, redo }));
    onHistoryChangeRef.current();
  }, []);

  const apply = useCallback((p: Project) => {
    // Ahead of the re-render, so that two updates in a row (files added one
    // by one) each build on the previous one.
    projectRef.current = p;
    onProjectChangeRef.current(p);
    scheduleSave(p);
    syncHistory();
  }, [projectRef, scheduleSave, syncHistory]);

  // `tag` lets callers coalesce successive pushes from the same field/control
  // (e.g. typing in a cue input) into a single undo entry, as long as they
  // arrive within COALESCE_WINDOW_MS.
  const update = useCallback((updated: Project, tag?: string) => {
    const now = performance.now();
    const sameSession = !!tag
      && tag === lastUpdateTagRef.current
      && now - lastUpdateAtRef.current < COALESCE_WINDOW_MS;
    if (!sameSession) {
      undoStackRef.current.push(projectRef.current);
      if (undoStackRef.current.length > UNDO_LIMIT) undoStackRef.current.shift();
      redoStackRef.current = [];
    }
    lastUpdateTagRef.current = tag ?? null;
    lastUpdateAtRef.current = now;
    apply(updated);
  }, [projectRef, apply]);

  const undo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    lastUpdateTagRef.current = null;
    redoStackRef.current.push(projectRef.current);
    apply(prev);
  }, [projectRef, apply]);

  const redo = useCallback(() => {
    const nxt = redoStackRef.current.pop();
    if (!nxt) return;
    lastUpdateTagRef.current = null;
    undoStackRef.current.push(projectRef.current);
    apply(nxt);
  }, [projectRef, apply]);

  // Every project an undo or redo can bring back.
  const snapshots = useCallback(() => [...undoStackRef.current, ...redoStackRef.current], []);

  return { update, undo, redo, history, snapshots };
}
