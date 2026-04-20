import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, PauseCircle, Trash2 } from "lucide-react";
import { PauseItem } from "../types";

interface Props {
  pause: PauseItem;
  editMode: boolean;
  isActive: boolean;
  onChange: (updated: PauseItem) => void;
  onDelete: () => void;
}

export default function PauseTrack({ pause, editMode, isActive, onChange, onDelete }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: pause.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      className={`pause-track${isActive ? " pause-track--active" : ""}`}
      ref={setNodeRef}
      style={style}
    >
      {editMode && (
        <span className="audio-drag-handle" {...attributes} {...listeners}>
          <GripVertical size={14} />
        </span>
      )}
      <PauseCircle size={13} />
      <span className="pause-track-label">Pause</span>
      {editMode && (
        <input
          className="item-note-input"
          type="text"
          placeholder="Note…"
          value={pause.note ?? ""}
          onChange={(e) => onChange({ ...pause, note: e.target.value || undefined })}
        />
      )}

      {editMode && (
        <button className="btn-icon btn-danger" onClick={onDelete} title="Supprimer">
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}
