import { Ref, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import AddPartModal from "./AddPartModal";
import PreflightModal from "./PreflightModal";
import ExportModal from "./ExportModal";
import CloudShareDialog from "./CloudShareDialog";
import CloudImportDialog from "./CloudImportDialog";
import ConfirmModal from "./ConfirmModal";
import Toast, { ToastData, makeToast } from "./Toast";
import { PreflightIssue, gatherPreflight, estimateShowDuration } from "../preflight";
import { useBattery, LOW_BATTERY_PERCENT } from "../useBattery";
import i18next from "i18next";
import { useTranslation } from "react-i18next";
import { translateError } from "../errorMessage";
import { formatLongDuration } from "../duration";
import { mergeWithDefaults, resolveAction } from "../keyBindings";
import { useAudioDurations } from "../useAudioDurations";
import { isModalOpen } from "../useModal";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AlertTriangle, ArrowLeft, Plus, Share2, Settings, Pencil, MonitorPlay, ShieldCheck, Trash2, X, Undo2, Redo2, BatteryCharging, BatteryLow, BatteryMedium, BatteryFull, BatteryWarning } from "lucide-react";
import { Project, Numero, NumeroType, PlaylistItem } from "../types";
import { Settings as AppSettings } from "../useSettings";
import NumeroCard from "./NumeroCard";
import PlayerBar from "./PlayerBar";
import { FadeState, usePlayer } from "../usePlayer";

// What App needs from the open editor when a file is opened from the OS.
export interface EditorHandle {
  /** Writes pending edits now; false when the write failed. */
  flushSave: () => Promise<boolean>;
  /** Turns the show mode off before the editor goes away. */
  leaveShowMode: () => Promise<void>;
  /** Imports a .regiesonnumero into the open show, as one undoable step. */
  importNumeroFile: (srcFile: string) => Promise<void>;
}

interface Props {
  ref?: Ref<EditorHandle>;
  project: Project;
  settings: AppSettings;
  onProjectChange: (p: Project) => void;
  onClose: () => void;
  onOpenSettings: () => void;
  // True while the show mode is on or a track plays: App then keeps the
  // update installer, which restarts the app, out of reach.
  onLiveChange?: (live: boolean) => void;
}

function newNumero(type: NumeroType, index: number): Numero {
  const names: Record<NumeroType, string> = {
    numero: i18next.t("editor:defaultName.act", { index }),
    entracte: i18next.t("editor:defaultName.intermission", { index }),
    presentation: i18next.t("editor:defaultName.hostSegment", { index }),
  };
  return { id: crypto.randomUUID(), type, name: names[type], items: [] };
}

interface VerifyResult { missing: string[]; orphans: string[] }

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// Space or Enter on a focused drag handle picks the part up, the arrows move
// it, Space drops it and Escape cancels.
const KEYBOARD_SENSOR_OPTIONS = { coordinateGetter: sortableKeyboardCoordinates };

const EDIT_MODE_KEY = "regieson.editMode";

function readEditModePref(): boolean {
  try { return localStorage.getItem(EDIT_MODE_KEY) !== "false"; } catch { return true; }
}

function filenamesIn(projects: Project[]): Set<string> {
  const names = new Set<string>();
  for (const p of projects) {
    for (const n of p.numeros) for (const item of n.items) if (item.type === "audio") names.add(item.filename);
  }
  return names;
}

export default function ProjectEditor({ ref, project, settings, onProjectChange, onClose, onOpenSettings, onLiveChange }: Props) {
  const { t } = useTranslation(["editor", "common"]);
  const isSingle = project.singleNumero === true;
  const [saved, setSaved] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showAddPart, setShowAddPart] = useState(false);
  const [editMode, setEditMode] = useState(readEditModePref);
  const [showMode, setShowMode] = useState(false);
  const [confirm, setConfirm] = useState<"close" | "showModeOff" | "cleanup" | null>(null);
  // The show mode locks the running order: no edit, drag, delete or undo in
  // front of the audience, whatever the edit switch says.
  const editable = editMode && !showMode;
  const [showModeError, setShowModeError] = useState<string | null>(null);
  const [verify, setVerify] = useState<VerifyResult>({ missing: [], orphans: [] });
  const [verifyDismissed, setVerifyDismissed] = useState(false);
  const [preflightIssues, setPreflightIssues] = useState<PreflightIssue[] | null>(null);
  const [preflightConfirmActivation, setPreflightConfirmActivation] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [shareStatus, setShareStatus] = useState<"uploading" | "done" | "error" | null>(null);
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [showImportNumeroCloud, setShowImportNumeroCloud] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const showError = useCallback((message: string) => setToast(makeToast("error", message)), []);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoStackRef = useRef<Project[]>([]);
  const redoStackRef = useRef<Project[]>([]);
  // Mirrors the stack sizes for the Undo / Redo buttons.
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const syncHistory = useCallback(() => {
    const undo = undoStackRef.current.length;
    const redo = redoStackRef.current.length;
    setHistory((h) => (h.undo === undo && h.redo === redo ? h : { undo, redo }));
    // An "Undo" offered by a toast only makes sense until the next change.
    setToast((cur) => (cur?.action ? null : cur));
  }, []);
  const UNDO_LIMIT = 50;
  const COALESCE_WINDOW_MS = 1500;
  const lastUpdateTagRef = useRef<string | null>(null);
  const lastUpdateAtRef = useRef(0);
  const projectRef = useRef(project);
  projectRef.current = project;

  // verify_project checks every file on disk: only a change in the set of
  // audio files calls for it, not a keystroke in a cue or a slider step. The
  // version guard drops a slow answer overtaken by a newer one, and an
  // unchanged answer keeps the same object so that the cards do not re-render.
  const filenamesKey = useMemo(() => [...filenamesIn([project])].sort().join("\n"), [project]);
  const verifyVersionRef = useRef(0);
  useEffect(() => {
    const timer = setTimeout(async () => {
      const version = ++verifyVersionRef.current;
      try {
        const result = await invoke<VerifyResult>("verify_project", { project: projectRef.current });
        if (version !== verifyVersionRef.current) return;
        setVerify((prev) => (sameList(prev.missing, result.missing) && sameList(prev.orphans, result.orphans) ? prev : result));
      } catch (err) {
        console.error("verify_project:", err);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [filenamesKey, project.path]);

  // Deleting a track keeps its file, so that undo can bring it back. Such a
  // file is only an orphan once no undo or redo step refers to it any more.
  const cleanableOrphans = useMemo(() => {
    const inHistory = filenamesIn([...undoStackRef.current, ...redoStackRef.current]);
    return verify.orphans.filter((f) => !inHistory.has(f));
  }, [verify.orphans]);

  async function cleanupOrphans() {
    setConfirm(null);
    try {
      await invoke<number>("cleanup_orphan_files", { projectPath: project.path, filenames: cleanableOrphans });
      setVerify((v) => ({ ...v, orphans: v.orphans.filter((f) => !cleanableOrphans.includes(f)) }));
    } catch (err) {
      showError(t("editor:errors.cleanup", { detail: translateError(err) }));
    }
  }

  const missingSet = useMemo(() => new Set(verify.missing), [verify.missing]);
  // Memoised: a new options object at each render would rebuild the sensors
  // and re-render every sortable card.
  const pointerOptions = useMemo(() => ({ activationConstraint: { distance: editable ? 5 : 99999 } }), [editable]);
  const sensors = useSensors(
    useSensor(PointerSensor, pointerOptions),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS),
  );

  const { state: playerState, playAt, togglePlay, next, stop, seek } = usePlayer(project, settings.audioOutputDeviceId);
  const audioDurations = useAudioDurations(project);
  const battery = useBattery();

  const onProjectChangeRef = useRef(onProjectChange);
  onProjectChangeRef.current = onProjectChange;

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
    saveTimer.current = setTimeout(() => { void flushSave(); }, 600);
  }, [flushSave]);

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
    // Ahead of the re-render, so that two updates in a row (files added one
    // by one) each build on the previous one.
    projectRef.current = updated;
    onProjectChangeRef.current(updated);
    scheduleSave(updated);
    syncHistory();
  }, [scheduleSave, syncHistory]);

  const undo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    lastUpdateTagRef.current = null;
    redoStackRef.current.push(projectRef.current);
    projectRef.current = prev;
    onProjectChangeRef.current(prev);
    scheduleSave(prev);
    syncHistory();
  }, [scheduleSave, syncHistory]);

  const redo = useCallback(() => {
    const nxt = redoStackRef.current.pop();
    if (!nxt) return;
    lastUpdateTagRef.current = null;
    undoStackRef.current.push(projectRef.current);
    projectRef.current = nxt;
    onProjectChangeRef.current(nxt);
    scheduleSave(nxt);
    syncHistory();
  }, [scheduleSave, syncHistory]);

  // Leaving the editor writes what the 600 ms debounce still held.
  useEffect(() => () => { void flushSave(); }, [flushSave]);

  // Same when the window itself is closed. Bounded, so that a hung write
  // cannot keep the window open.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWindow()
      .onCloseRequested(async () => {
        await Promise.race([flushSave(), new Promise((r) => setTimeout(r, 3000))]);
      })
      .then((fn) => { if (cancelled) fn(); else unlisten = fn; })
      .catch((err) => console.error("onCloseRequested:", err));
    return () => { cancelled = true; unlisten?.(); };
  }, [flushSave]);

  useEffect(() => {
    try { localStorage.setItem(EDIT_MODE_KEY, String(editMode)); } catch { /* preference only */ }
  }, [editMode]);

  const playerStateRef = useRef(playerState);
  playerStateRef.current = playerState;
  const mergedBindings = useMemo(() => mergeWithDefaults(settings.keyBindings), [settings.keyBindings]);
  const bindingsRef = useRef(mergedBindings);
  bindingsRef.current = mergedBindings;

  const showModeRef = useRef(showMode);
  showModeRef.current = showMode;
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const redoRef = useRef(redo);
  redoRef.current = redo;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // A modal owns the keyboard: Escape closes it (see useModal) and must not
      // stop the show, and Space or the arrows typed in it must not reach the player.
      if (isModalOpen()) return;
      const target = e.target as HTMLElement | null;
      if (target && isTextEntry(target)) return;
      // A focused drag handle owns Space, the arrows and Escape while it
      // moves a part or a track with the keyboard.
      if (target?.closest?.('[aria-roledescription="sortable"]')) return;
      // Undo / Redo — hardcoded, take priority over custom bindings
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !showModeRef.current) {
        if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undoRef.current(); return; }
        if ((e.key === "z" && e.shiftKey) || e.key === "y") { e.preventDefault(); redoRef.current(); return; }
      }
      const action = resolveAction(e, bindingsRef.current);
      if (!action) return;
      e.preventDefault();
      // A held key auto-repeats about 30 times a second: only seeking may
      // repeat, anything else would skip through several tracks.
      if (e.repeat && action !== "seekForward" && action !== "seekBackward") return;
      // A button keeps focus after a click; Space would also activate it on
      // key-up. Taking the focus away leaves the shortcut as the only action.
      if (target instanceof HTMLButtonElement) target.blur();
      switch (action) {
        case "playPause": togglePlay(); break;
        case "next": next(); break;
        case "stop": stop(); break;
        case "seekForward": {
          const { position: p, duration: d } = playerStateRef.current.progress;
          seek(Math.min(p + 5, d));
          break;
        }
        case "seekBackward": {
          const { position: p } = playerStateRef.current.progress;
          seek(Math.max(p - 5, 0));
          break;
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePlay, next, stop, seek]);

  async function applyShowMode(active: boolean) {
    try {
      await invoke("set_show_mode", { active });
      setShowMode(active);
      setShowModeError(null);
    } catch (err) {
      setShowMode(active);
      setShowModeError(translateError(err));
    }
  }

  async function openPreflight(beforeActivatingShow: boolean) {
    const issues = await gatherPreflight(
      project,
      new Set(verify.missing),
      settings.audioOutputDeviceId,
      battery,
      estimateShowDuration(project, audioDurations),
    );
    setPreflightIssues(issues);
    setPreflightConfirmActivation(beforeActivatingShow);
  }

  async function toggleShowMode() {
    if (showMode) {
      setConfirm("showModeOff");
      return;
    }
    await openPreflight(true);
  }

  async function handleExportFile() {
    // Export and share read projet.json from disk: it must hold the latest edits.
    if (!(await flushSave())) return;
    try {
      if (isSingle) {
        const destFile = await invoke<string | null>("save_regiesonnumero_file", { defaultName: project.name });
        if (!destFile) return;
        await invoke("export_numero", { numeroPath: project.path, destFile });
      } else {
        const destFile = await invoke<string | null>("save_regieson_file", { defaultName: project.name });
        if (!destFile) return;
        await invoke("export_project", { projectPath: project.path, destFile });
      }
    } catch (err) {
      showError(t("editor:errors.export", { detail: translateError(err) }));
    }
  }

  async function handleExportCloud() {
    if (!(await flushSave())) return;
    setShareStatus("uploading");
    setShareCode(null);
    setShareError(null);
    try {
      const code = isSingle
        ? await invoke<string>("share_numero_on_cloud", { numeroPath: project.path })
        : await invoke<string>("share_project_on_cloud", { projectPath: project.path });
      setShareCode(code);
      setShareStatus("done");
    } catch (err) {
      setShareError(translateError(err));
      setShareStatus("error");
    }
  }

  const importNumeroFile = useCallback(async (srcFile: string) => {
    // The import starts from projet.json on disk: flush first, or it would
    // drop pending edits, and a pending save would then drop the import.
    if (!(await flushSave())) return;
    try {
      const updated = await invoke<Project>("import_numero_into_project", {
        srcFile, projectPath: projectRef.current.path,
      });
      update(updated);
    } catch (err) {
      showError(i18next.t("editor:errors.import", { detail: translateError(err) }));
    }
  }, [flushSave, update, showError]);

  async function handleImportNumero() {
    try {
      const srcFile = await invoke<string | null>("pick_regiesonnumero_file");
      if (srcFile) await importNumeroFile(srcFile);
    } catch (err) {
      showError(t("editor:errors.import", { detail: translateError(err) }));
    }
  }

  const leaveShowMode = useCallback(async () => {
    if (!showModeRef.current) return;
    try { await invoke("set_show_mode", { active: false }); } catch (err) { console.error("set_show_mode off:", err); }
  }, []);

  const onLiveChangeRef = useRef(onLiveChange);
  onLiveChangeRef.current = onLiveChange;
  const live = showMode || playerState.isPlaying;
  useEffect(() => { onLiveChangeRef.current?.(live); }, [live]);
  useEffect(() => () => { onLiveChangeRef.current?.(false); }, []);

  useImperativeHandle(ref, () => ({ flushSave, leaveShowMode, importNumeroFile }), [flushSave, leaveShowMode, importNumeroFile]);

  async function handleImportNumeroCloudSubmit(code: string) {
    if (!(await flushSave())) return;
    const updated = await invoke<Project>("import_numero_from_cloud_into_project", {
      code, projectPath: project.path,
    });
    update(updated);
    setShowImportNumeroCloud(false);
  }

  // Closing stops the music and leaves the show mode: never on a stray click.
  function requestClose() {
    if (showMode || playerStateRef.current.isPlaying) setConfirm("close");
    else void handleClose();
  }

  async function handleClose() {
    setConfirm(null);
    // A failed write keeps the editor open, with its banner, rather than
    // dropping the changes.
    if (!(await flushSave())) return;
    if (showMode) {
      try { await invoke("set_show_mode", { active: false }); } catch (err) { console.error("set_show_mode off:", err); }
    }
    onClose();
  }

  const addItem = useCallback((type: NumeroType) => {
    const cur = projectRef.current;
    const count = cur.numeros.filter((n) => n.type === type).length + 1;
    update({ ...cur, numeros: [...cur.numeros, newNumero(type, count)] });
  }, [update]);

  const updateNumero = useCallback((updated: Numero, tag?: string) => {
    const cur = projectRef.current;
    update({ ...cur, numeros: cur.numeros.map((n) => (n.id === updated.id ? updated : n)) }, tag);
  }, [update]);

  // A deletion is one click away from a mistake: it says so, with an Undo.
  const offerUndo = useCallback((message: string) => {
    setToast(makeToast("info", message, { label: i18next.t("editor:undo.undo"), run: () => undoRef.current() }));
  }, []);

  const deleteNumero = useCallback((id: string) => {
    const cur = projectRef.current;
    const name = cur.numeros.find((n) => n.id === id)?.name ?? "";
    update({ ...cur, numeros: cur.numeros.filter((n) => n.id !== id) });
    offerUndo(i18next.t("editor:undo.partDeleted", { name }));
  }, [update, offerUndo]);

  const updateItem = useCallback((numeroId: string, item: PlaylistItem, tag?: string) => {
    const cur = projectRef.current;
    update({
      ...cur,
      numeros: cur.numeros.map((n) => (n.id === numeroId
        ? { ...n, items: n.items.map((i) => (i.id === item.id ? item : i)) }
        : n)),
    }, tag);
  }, [update]);

  // The file stays on disk so that undo can bring the track back; it is
  // cleaned up later as an orphan, once no undo step refers to it.
  const deleteItem = useCallback((numeroId: string, itemId: string) => {
    const cur = projectRef.current;
    update({
      ...cur,
      numeros: cur.numeros.map((n) => (n.id === numeroId ? { ...n, items: n.items.filter((i) => i.id !== itemId) } : n)),
    });
    offerUndo(i18next.t("editor:undo.stepDeleted"));
  }, [update, offerUndo]);

  // Items added by a long operation (copies, downloads) are appended to the
  // act as it is when they arrive, not as it was when the operation started.
  const appendItems = useCallback((numeroId: string, items: PlaylistItem[]) => {
    const cur = projectRef.current;
    update({
      ...cur,
      numeros: cur.numeros.map((n) => (n.id === numeroId ? { ...n, items: [...n.items, ...items] } : n)),
    });
  }, [update]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    if (!editable) return;
    const cur = projectRef.current;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = cur.numeros.findIndex((n) => n.id === active.id);
    const newIdx = cur.numeros.findIndex((n) => n.id === over.id);
    update({ ...cur, numeros: arrayMove(cur.numeros, oldIdx, newIdx) });
  }, [editable, update]);

  const numeroIds = useMemo(() => project.numeros.map((n) => n.id), [project.numeros]);

  // The player updates its state every 25 ms during a fade. Cards only see a
  // fade rounded to the tenth they display, so they re-render at 10 Hz, and
  // only the active card receives it at all.
  const activeNumeroIndex = playerState.position?.numeroIndex ?? -1;
  const activeItemIndex = playerState.position?.audioIndex ?? null;
  const fadeType = playerState.fade?.type ?? null;
  const fadeTenths = playerState.fade ? Math.round(playerState.fade.remaining * 10) : 0;
  const fadeTotal = playerState.fade?.total ?? 0;
  const displayFade = useMemo<FadeState | null>(
    () => (fadeType ? { type: fadeType, remaining: fadeTenths / 10, total: fadeTotal } : null),
    [fadeType, fadeTenths, fadeTotal],
  );

  // Header battery readout. The autonomy is only shown when the OS provides
  // one; a missing estimate is normal and better left blank than faked.
  const batteryPercent = battery ? Math.round(battery.percent) : 0;
  const batteryCharging = battery?.state === "charging";
  const batteryTime =
    battery && battery.secondsRemaining !== null
      ? formatLongDuration(battery.secondsRemaining)
      : null;
  const BatteryIcon = batteryCharging
    ? BatteryCharging
    : batteryPercent <= 10
      ? BatteryWarning
      : batteryPercent <= 30
        ? BatteryLow
        : batteryPercent <= 70
          ? BatteryMedium
          : BatteryFull;

  return (
    <div className="project-editor">
      <div className="editor-header">
        <h1>{project.name}</h1>
        {saved && <span className="saved-badge">{t("editor:saved")}</span>}

        <button
          type="button"
          role="switch"
          aria-checked={editable}
          disabled={showMode}
          className="edit-mode-toggle"
          title={showMode ? t("editor:editMode.lockedByShow") : editMode ? t("editor:editMode.on") : t("editor:editMode.off")}
          onClick={() => setEditMode((v) => !v)}
        >
          <Pencil size={14} />
          <span>{t("editor:editMode.label")}</span>
          <span className={`toggle-switch${editable ? " toggle-switch--on" : ""}`} aria-hidden="true">
            <span className="toggle-thumb" />
          </span>
        </button>

        {editable && (
          <div className="undo-buttons">
            <button
              className="btn-icon"
              onClick={undo}
              disabled={history.undo === 0}
              title={t("editor:undo.undoTitle")}
              aria-label={t("editor:undo.undoTitle")}
            >
              <Undo2 size={17} />
            </button>
            <button
              className="btn-icon"
              onClick={redo}
              disabled={history.redo === 0}
              title={t("editor:undo.redoTitle")}
              aria-label={t("editor:undo.redoTitle")}
            >
              <Redo2 size={17} />
            </button>
          </div>
        )}

        {battery && (
          <div
            className={`battery-indicator${!batteryCharging && batteryPercent < LOW_BATTERY_PERCENT ? " battery-indicator--low" : ""}`}
            title={
              batteryCharging
                ? t("editor:battery.charging")
                : batteryTime
                  ? t("editor:battery.remaining", { time: batteryTime })
                  : t("editor:battery.noEstimate")
            }
          >
            <BatteryIcon size={15} />
            <span>{batteryPercent} %</span>
            {batteryTime && <span className="battery-time">{batteryTime}</span>}
          </div>
        )}

        <button
          className="btn-icon"
          onClick={() => openPreflight(false)}
          title={t("editor:checkShow")}
        >
          <ShieldCheck size={18} />
        </button>

        <button
          className={`btn-show-mode${showMode ? " btn-show-mode--active" : ""}`}
          onClick={toggleShowMode}
          title={
            showMode
              ? t("editor:showMode.activeTitle")
              : t("editor:showMode.inactiveTitle")
          }
        >
          <MonitorPlay size={15} />
          {showMode ? t("editor:showMode.active") : t("editor:showMode.inactive")}
        </button>

        <button
          className="btn-icon"
          onClick={() => setShowExport(true)}
          title={isSingle ? t("editor:exportAct") : t("editor:exportShow")}
        >
          <Share2 size={18} />
        </button>
        <button className="btn-icon" onClick={onOpenSettings} title={t("common:settings")}>
          <Settings size={18} />
        </button>
        <button className="btn-ghost btn-close-project" onClick={requestClose}>
          <ArrowLeft size={15} />
          {t("common:actions.close")}
        </button>
      </div>

      {saveError && (
        <div className="show-mode-warning">
          <span>{t("editor:saveFailed", { detail: saveError })}</span>
          <button className="btn-ghost" onClick={() => { void flushSave(); }}>{t("editor:retrySave")}</button>
        </div>
      )}

      {showModeError && (
        <div className="show-mode-warning">
          <span>{showModeError}</span>
          <button className="btn-icon" onClick={() => setShowModeError(null)} title={t("common:actions.close")} aria-label={t("common:actions.close")}><X size={13} /></button>
        </div>
      )}

      {!verifyDismissed && (verify.missing.length > 0 || cleanableOrphans.length > 0) && (
        <div className="verify-banner">
          <AlertTriangle size={14} />
          <div className="verify-banner-text">
            {verify.missing.length > 0 && (
              <span>{t("editor:verify.missingFiles", { count: verify.missing.length })}</span>
            )}
            {verify.missing.length > 0 && cleanableOrphans.length > 0 && <span>·</span>}
            {cleanableOrphans.length > 0 && (
              <span>{t("editor:verify.orphanFiles", { count: cleanableOrphans.length })}</span>
            )}
          </div>
          {cleanableOrphans.length > 0 && (
            <button className="btn-ghost verify-banner-btn" onClick={() => setConfirm("cleanup")} title={t("editor:verify.cleanupTitle")}>
              <Trash2 size={13} />
              {t("editor:verify.cleanup")}
            </button>
          )}
          <button className="btn-icon" onClick={() => setVerifyDismissed(true)} title={t("editor:verify.dismiss")}><X size={13} /></button>
        </div>
      )}

      <PlayerBar
        state={playerState}
        project={project}
        onTogglePlay={togglePlay}
        onNext={next}
        onStop={stop}
        onSeek={seek}
      />

      <div className="editor-body">
        {project.numeros.length === 0 && !isSingle && (
          <p style={{ color: "var(--text2)", fontSize: "0.9rem", textAlign: "center", padding: "2rem 0" }}>
            {t("editor:emptyState")}
          </p>
        )}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={numeroIds}
            strategy={verticalListSortingStrategy}
          >
            {project.numeros.map((n, nIdx) => (
              <NumeroCard
                key={n.id}
                numero={n}
                numeroIndex={nIdx}
                projectPath={project.path}
                editMode={editable}
                volumeEditable={editMode}
                activeItemIndex={nIdx === activeNumeroIndex ? activeItemIndex : null}
                isPlaying={nIdx === activeNumeroIndex && playerState.isPlaying}
                fade={nIdx === activeNumeroIndex ? displayFade : null}
                missingFiles={missingSet}
                audioDurations={audioDurations}
                playAt={playAt}
                togglePlay={togglePlay}
                onAppendItems={appendItems}
                onError={showError}
                onChange={updateNumero}
                onChangeItem={updateItem}
                onDeleteItem={deleteItem}
                onDelete={deleteNumero}
                canDelete={!isSingle}
                canChangeType={!isSingle}
                showDragHandle={!isSingle}
              />
            ))}
          </SortableContext>
        </DndContext>

        {editable && !isSingle && (
          <div className="add-numero-bar">
            <button className="btn-secondary" onClick={() => setShowAddPart(true)}>
              <Plus size={16} />
              {t("editor:addPart")}
            </button>
          </div>
        )}
      </div>

      {showAddPart && (
        <AddPartModal
          onSelectNumero={() => addItem("numero")}
          onSelectEntracte={() => addItem("entracte")}
          onSelectPresentation={() => addItem("presentation")}
          onSelectImport={handleImportNumero}
          onSelectImportCloud={() => setShowImportNumeroCloud(true)}
          onClose={() => setShowAddPart(false)}
        />
      )}

      {showImportNumeroCloud && (
        <CloudImportDialog
          kind="numero"
          onSubmit={handleImportNumeroCloudSubmit}
          onClose={() => setShowImportNumeroCloud(false)}
        />
      )}

      {preflightIssues !== null && (
        <PreflightModal
          issues={preflightIssues}
          onClose={() => { setPreflightIssues(null); setPreflightConfirmActivation(false); }}
          onConfirm={preflightConfirmActivation ? () => applyShowMode(true) : undefined}
          confirmLabel={t("editor:showMode.activate")}
        />
      )}

      {confirm === "close" && (
        <ConfirmModal
          title={t("editor:confirm.closeTitle")}
          message={t("editor:confirm.closeMessage")}
          confirmLabel={t("common:actions.close")}
          onConfirm={() => { void handleClose(); }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "showModeOff" && (
        <ConfirmModal
          title={t("editor:confirm.showModeOffTitle")}
          message={t("editor:confirm.showModeOffMessage")}
          confirmLabel={t("editor:confirm.showModeOff")}
          onConfirm={() => { setConfirm(null); void applyShowMode(false); }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "cleanup" && (
        <ConfirmModal
          title={t("editor:verify.cleanupTitle")}
          message={t("editor:confirm.cleanupMessage", { count: cleanableOrphans.length })}
          confirmLabel={t("editor:verify.cleanup")}
          onConfirm={() => { void cleanupOrphans(); }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {showExport && (
        <ExportModal
          kind={isSingle ? "numero" : "project"}
          onSelectFile={handleExportFile}
          onSelectCloud={handleExportCloud}
          onClose={() => setShowExport(false)}
        />
      )}

      {shareStatus !== null && (
        <CloudShareDialog
          status={shareStatus}
          code={shareCode}
          error={shareError}
          onClose={() => { setShareStatus(null); setShareCode(null); setShareError(null); }}
        />
      )}

      {toast && <Toast toast={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}

// Fields where the keyboard types text: shortcuts must leave them alone. A
// volume slider or a checkbox is not one of them, or the transport would go
// dead the moment the operator touched a slider mid-show.
const NON_TEXT_INPUTS = new Set(["range", "checkbox", "radio", "button", "submit", "reset", "color"]);

function isTextEntry(el: HTMLElement): boolean {
  if (el.isContentEditable) return true;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(el.type);
  return el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}
