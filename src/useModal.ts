import { useEffect, useRef } from "react";

// Open modals, innermost last. The editor's global shortcuts check this so that
// Escape closes a modal instead of stopping the show, and Space or the arrows
// typed inside a modal never reach the player.
interface ModalEntry {
  onEscape: () => void;
  canClose: boolean;
}

const openModals: ModalEntry[] = [];

export function isModalOpen(): boolean {
  return openModals.length > 0;
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  const top = openModals[openModals.length - 1];
  if (!top) return;
  e.preventDefault();
  if (top.canClose) top.onEscape();
}

/**
 * Registers a modal as open for as long as the component is mounted, and
 * closes it on Escape. `canClose: false` keeps it open (e.g. during an upload)
 * while still shielding the player from the key.
 */
export function useModal(onClose: () => void, canClose = true) {
  const entryRef = useRef<ModalEntry>({ onEscape: onClose, canClose });
  entryRef.current.onEscape = onClose;
  entryRef.current.canClose = canClose;

  useEffect(() => {
    const entry = entryRef.current;
    if (openModals.length === 0) window.addEventListener("keydown", onKeyDown);
    openModals.push(entry);
    return () => {
      const i = openModals.lastIndexOf(entry);
      if (i !== -1) openModals.splice(i, 1);
      if (openModals.length === 0) window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
