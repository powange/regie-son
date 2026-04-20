import { useRef, useEffect } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, PauseCircle, Play, Trash2 } from "lucide-react";
import { PauseItem } from "../types";

interface Props {
  pause: PauseItem;
  editMode: boolean;
  isActive: boolean;
  onPlay: () => void;
  onChange: (updated: PauseItem) => void;
  onDelete: () => void;
}

export default function PauseTrack({ pause, editMode, isActive, onPlay, onChange, onDelete }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: pause.id });
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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      className={`pause-track${isActive ? " pause-track--active" : ""}`}
      ref={setRefs}
      style={style}
    >
      <div className="audio-item-row">
        {editMode && (
          <span className="audio-drag-handle" {...attributes} {...listeners}>
            <GripVertical size={14} />
          </span>
        )}
        <button className="audio-play-btn" onClick={onPlay} title="Se positionner sur cette étape">
          {isActive ? <Play size={13} /> : <PauseCircle size={13} />}
        </button>
        <span className="pause-track-label">Pause</span>
        {editMode && (
          <button className="btn-icon btn-danger" onClick={onDelete} title="Supprimer">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {editMode ? (
        <input
          className="item-note-input"
          type="text"
          placeholder="Note…"
          value={pause.note ?? ""}
          onChange={(e) => onChange({ ...pause, note: e.target.value || undefined })}
        />
      ) : (
        pause.note && <p className="item-note-display">{pause.note}</p>
      )}
    </div>
  );
}
