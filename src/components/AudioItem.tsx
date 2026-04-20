import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, GripVertical, Music, Pause, Play, Settings, Trash2, Volume2 } from "lucide-react";
import { AudioFile } from "../types";
import AudioSettingsModal from "./AudioSettingsModal";

interface Props {
  audio: AudioFile;
  editMode: boolean;
  isActive: boolean;
  isPlaying: boolean;
  isMissing?: boolean;
  onPlay: () => void;
  onChange: (updated: AudioFile) => void;
  onDelete: () => void;
}

export default function AudioItem({ audio, editMode, isActive, isPlaying, isMissing, onPlay, onChange, onDelete }: Props) {
  const [showSettings, setShowSettings] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: audio.id });

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
    <div className={`audio-item${isActive ? " audio-item--active" : ""}${isMissing ? " audio-item--missing" : ""}`} ref={setNodeRef} style={style}>
      <div className="audio-item-row">
        {editMode && (
          <span className="audio-drag-handle" {...attributes} {...listeners}>
            <GripVertical size={14} />
          </span>
        )}

        <button className="audio-play-btn" onClick={onPlay} disabled={isMissing} title={isMissing ? "Fichier introuvable" : isPlaying ? "En lecture" : "Lire"}>
          {isMissing ? <AlertTriangle size={13} /> : isPlaying ? <Pause size={13} /> : isActive ? <Play size={13} /> : <Music size={13} />}
        </button>

        <span className="audio-name" title={isMissing ? `Fichier introuvable : ${audio.filename}` : audio.original_name}>
          {audio.original_name}
        </span>

        {(audio.startTime != null || audio.endTime != null || audio.fadeIn != null || audio.fadeOut != null) && (
          <span className="audio-badges">
            {audio.startTime != null && <span className="audio-badge">▶ {fmt(audio.startTime)}</span>}
            {audio.endTime   != null && <span className="audio-badge">⏹ {fmt(audio.endTime)}</span>}
            {audio.fadeIn    != null && audio.fadeIn  > 0 && <span className="audio-badge">↑ {audio.fadeIn}s</span>}
            {audio.fadeOut   != null && audio.fadeOut > 0 && <span className="audio-badge">↓ {audio.fadeOut}s</span>}
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
              onChange={(e) => onChange({ ...audio, volume: Number(e.target.value) })}
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

      {editMode && (
        <input
          className="item-note-input"
          type="text"
          placeholder="Note…"
          value={audio.note ?? ""}
          onChange={(e) => onChange({ ...audio, note: e.target.value || undefined })}
        />
      )}

      {showSettings && (
        <AudioSettingsModal
          audio={audio}
          onSave={(updated) => onChange(updated)}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
