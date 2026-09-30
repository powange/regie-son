import { RefObject, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Check, LucideIcon } from "lucide-react";
import { useModal } from "../useModal";

export interface PopupMenuOption<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
}

interface Props<T extends string> {
  pos: { top: number; left: number };
  anchorRef: RefObject<HTMLElement | null>;
  options: PopupMenuOption<T>[];
  // Set for a choice among exclusive values (radio items); left out for a
  // list of actions.
  current?: T;
  label?: string;
  onPick: (id: T) => void;
  onClose: () => void;
}

// Placed under its anchor, in viewport coordinates.
export function menuPositionFor(anchor: HTMLElement): { top: number; left: number } {
  const rect = anchor.getBoundingClientRect();
  return { top: rect.bottom + 4, left: rect.left };
}

// Fixed-position popup: registered like a modal so that Escape closes it
// instead of reaching the player, and closed on any scroll, since it would
// otherwise stay put while its button scrolls away.
export default function PopupMenu<T extends string>({ pos, anchorRef, options, current, label, onPick, onClose }: Props<T>) {
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
    const menu = menuRef.current;
    (menu?.querySelector<HTMLButtonElement>("[aria-checked='true']") ?? menu?.querySelector<HTMLButtonElement>("button"))?.focus();
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

  const radio = current !== undefined;

  return createPortal(
    <div
      className="numero-type-menu"
      ref={menuRef}
      role="menu"
      aria-label={label}
      style={{ top: pos.top, left: pos.left }}
      onKeyDown={onKeyDown}
    >
      {options.map((opt) => {
        const Icon = opt.icon;
        const isCurrent = radio && opt.id === current;
        return (
          <button
            key={opt.id}
            type="button"
            role={radio ? "menuitemradio" : "menuitem"}
            aria-checked={radio ? isCurrent : undefined}
            className={`numero-type-menu-item${isCurrent ? " numero-type-menu-item--active" : ""}`}
            onClick={() => onPick(opt.id)}
          >
            {Icon && <Icon size={14} />}
            <span>{opt.label}</span>
            {isCurrent && <Check size={14} />}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
