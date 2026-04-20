import { useState, useRef, useEffect } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
import { GripVertical, Pencil, Trash2, Plus, PauseCircle } from "lucide-react";
import { Numero, AudioFile, PauseItem, PlaylistItem } from "../types";
import { PlayerPosition } from "../usePlayer";
import AudioItem from "./AudioItem";
import PauseTrack from "./PauseTrack";

interface Props {
  numero: Numero;
  numeroIndex: number;
  projectPath: string;
  editMode: boolean;
  playerPosition: PlayerPosition | null;
  isPlaying: boolean;
  onPlayAudio: (itemIndex: number) => void;
  onChange: (updated: Numero) => void;
  onDelete: () => void;
}

export default function NumeroCard({
  numero, numeroIndex, projectPath, editMode,
  playerPosition, isPlaying, onPlayAudio,
  onChange, onDelete,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(numero.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: numero.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isActiveNumero = playerPosition?.numeroIndex === numeroIndex;

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commitName() {
    const trimmed = editName.trim();
    if (trimmed) onChange({ ...numero, name: trimmed });
    setEditing(false);
  }

  async function addAudioFiles() {
    try {
      const paths = await invoke<string[]>("pick_audio_files");
      if (!paths.length) return;
      const newItems: AudioFile[] = [];
      for (const p of paths) {
        const af = await invoke<{ id: string; filename: string; original_name: string }>(
          "copy_audio_file", { srcPath: p, projectPath }
        );
        newItems.push({ type: "audio", volume: 100, ...af });
      }
      onChange({ ...numero, items: [...numero.items, ...newItems] });
    } catch (err) {
      alert("Erreur lors de l'ajout audio : " + err);
    }
  }

  function updateAudio(updated: AudioFile, iIdx: number) {
    onChange({ ...numero, items: numero.items.map((it, i) => i === iIdx ? updated : it) });
    if (isActiveNumero && playerPosition?.audioIndex === iIdx && isPlaying) {
      invoke("audio_set_volume", { volume: updated.volume ?? 100 }).catch(() => {});
    }
  }

  function addPause() {
    const pause: PauseItem = { type: "pause", id: crypto.randomUUID() };
    onChange({ ...numero, items: [...numero.items, pause] });
  }

  async function deleteItem(item: PlaylistItem) {
    if (item.type === "audio") {
      try {
        await invoke("delete_audio_file", { projectPath, filename: item.filename });
      } catch { /* already gone */ }
    }
    onChange({ ...numero, items: numero.items.filter((i) => i.id !== item.id) });
  }

  const sensors = useSensors(useSensor(PointerSensor));

  function handleItemDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = numero.items.findIndex((i) => i.id === active.id);
    const newIdx = numero.items.findIndex((i) => i.id === over.id);
    onChange({ ...numero, items: arrayMove(numero.items, oldIdx, newIdx) });
  }

  const typeBadge: Record<string, string> = {
    numero: "Numéro",
    entracte: "Entracte",
    presentation: "Présentation",
  };

  return (
    <div
      className={[
        "numero-card",
        numero.type === "entracte" ? "is-entracte" : "",
        numero.type === "presentation" ? "is-presentation" : "",
        isActiveNumero ? "is-active" : "",
      ].filter(Boolean).join(" ")}
      ref={setNodeRef}
      style={style}
    >
      <div className="numero-header">
        {editMode && (
          <span className="numero-drag-handle" {...attributes} {...listeners}>
            <GripVertical size={16} />
          </span>
        )}
        <span className="numero-type-badge">{typeBadge[numero.type] ?? numero.type}</span>

        {editing && editMode ? (
          <input
            ref={inputRef}
            className="numero-title-input"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") { setEditName(numero.name); setEditing(false); }
            }}
          />
        ) : (
          <span className="numero-title">{numero.name}</span>
        )}

        {editMode && (
          <div className="numero-actions">
            <button
              className="btn-icon"
              onClick={() => { setEditName(numero.name); setEditing(true); }}
              title="Renommer"
            >
              <Pencil size={14} />
            </button>
            <button className="btn-icon btn-danger" onClick={onDelete} title="Supprimer">
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>

      <div className="numero-body">
        {numero.items.length === 0 && (
          <p className="numero-body-empty">Aucun élément — ajoutez une musique ou une pause.</p>
        )}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleItemDragEnd}>
          <SortableContext
            items={numero.items.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
          >
            {numero.items.map((item, iIdx) =>
              item.type === "pause" ? (
                <PauseTrack
                  key={item.id}
                  pause={item}
                  editMode={editMode}
                  isActive={isActiveNumero && playerPosition?.audioIndex === iIdx}
                  onDelete={() => deleteItem(item)}
                />
              ) : (
                <AudioItem
                  key={item.id}
                  audio={item}
                  editMode={editMode}
                  isActive={isActiveNumero && playerPosition?.audioIndex === iIdx}
                  isPlaying={isActiveNumero && playerPosition?.audioIndex === iIdx && isPlaying}
                  onPlay={() => onPlayAudio(iIdx)}
                  onChange={(updated) => updateAudio(updated, iIdx)}
                  onDelete={() => deleteItem(item)}
                />
              )
            )}
          </SortableContext>
        </DndContext>

        {editMode && (
          <div className="add-item-bar">
            <button className="add-audio-btn" onClick={addAudioFiles}>
              <Plus size={14} />
              Ajouter une musique
            </button>
            <button className="add-pause-btn" onClick={addPause}>
              <PauseCircle size={14} />
              Ajouter une pause
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
