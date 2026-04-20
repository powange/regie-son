import { useEffect, useRef, useState } from "react";
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
import { ArrowLeft, Plus, Coffee, Settings, Pencil, MonitorPlay } from "lucide-react";
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

export default function ProjectEditor({ project, settings, onProjectChange, onClose, onOpenSettings }: Props) {
  const [saved, setSaved] = useState(true);
  const [editMode, setEditMode] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: editMode ? 5 : 99999 } }));

  const { state: playerState, playAt, togglePlay, next, stop, seek } = usePlayer(project, settings.audioOutputDeviceId);

  function update(updated: Project) {
    onProjectChange(updated);
    setSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await invoke("save_project", { project: updated });
        setSaved(true);
      } catch (err) {
        console.error("Erreur sauvegarde :", err);
      }
    }, 600);
  }

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  function addItem(type: NumeroType) {
    const count = project.numeros.filter((n) => n.type === type).length + 1;
    update({ ...project, numeros: [...project.numeros, newNumero(type, count)] });
  }

  function updateNumero(updated: Numero) {
    update({ ...project, numeros: project.numeros.map((n) => (n.id === updated.id ? updated : n)) });
  }

  function deleteNumero(id: string) {
    update({ ...project, numeros: project.numeros.filter((n) => n.id !== id) });
  }

  function handleDragEnd(event: DragEndEvent) {
    if (!editMode) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = project.numeros.findIndex((n) => n.id === active.id);
    const newIdx = project.numeros.findIndex((n) => n.id === over.id);
    update({ ...project, numeros: arrayMove(project.numeros, oldIdx, newIdx) });
  }

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

        <button className="btn-icon" onClick={onOpenSettings} title="Paramètres">
          <Settings size={18} />
        </button>
        <button className="btn-ghost btn-close-project" onClick={onClose}>
          <ArrowLeft size={15} />
          Fermer
        </button>
      </div>

      <PlayerBar
        state={playerState}
        project={project}
        onTogglePlay={togglePlay}
        onNext={next}
        onStop={stop}
        onSeek={seek}
      />

      <div className="editor-body">
        {project.numeros.length === 0 && (
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
                onPlayAudio={(aIdx) => playAt(nIdx, aIdx)}
                onChange={updateNumero}
                onDelete={() => deleteNumero(n.id)}
              />
            ))}
          </SortableContext>
        </DndContext>

        {editMode && (
          <div className="add-numero-bar">
            <button className="btn-secondary" onClick={() => addItem("numero")}>
              <Plus size={16} />
              Ajouter un numéro
            </button>
            <button className="btn-ghost" onClick={() => addItem("entracte")}>
              <Coffee size={16} />
              Ajouter un entracte
            </button>
            <button className="btn-ghost" onClick={() => addItem("presentation")}>
              <MonitorPlay size={16} />
              Ajouter une présentation
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
