import { memo, useState, useRef, useEffect } from "react";
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
import { GripVertical, Pencil, Trash2, Plus, ListMusic, Coffee, MicVocal, Check, ChevronDown } from "lucide-react";
import { Numero, NumeroType, AudioFile, PauseItem, PlaylistItem } from "../types";
import { PlayerPosition, FadeState } from "../usePlayer";
import AddAudioSourceModal from "./AddAudioSourceModal";
import AudioItem from "./AudioItem";
import PauseTrack from "./PauseTrack";

interface Props {
  numero: Numero;
  numeroIndex: number;
  projectPath: string;
  editMode: boolean;
  playerPosition: PlayerPosition | null;
  isPlaying: boolean;
  playerFade: FadeState | null;
  missingFiles: Set<string>;
  playAt: (numeroIndex: number, audioIndex: number) => void;
  onChange: (updated: Numero) => void;
  onDelete: () => void;
  canDelete?: boolean;
  canChangeType?: boolean;
  showDragHandle?: boolean;
}

function NumeroCardInner({
  numero, numeroIndex, projectPath, editMode,
  playerPosition, isPlaying, playerFade, missingFiles, playAt,
  onChange, onDelete,
  canDelete = true,
  canChangeType = true,
  showDragHandle = true,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(numero.name);
  const [showSourceModal, setShowSourceModal] = useState(false);
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const typeMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showTypeMenu) return;
    function onDocMouseDown(e: MouseEvent) {
      if (typeMenuRef.current && !typeMenuRef.current.contains(e.target as Node)) {
        setShowTypeMenu(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [showTypeMenu]);

  function changeType(type: NumeroType) {
    setShowTypeMenu(false);
    if (type === numero.type) return;
    onChange({ ...numero, type });
  }

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

  async function addAudioFromUrl(url: string, downloadId: string) {
    const af = await invoke<AudioFile>("download_audio_from_url", { url, projectPath, downloadId });
    onChange({ ...numero, items: [...numero.items, { ...af, type: "audio" as const, volume: af.volume ?? 100 }] });
  }

  async function addAudioFromYoutube(url: string, downloadId: string) {
    const af = await invoke<AudioFile>("download_youtube_audio", { url, projectPath, downloadId });
    onChange({ ...numero, items: [...numero.items, { ...af, type: "audio" as const, volume: af.volume ?? 100 }] });
  }

  function updateAudio(updated: AudioFile, iIdx: number) {
    onChange({ ...numero, items: numero.items.map((it, i) => i === iIdx ? updated : it) });
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

  const typeCanBeChanged = editMode && canChangeType;
  const typeOptions: { id: NumeroType; label: string; icon: typeof ListMusic }[] = [
    { id: "numero", label: "Numéro", icon: ListMusic },
    { id: "entracte", label: "Entracte", icon: Coffee },
    { id: "presentation", label: "Présentation", icon: MicVocal },
  ];

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
        {editMode && showDragHandle && (
          <span className="numero-drag-handle" {...attributes} {...listeners}>
            <GripVertical size={16} />
          </span>
        )}
        {typeCanBeChanged ? (
          <div className="numero-type-badge-wrapper" ref={typeMenuRef}>
            <button
              type="button"
              className="numero-type-badge numero-type-badge--clickable"
              onClick={() => setShowTypeMenu((v) => !v)}
              title="Changer le type"
            >
              {typeBadge[numero.type] ?? numero.type}
              <ChevronDown size={12} />
            </button>
            {showTypeMenu && (
              <div className="numero-type-menu">
                {typeOptions.map((opt) => {
                  const Icon = opt.icon;
                  const isCurrent = opt.id === numero.type;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className={`numero-type-menu-item${isCurrent ? " numero-type-menu-item--active" : ""}`}
                      onClick={() => changeType(opt.id)}
                    >
                      <Icon size={14} />
                      <span>{opt.label}</span>
                      {isCurrent && <Check size={14} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <span className="numero-type-badge">{typeBadge[numero.type] ?? numero.type}</span>
        )}

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
            {canDelete && (
              <button className="btn-icon btn-danger" onClick={onDelete} title="Supprimer">
                <Trash2 size={14} />
              </button>
            )}
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
                  onPlay={() => playAt(numeroIndex, iIdx)}
                  onChange={(updated) => onChange({ ...numero, items: numero.items.map((it, i) => i === iIdx ? updated : it) })}
                  onDelete={() => deleteItem(item)}
                />
              ) : (
                <AudioItem
                  key={item.id}
                  audio={item}
                  projectPath={projectPath}
                  editMode={editMode}
                  isActive={isActiveNumero && playerPosition?.audioIndex === iIdx}
                  isPlaying={isActiveNumero && playerPosition?.audioIndex === iIdx && isPlaying}
                  isMissing={missingFiles.has(item.filename)}
                  activeFade={isActiveNumero && playerPosition?.audioIndex === iIdx ? playerFade : null}
                  onPlay={() => playAt(numeroIndex, iIdx)}
                  onChange={(updated) => updateAudio(updated, iIdx)}
                  onDelete={() => deleteItem(item)}
                />
              )
            )}
          </SortableContext>
        </DndContext>

        {editMode && (
          <div className="add-item-bar">
            <button className="add-audio-btn" onClick={() => setShowSourceModal(true)}>
              <Plus size={14} />
              Ajouter une étape
            </button>
          </div>
        )}
      </div>

      {showSourceModal && (
        <AddAudioSourceModal
          onSelectLocal={addAudioFiles}
          onSelectUrl={addAudioFromUrl}
          onSelectYoutube={addAudioFromYoutube}
          onSelectPause={addPause}
          onClose={() => setShowSourceModal(false)}
        />
      )}
    </div>
  );
}


export default memo(NumeroCardInner);
