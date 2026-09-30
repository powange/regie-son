import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AlertTriangle, ArrowLeft, Plus, Share2, Settings, Pencil, MonitorPlay, ShieldCheck, Trash2, X, BatteryCharging, BatteryLow, BatteryMedium, BatteryFull, BatteryWarning } from "lucide-react";
import { Project, Numero, NumeroType, PlaylistItem } from "../types";
import { Settings as AppSettings } from "../useSettings";
import NumeroCard from "./NumeroCard";
import PlayerBar from "./PlayerBar";
import { usePlayer } from "../usePlayer";

interface Props {
  project: Project;
  settings: AppSettings;
  onProjectChange: (p: Project) => void;
  onClose: () => void;
  onOpenSettings: () => void;
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

export default function ProjectEditor({ project, settings, onProjectChange, onClose, onOpenSettings }: Props) {
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
  const UNDO_LIMIT = 50;
  const COALESCE_WINDOW_MS = 1500;
  const lastUpdateTagRef = useRef<string | null>(null);
  const lastUpdateAtRef = useRef(0);
  const projectRef = useRef(project);
  projectRef.current = project;

  async function runVerify() {
    try {
      const result = await invoke<VerifyResult>("verify_project", { project });
      setVerify(result);
    } catch (err) {
      console.error("verify_project:", err);
    }
  }

  useEffect(() => { runVerify(); }, [project]);

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
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: editable ? 5 : 99999 } }));

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
  }, [scheduleSave]);

  const undo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    lastUpdateTagRef.current = null;
    redoStackRef.current.push(projectRef.current);
    projectRef.current = prev;
    onProjectChangeRef.current(prev);
    scheduleSave(prev);
  }, [scheduleSave]);

  const redo = useCallback(() => {
    const nxt = redoStackRef.current.pop();
    if (!nxt) return;
    lastUpdateTagRef.current = null;
    undoStackRef.current.push(projectRef.current);
    projectRef.current = nxt;
    onProjectChangeRef.current(nxt);
    scheduleSave(nxt);
  }, [scheduleSave]);

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

  async function handleImportNumero() {
    try {
      const srcFile = await invoke<string | null>("pick_regiesonnumero_file");
      if (!srcFile) return;
      // The import starts from projet.json on disk: flush first, or it would
      // drop pending edits, and a pending save would then drop the import.
      if (!(await flushSave())) return;
      const updated = await invoke<Project>("import_numero_into_project", {
        srcFile, projectPath: project.path,
      });
      update(updated);
    } catch (err) {
      showError(t("editor:errors.import", { detail: translateError(err) }));
    }
  }

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

  const deleteNumero = useCallback((id: string) => {
    const cur = projectRef.current;
    update({ ...cur, numeros: cur.numeros.filter((n) => n.id !== id) });
  }, [update]);

  const deleteNumeroById = useMemo(() => {
    // Stable closures per-id so NumeroCard's onDelete prop keeps identity across renders.
    const cache = new Map<string, () => void>();
    return (id: string) => {
      let fn = cache.get(id);
      if (!fn) {
        fn = () => deleteNumero(id);
        cache.set(id, fn);
      }
      return fn;
    };
  }, [deleteNumero]);

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

        <label
          className="edit-mode-toggle"
          title={showMode ? t("editor:editMode.lockedByShow") : editMode ? t("editor:editMode.on") : t("editor:editMode.off")}
          style={showMode ? { opacity: 0.5 } : undefined}
        >
          <Pencil size={14} />
          <span>{t("editor:editMode.label")}</span>
          <div
            className={`toggle-switch${editable ? " toggle-switch--on" : ""}`}
            onClick={() => { if (!showMode) setEditMode((v) => !v); }}
          >
            <div className="toggle-thumb" />
          </div>
        </label>

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
          <button className="btn-icon" onClick={() => setShowModeError(null)}><X size={13} /></button>
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
            items={project.numeros.map((n) => n.id)}
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
                playerPosition={playerState.position}
                isPlaying={playerState.isPlaying}
                playerFade={playerState.fade}
                missingFiles={missingSet}
                audioDurations={audioDurations}
                playAt={playAt}
                togglePlay={togglePlay}
                onAppendItems={appendItems}
                onError={showError}
                onChange={updateNumero}
                onDelete={deleteNumeroById(n.id)}
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
