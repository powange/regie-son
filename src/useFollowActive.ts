import { RefObject, useEffect } from "react";

// How long a scroll by hand keeps the list where the operator left it.
export const MANUAL_SCROLL_GRACE_MS = 4000;

let lastManualScrollAt = -Infinity;
let listening = false;

function markManualScroll() {
  lastManualScrollAt = performance.now();
}

const SCROLL_KEYS = new Set(["PageUp", "PageDown", "Home", "End"]);

// Programmatic and manual scrolls fire the same "scroll" event: only the
// inputs behind a manual one tell them apart.
function listenForManualScroll() {
  if (listening) return;
  listening = true;
  window.addEventListener("wheel", markManualScroll, { passive: true, capture: true });
  window.addEventListener("touchmove", markManualScroll, { passive: true, capture: true });
  window.addEventListener("keydown", (e) => { if (SCROLL_KEYS.has(e.key)) markManualScroll(); }, { capture: true });
  // A press on a scrollbar lands on the scrolling element itself, beyond its
  // client area.
  window.addEventListener("pointerdown", (e) => {
    const el = e.target;
    if (el instanceof HTMLElement && el.scrollHeight > el.clientHeight && e.offsetX > el.clientWidth) markManualScroll();
  }, { capture: true });
}

export function recentlyScrolledByHand(now: number, last: number): boolean {
  return now - last < MANUAL_SCROLL_GRACE_MS;
}

/**
 * Brings the row into view when it becomes the current item, by the shortest
 * scroll: a row already visible does not move, and the act header above it
 * stays on screen. Skipped while the operator is reading another act.
 */
export function useFollowActive(ref: RefObject<HTMLElement | null>, isActive: boolean) {
  useEffect(() => { listenForManualScroll(); }, []);
  useEffect(() => {
    if (!isActive) return;
    if (recentlyScrolledByHand(performance.now(), lastManualScrollAt)) return;
    ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [isActive, ref]);
}
