import { memo, useRef, useEffect } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Info, PauseCircle, Play, Trash2 } from "lucide-react";
import { PauseItem } from "../types";

interface Props {
  pause: PauseItem;
  editMode: boolean;
  isActive: boolean;
  onPlay: () => void;
  onChange: (updated: PauseItem) => void;
  onDelete: () => void;
}

function PauseTrackInner({ pause, editMode, isActive, onPlay, onChange, onDelete }: Props) {
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
          className="item-cue-input"
          type="text"
          placeholder="Top de départ…"
          value={pause.cue ?? ""}
          onChange={(e) => onChange({ ...pause, cue: e.target.value || undefined })}
        />
      ) : (
        pause.cue && (
          <p className="item-cue-display" title="Top de départ">
            <Info size={12} />
            <span>{pause.cue}</span>
          </p>
        )
      )}
    </div>
  );
}


export default memo(PauseTrackInner);
