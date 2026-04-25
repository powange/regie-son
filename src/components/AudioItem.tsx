import { memo, useState, useRef, useEffect } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, GripVertical, Info, Music, Pause, Play, Settings, Trash2, Volume2 } from "lucide-react";
import { AudioFile } from "../types";
import { FadeState } from "../usePlayer";
import AudioSettingsModal from "./AudioSettingsModal";

interface Props {
  audio: AudioFile;
  projectPath: string;
  editMode: boolean;
  isActive: boolean;
  isPlaying: boolean;
  isMissing?: boolean;
  activeFade?: FadeState | null;
  onPlay: () => void;
  onChange: (updated: AudioFile, tag?: string) => void;
  onDelete: () => void;
}

function AudioItemInner({ audio, projectPath, editMode, isActive, isPlaying, isMissing, activeFade, onPlay, onChange, onDelete }: Props) {
  const [showSettings, setShowSettings] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(audio.original_name);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: audio.id });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const setRefs = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    rootRef.current = node;
  };

  useEffect(() => {
    if (isActive) {
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [isActive]);

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus();
  }, [editingName]);

  function commitName() {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== audio.original_name) {
      onChange({ ...audio, original_name: trimmed });
    }
    setEditingName(false);
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const volume = audio.volume ?? 100;

  function fmt(secs: number) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  return (
    <div className={`audio-item${isActive ? " audio-item--active" : ""}${isMissing ? " audio-item--missing" : ""}`} ref={setRefs} style={style}>
      <div className="audio-item-row">
        {editMode && (
          <span className="audio-drag-handle" {...attributes} {...listeners}>
            <GripVertical size={14} />
          </span>
        )}

        <button className="audio-play-btn" onClick={onPlay} disabled={isMissing} title={isMissing ? "Fichier introuvable" : isPlaying ? "En lecture" : "Lire"}>
          {isMissing ? <AlertTriangle size={13} /> : isPlaying ? <Pause size={13} /> : isActive ? <Play size={13} /> : <Music size={13} />}
        </button>

        {editMode && editingName ? (
          <input
            ref={nameInputRef}
            className="audio-name-input"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") { setNameDraft(audio.original_name); setEditingName(false); }
            }}
          />
        ) : (
          <span
            className="audio-name"
            title={isMissing ? `Fichier introuvable : ${audio.filename}` : editMode ? "Cliquer pour renommer" : audio.original_name}
            onClick={editMode ? () => { setNameDraft(audio.original_name); setEditingName(true); } : undefined}
            style={editMode ? { cursor: "text" } : undefined}
          >
            {audio.original_name}
          </span>
        )}

        {(audio.startTime != null || audio.endTime != null || audio.fadeIn != null || audio.fadeOut != null) && (
          <span className="audio-badges">
            {audio.startTime != null && <span className="audio-badge">▶ {fmt(audio.startTime)}</span>}
            {audio.endTime   != null && <span className="audio-badge">⏹ {fmt(audio.endTime)}</span>}
            {audio.fadeIn    != null && audio.fadeIn  > 0 && (
              <span className={`audio-badge${isActive && activeFade?.type === "in" ? " audio-badge--active" : ""}`}>
                ↑ {isActive && activeFade?.type === "in" ? `${activeFade.remaining.toFixed(1)}s` : `${audio.fadeIn}s`}
              </span>
            )}
            {audio.fadeOut   != null && audio.fadeOut > 0 && (
              <span className={`audio-badge${isActive && activeFade?.type === "out" ? " audio-badge--active" : ""}`}>
                ↓ {isActive && activeFade?.type === "out" ? `${activeFade.remaining.toFixed(1)}s` : `${audio.fadeOut}s`}
              </span>
            )}
          </span>
        )}

        {editMode && (
          <div className="audio-volume">
            <Volume2 size={12} />
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              className="audio-volume-slider"
              onChange={(e) => onChange({ ...audio, volume: Number(e.target.value) }, "audio-volume:" + audio.id)}
              title={`Volume : ${volume}%`}
            />
            <span className="audio-volume-value">{volume}%</span>
          </div>
        )}

        {editMode && (
          <button className="btn-icon" onClick={() => setShowSettings(true)} title="Paramètres">
            <Settings size={14} />
          </button>
        )}

        {editMode && (
          <button className="btn-icon btn-danger" onClick={onDelete} title="Supprimer">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {editMode ? (
        <input
          className="item-cue-input"
          type="text"
          placeholder="Top de départ…"
          value={audio.cue ?? ""}
          onChange={(e) => onChange({ ...audio, cue: e.target.value || undefined }, "audio-cue:" + audio.id)}
        />
      ) : (
        audio.cue && (
          <p className="item-cue-display" title="Top de départ">
            <Info size={12} />
            <span>{audio.cue}</span>
          </p>
        )
      )}

      {showSettings && (
        <AudioSettingsModal
          audio={audio}
          projectPath={projectPath}
          onSave={(updated) => onChange(updated)}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}


export default memo(AudioItemInner);
