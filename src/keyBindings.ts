export type KeyAction = "playPause" | "next" | "stop" | "seekForward" | "seekBackward";

export interface KeyBinding {
  key: string; // e.key value; empty string = action disabled
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

export interface KeyActionDef {
  id: KeyAction;
  label: string;
}

export const KEY_ACTIONS: KeyActionDef[] = [
  { id: "playPause", label: "Lecture / Pause" },
  { id: "next", label: "Piste suivante" },
  { id: "stop", label: "Stop" },
  { id: "seekForward", label: "Avancer de 5 s" },
  { id: "seekBackward", label: "Reculer de 5 s" },
];

export const DEFAULT_BINDINGS: Record<KeyAction, KeyBinding> = {
  playPause: { key: " " },
  next: { key: "ArrowRight" },
  stop: { key: "Escape" },
  seekForward: { key: "ArrowUp" },
  seekBackward: { key: "ArrowDown" },
};

const FORBIDDEN_KEYS = new Set(["Tab", "Enter", "F5", "F11", "F12"]);

export function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(key);
}

export function isModifierKey(key: string): boolean {
  return key === "Control" || key === "Shift" || key === "Alt" || key === "Meta";
}

export function bindingFromEvent(e: KeyboardEvent): KeyBinding {
  return {
    key: e.key,
    ctrl: e.ctrlKey || undefined,
    shift: e.shiftKey || undefined,
    alt: e.altKey || undefined,
    meta: e.metaKey || undefined,
  };
}

export function bindingsEqual(a: KeyBinding, b: KeyBinding): boolean {
  return (
    a.key === b.key &&
    !!a.ctrl === !!b.ctrl &&
    !!a.shift === !!b.shift &&
    !!a.alt === !!b.alt &&
    !!a.meta === !!b.meta
  );
}

export function mergeWithDefaults(
  overrides: Partial<Record<KeyAction, KeyBinding>> | undefined,
): Record<KeyAction, KeyBinding> {
  return {
    playPause: overrides?.playPause ?? DEFAULT_BINDINGS.playPause,
    next: overrides?.next ?? DEFAULT_BINDINGS.next,
    stop: overrides?.stop ?? DEFAULT_BINDINGS.stop,
    seekForward: overrides?.seekForward ?? DEFAULT_BINDINGS.seekForward,
    seekBackward: overrides?.seekBackward ?? DEFAULT_BINDINGS.seekBackward,
  };
}

export function resolveAction(
  e: KeyboardEvent,
  bindings: Record<KeyAction, KeyBinding>,
): KeyAction | null {
  for (const def of KEY_ACTIONS) {
    const b = bindings[def.id];
    if (!b.key) continue; // disabled
    if (e.key !== b.key) continue;
    if (!!b.ctrl !== e.ctrlKey) continue;
    if (!!b.shift !== e.shiftKey) continue;
    if (!!b.alt !== e.altKey) continue;
    if (!!b.meta !== e.metaKey) continue;
    return def.id;
  }
  return null;
}

function displayKey(key: string): string {
  switch (key) {
    case " ": return "Espace";
    case "ArrowUp": return "↑";
    case "ArrowDown": return "↓";
    case "ArrowLeft": return "←";
    case "ArrowRight": return "→";
    case "Escape": return "Échap";
    case "Backspace": return "Retour";
    case "Delete": return "Suppr";
    default: return key.length === 1 ? key.toUpperCase() : key;
  }
}

export function formatBinding(b: KeyBinding | null | undefined): string {
  if (!b || !b.key) return "Aucune touche";
  const parts: string[] = [];
  if (b.ctrl) parts.push("Ctrl");
  if (b.shift) parts.push("Shift");
  if (b.alt) parts.push("Alt");
  if (b.meta) parts.push("⌘");
  parts.push(displayKey(b.key));
  return parts.join(" + ");
}
