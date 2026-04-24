import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AddPartModal from "./AddPartModal";
import PreflightModal from "./PreflightModal";
import ExportModal from "./ExportModal";
import CloudShareDialog from "./CloudShareDialog";
import { PreflightIssue, gatherPreflight } from "../preflight";
import { mergeWithDefaults, resolveAction } from "../keyBindings";
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
import { AlertTriangle, ArrowLeft, Plus, Download, Settings, Pencil, MonitorPlay, ShieldCheck, Trash2, X } from "lucide-react";
import { Project, Numero, NumeroType } from "../types";
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
    numero: `Numéro ${index}`,
    entracte: `Entracte ${index}`,
    presentation: `Présentation ${index}`,
  };
  return { id: crypto.randomUUID(), type, name: names[type], items: [] };
}

interface VerifyResult { missing: string[]; orphans: string[] }

export default function ProjectEditor({ project, settings, onProjectChange, onClose, onOpenSettings }: Props) {
  const isSingle = project.singleNumero === true;
  const [saved, setSaved] = useState(true);
  const [showAddPart, setShowAddPart] = useState(false);
  const [editMode, setEditMode] = useState(true);
  const [showMode, setShowMode] = useState(false);
  const [showModeError, setShowModeError] = useState<string | null>(null);
  const [verify, setVerify] = useState<VerifyResult>({ missing: [], orphans: [] });
  const [verifyDismissed, setVerifyDismissed] = useState(false);
  const [preflightIssues, setPreflightIssues] = useState<PreflightIssue[] | null>(null);
  const [preflightConfirmActivation, setPreflightConfirmActivation] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [shareStatus, setShareStatus] = useState<"uploading" | "done" | "error" | null>(null);
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoStackRef = useRef<Project[]>([]);
  const redoStackRef = useRef<Project[]>([]);
  const UNDO_LIMIT = 50;
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

  async function cleanupOrphans() {
    try {
      await invoke<number>("cleanup_orphan_files", { projectPath: project.path, filenames: verify.orphans });
      setVerify((v) => ({ ...v, orphans: [] }));
    } catch (err) {
      alert("Erreur lors du nettoyage : " + err);
    }
  }

  const missingSet = useMemo(() => new Set(verify.missing), [verify.missing]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: editMode ? 5 : 99999 } }));

  const { state: playerState, playAt, togglePlay, next, stop, seek } = usePlayer(project, settings.audioOutputDeviceId);

  const onProjectChangeRef = useRef(onProjectChange);
  onProjectChangeRef.current = onProjectChange;

  const scheduleSave = useCallback((p: Project) => {
    setSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await invoke("save_project", { project: p });
        setSaved(true);
      } catch (err) {
        console.error("Erreur sauvegarde :", err);
      }
    }, 600);
  }, []);

  const update = useCallback((updated: Project) => {
    undoStackRef.current.push(projectRef.current);
    if (undoStackRef.current.length > UNDO_LIMIT) undoStackRef.current.shift();
    redoStackRef.current = [];
    onProjectChangeRef.current(updated);
    scheduleSave(updated);
  }, [scheduleSave]);

  const undo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    redoStackRef.current.push(projectRef.current);
    onProjectChangeRef.current(prev);
    scheduleSave(prev);
  }, [scheduleSave]);

  const redo = useCallback(() => {
    const nxt = redoStackRef.current.pop();
    if (!nxt) return;
    undoStackRef.current.push(projectRef.current);
    onProjectChangeRef.current(nxt);
    scheduleSave(nxt);
  }, [scheduleSave]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const playerStateRef = useRef(playerState);
  playerStateRef.current = playerState;
  const mergedBindings = useMemo(() => mergeWithDefaults(settings.keyBindings), [settings.keyBindings]);
  const bindingsRef = useRef(mergedBindings);
  bindingsRef.current = mergedBindings;

  const undoRef = useRef(undo);
  undoRef.current = undo;
  const redoRef = useRef(redo);
  redoRef.current = redo;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      // Undo / Redo — hardcoded, take priority over custom bindings
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undoRef.current(); return; }
        if ((e.key === "z" && e.shiftKey) || e.key === "y") { e.preventDefault(); redoRef.current(); return; }
      }
      const action = resolveAction(e, bindingsRef.current);
      if (!action) return;
      e.preventDefault();
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
      setShowModeError(String(err));
    }
  }

  async function openPreflight(beforeActivatingShow: boolean) {
    const issues = await gatherPreflight(
      project,
      new Set(verify.missing),
      settings.audioOutputDeviceId,
    );
    setPreflightIssues(issues);
    setPreflightConfirmActivation(beforeActivatingShow);
  }

  async function toggleShowMode() {
    if (showMode) {
      await applyShowMode(false);
      return;
    }
    await openPreflight(true);
  }

  async function handleExportFile() {
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
      alert("Erreur lors de l'export : " + err);
    }
  }

  async function handleExportCloud() {
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
      setShareError(String(err));
      setShareStatus("error");
    }
  }

  async function handleImportNumero() {
    try {
      const srcFile = await invoke<string | null>("pick_regiesonnumero_file");
      if (!srcFile) return;
      const updated = await invoke<Project>("import_numero_into_project", {
        srcFile, projectPath: project.path,
      });
      onProjectChange(updated);
      setSaved(true);
      runVerify();
    } catch (err) {
      alert("Erreur lors de l'import : " + err);
    }
  }

  async function handleClose() {
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

  const updateNumero = useCallback((updated: Numero) => {
    const cur = projectRef.current;
    update({ ...cur, numeros: cur.numeros.map((n) => (n.id === updated.id ? updated : n)) });
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

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    if (!editMode) return;
    const cur = projectRef.current;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = cur.numeros.findIndex((n) => n.id === active.id);
    const newIdx = cur.numeros.findIndex((n) => n.id === over.id);
    update({ ...cur, numeros: arrayMove(cur.numeros, oldIdx, newIdx) });
  }, [editMode, update]);

  return (
    <div className="project-editor">
      <div className="editor-header">
        <h1>{project.name}</h1>
        {saved && <span className="saved-badge">✓ Sauvegardé</span>}

        <label className="edit-mode-toggle" title={editMode ? "Mode édition actif" : "Mode édition inactif"}>
          <Pencil size={14} />
          <span>Édition</span>
          <div className={`toggle-switch${editMode ? " toggle-switch--on" : ""}`} onClick={() => setEditMode((v) => !v)}>
            <div className="toggle-thumb" />
          </div>
        </label>

        <button
          className="btn-icon"
          onClick={() => openPreflight(false)}
          title="Vérifier le spectacle"
        >
          <ShieldCheck size={18} />
        </button>

        <button
          className={`btn-show-mode${showMode ? " btn-show-mode--active" : ""}`}
          onClick={toggleShowMode}
          title={showMode ? "Mode spectacle actif — cliquer pour désactiver" : "Activer le mode spectacle"}
        >
          <MonitorPlay size={15} />
          {showMode ? "Mode spectacle actif" : "Mode spectacle"}
        </button>

        <button
          className="btn-icon"
          onClick={() => setShowExport(true)}
          title={isSingle ? "Exporter le numéro" : "Exporter le projet"}
        >
          <Download size={18} />
        </button>
        <button className="btn-icon" onClick={onOpenSettings} title="Paramètres">
          <Settings size={18} />
        </button>
        <button className="btn-ghost btn-close-project" onClick={handleClose}>
          <ArrowLeft size={15} />
          Fermer
        </button>
      </div>

      {showModeError && (
        <div className="show-mode-warning">
          <span>{showModeError}</span>
          <button className="btn-icon" onClick={() => setShowModeError(null)}><X size={13} /></button>
        </div>
      )}

      {!verifyDismissed && (verify.missing.length > 0 || verify.orphans.length > 0) && (
        <div className="verify-banner">
          <AlertTriangle size={14} />
          <div className="verify-banner-text">
            {verify.missing.length > 0 && (
              <span>{verify.missing.length} fichier{verify.missing.length > 1 ? "s" : ""} manquant{verify.missing.length > 1 ? "s" : ""}</span>
            )}
            {verify.missing.length > 0 && verify.orphans.length > 0 && <span>·</span>}
            {verify.orphans.length > 0 && (
              <span>{verify.orphans.length} fichier{verify.orphans.length > 1 ? "s" : ""} orphelin{verify.orphans.length > 1 ? "s" : ""} dans le dossier</span>
            )}
          </div>
          {verify.orphans.length > 0 && (
            <button className="btn-ghost verify-banner-btn" onClick={cleanupOrphans} title="Supprimer les fichiers orphelins">
              <Trash2 size={13} />
              Nettoyer
            </button>
          )}
          <button className="btn-icon" onClick={() => setVerifyDismissed(true)} title="Masquer"><X size={13} /></button>
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
            Aucun élément — commencez par ajouter un numéro, un entracte ou une présentation.
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
                editMode={editMode}
                playerPosition={playerState.position}
                isPlaying={playerState.isPlaying}
                playerFade={playerState.fade}
                missingFiles={missingSet}
                playAt={playAt}
                onChange={updateNumero}
                onDelete={deleteNumeroById(n.id)}
                canDelete={!isSingle}
                canChangeType={!isSingle}
                showDragHandle={!isSingle}
              />
            ))}
          </SortableContext>
        </DndContext>

        {editMode && !isSingle && (
          <div className="add-numero-bar">
            <button className="btn-secondary" onClick={() => setShowAddPart(true)}>
              <Plus size={16} />
              Ajouter une partie
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
          onClose={() => setShowAddPart(false)}
        />
      )}

      {preflightIssues !== null && (
        <PreflightModal
          issues={preflightIssues}
          onClose={() => { setPreflightIssues(null); setPreflightConfirmActivation(false); }}
          onConfirm={preflightConfirmActivation ? () => applyShowMode(true) : undefined}
          confirmLabel="Activer le mode spectacle"
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
    </div>
  );
}
