import { memo, useState, useRef, useEffect, useMemo, RefObject } from "react";
import { createPortal } from "react-dom";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { invoke } from "@tauri-apps/api/core";
import { GripVertical, Pencil, Trash2, Plus, ListMusic, Coffee, MicVocal, Check, ChevronDown } from "lucide-react";
import { Numero, NumeroType, AudioFile, PauseItem, PlaylistItem } from "../types";
import { FadeState } from "../usePlayer";
import AddAudioSourceModal from "./AddAudioSourceModal";
import AudioItem from "./AudioItem";
import PauseTrack from "./PauseTrack";
import { useTranslation } from "react-i18next";
import { useModal } from "../useModal";
import { translateError } from "../errorMessage";


interface Props {
  numero: Numero;
  numeroIndex: number;
  projectPath: string;
  editMode: boolean;
  volumeEditable: boolean;
  // Player state is narrowed to this card: every card but the active one
  // gets null / false / null and skips the re-renders of the progress.
  activeItemIndex: number | null;
  isPlaying: boolean;
  fade: FadeState | null;
  missingFiles: Set<string>;
  audioDurations: Map<string, number>;
  playAt: (numeroIndex: number, audioIndex: number) => void;
  togglePlay: () => void;
  onAppendItems: (numeroId: string, items: PlaylistItem[]) => void;
  onError: (message: string) => void;
  onChange: (updated: Numero, tag?: string) => void;
  onChangeItem: (numeroId: string, updated: PlaylistItem, tag?: string) => void;
  onDeleteItem: (numeroId: string, itemId: string) => void;
  onDelete: (numeroId: string) => void;
  canDelete?: boolean;
  canChangeType?: boolean;
  showDragHandle?: boolean;
}

function NumeroCardInner({
  numero, numeroIndex, projectPath, editMode, volumeEditable,
  activeItemIndex, isPlaying, fade, missingFiles, audioDurations, playAt, togglePlay, onAppendItems, onError,
  onChange, onChangeItem, onDeleteItem, onDelete,
  canDelete = true,
  canChangeType = true,
  showDragHandle = true,
}: Props) {
  const { t } = useTranslation(["parts", "audio", "common"]);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(numero.name);
  const [showSourceModal, setShowSourceModal] = useState(false);
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const [typeMenuPos, setTypeMenuPos] = useState<{ top: number; left: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typeBtnRef = useRef<HTMLButtonElement | null>(null);

  function openTypeMenu() {
    const btn = typeBtnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setTypeMenuPos({ top: rect.bottom + 4, left: rect.left });
    setShowTypeMenu(true);
  }

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

  const isActiveNumero = activeItemIndex !== null;
  const itemIds = useMemo(() => numero.items.map((i) => i.id), [numero.items]);

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
      // Each file is added as soon as it is copied: a failure halfway keeps
      // the ones already done instead of leaving them orphaned on disk.
      for (const p of paths) {
        const af = await invoke<{ id: string; filename: string; original_name: string }>(
          "copy_audio_file", { srcPath: p, projectPath }
        );
        onAppendItems(numero.id, [{ type: "audio", volume: 100, ...af }]);
      }
    } catch (err) {
      onError(t("audio:errors.add", { detail: translateError(err) }));
    }
  }

  async function addAudioFromUrl(url: string, downloadId: string) {
    const af = await invoke<AudioFile>("download_audio_from_url", { url, projectPath, downloadId });
    onAppendItems(numero.id, [{ ...af, type: "audio" as const, volume: af.volume ?? 100 }]);
  }

  async function addAudioFromYoutube(url: string, downloadId: string) {
    const af = await invoke<AudioFile>("download_youtube_audio", { url, projectPath, downloadId });
    onAppendItems(numero.id, [{ ...af, type: "audio" as const, volume: af.volume ?? 100 }]);
  }

  function addPause() {
    const pause: PauseItem = { type: "pause", id: crypto.randomUUID() };
    onChange({ ...numero, items: [...numero.items, pause] });
  }

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS));

  function handleItemDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = numero.items.findIndex((i) => i.id === active.id);
    const newIdx = numero.items.findIndex((i) => i.id === over.id);
    onChange({ ...numero, items: arrayMove(numero.items, oldIdx, newIdx) });
  }

  const typeBadge: Record<string, string> = {
    numero: t("parts:act.label"),
    entracte: t("parts:intermission.label"),
    presentation: t("parts:hostSegment.label"),
  };

  const typeCanBeChanged = editMode && canChangeType;
  const typeOptions: { id: NumeroType; label: string; icon: typeof ListMusic }[] = [
    { id: "numero", label: t("parts:act.label"), icon: ListMusic },
    { id: "entracte", label: t("parts:intermission.label"), icon: Coffee },
    { id: "presentation", label: t("parts:hostSegment.label"), icon: MicVocal },
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
          <>
            <button
              type="button"
              ref={typeBtnRef}
              className="numero-type-badge numero-type-badge--clickable"
              onClick={() => (showTypeMenu ? setShowTypeMenu(false) : openTypeMenu())}
              title={t("parts:changeType")}
              aria-haspopup="menu"
              aria-expanded={showTypeMenu}
            >
              {typeBadge[numero.type] ?? numero.type}
              <ChevronDown size={12} />
            </button>
            {showTypeMenu && typeMenuPos && (
              <TypeMenu
                pos={typeMenuPos}
                anchorRef={typeBtnRef}
                current={numero.type}
                options={typeOptions}
                onPick={changeType}
                onClose={() => { setShowTypeMenu(false); typeBtnRef.current?.focus(); }}
              />
            )}
          </>
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
              title={t("common:actions.rename")}
            >
              <Pencil size={14} />
            </button>
            {canDelete && (
              <button className="btn-icon btn-danger" onClick={() => onDelete(numero.id)} title={t("common:actions.delete")}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="numero-body">
        {numero.items.length === 0 && (
          <p className="numero-body-empty">{t("parts:emptyAct")}</p>
        )}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleItemDragEnd}>
          <SortableContext
            items={itemIds}
            strategy={verticalListSortingStrategy}
          >
            {numero.items.map((item, iIdx) =>
              item.type === "pause" ? (
                <PauseTrack
                  key={item.id}
                  pause={item}
                  numeroId={numero.id}
                  numeroIndex={numeroIndex}
                  itemIndex={iIdx}
                  editMode={editMode}
                  isActive={activeItemIndex === iIdx}
                  playAt={playAt}
                  onChange={onChangeItem}
                  onDelete={onDeleteItem}
                />
              ) : (
                <AudioItem
                  key={item.id}
                  audio={item}
                  numeroId={numero.id}
                  numeroIndex={numeroIndex}
                  itemIndex={iIdx}
                  projectPath={projectPath}
                  editMode={editMode}
                  volumeEditable={volumeEditable}
                  fileDuration={audioDurations.get(item.filename)}
                  isActive={activeItemIndex === iIdx}
                  isPlaying={activeItemIndex === iIdx && isPlaying}
                  isMissing={missingFiles.has(item.filename)}
                  activeFade={activeItemIndex === iIdx ? fade : null}
                  playAt={playAt}
                  togglePlay={togglePlay}
                  onChange={onChangeItem}
                  onDelete={onDeleteItem}
                />
              )
            )}
          </SortableContext>
        </DndContext>

        {editMode && (
          <div className="add-item-bar">
            <button className="add-audio-btn" onClick={() => setShowSourceModal(true)}>
              <Plus size={14} />
              {t("audio:addStep")}
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


const KEYBOARD_SENSOR_OPTIONS = { coordinateGetter: sortableKeyboardCoordinates };

interface TypeMenuProps {
  pos: { top: number; left: number };
  anchorRef: RefObject<HTMLButtonElement | null>;
  current: NumeroType;
  options: { id: NumeroType; label: string; icon: typeof ListMusic }[];
  onPick: (type: NumeroType) => void;
  onClose: () => void;
}

// Fixed-position popup: registered like a modal so that Escape closes it
// instead of reaching the player, and closed on any scroll, since it would
// otherwise stay put while its button scrolls away.
function TypeMenu({ pos, anchorRef, current, options, onPick, onClose }: TypeMenuProps) {
  useModal(onClose);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (!anchorRef.current?.contains(target) && !menuRef.current?.contains(target)) onCloseRef.current();
    }
    function onScroll(e: Event) {
      if (!menuRef.current?.contains(e.target as Node)) onCloseRef.current();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("scroll", onScroll, true);
    menuRef.current?.querySelector<HTMLButtonElement>("[aria-checked='true']")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [anchorRef]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  return createPortal(
    <div
      className="numero-type-menu"
      ref={menuRef}
      role="menu"
      style={{ top: pos.top, left: pos.left }}
      onKeyDown={onKeyDown}
    >
      {options.map((opt) => {
        const Icon = opt.icon;
        const isCurrent = opt.id === current;
        return (
          <button
            key={opt.id}
            type="button"
            role="menuitemradio"
            aria-checked={isCurrent}
            className={`numero-type-menu-item${isCurrent ? " numero-type-menu-item--active" : ""}`}
            onClick={() => onPick(opt.id)}
          >
            <Icon size={14} />
            <span>{opt.label}</span>
            {isCurrent && <Check size={14} />}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

export default memo(NumeroCardInner);
