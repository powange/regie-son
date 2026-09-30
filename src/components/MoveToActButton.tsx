import { useRef, useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import PopupMenu, { menuPositionFor } from "./PopupMenu";

export interface ActTarget {
  id: string;
  name: string;
}

interface Props {
  numeroId: string;
  itemId: string;
  // Every part of the show, in order; the item's own is left out of the menu.
  acts: ActTarget[];
  onMove: (fromNumeroId: string, itemId: string, toNumeroId: string) => void;
}

// Moves a track or a pause to the end of another part. A menu rather than a
// drag across cards: see onMoveItem in ProjectEditor.
export default function MoveToActButton({ numeroId, itemId, acts, onMove }: Props) {
  const { t } = useTranslation(["audio"]);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const targets = acts.filter((a) => a.id !== numeroId);
  if (targets.length === 0) return null;

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className="btn-icon"
        onClick={() => setPos((p) => (p || !btnRef.current ? null : menuPositionFor(btnRef.current)))}
        title={t("audio:item.moveTo")}
        aria-label={t("audio:item.moveTo")}
        aria-haspopup="menu"
        aria-expanded={pos !== null}
      >
        <ArrowRightLeft size={14} />
      </button>
      {pos && (
        <PopupMenu
          pos={pos}
          anchorRef={btnRef}
          label={t("audio:item.moveTo")}
          options={targets.map((a) => ({ id: a.id, label: a.name }))}
          onPick={(to) => { setPos(null); onMove(numeroId, itemId, to); }}
          onClose={() => { setPos(null); btnRef.current?.focus(); }}
        />
      )}
    </>
  );
}
