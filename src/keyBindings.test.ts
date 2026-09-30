import { describe, it, expect } from "vitest";
import {
  DEFAULT_BINDINGS,
  bindingFromEvent,
  bindingsEqual,
  isForbiddenKey,
  isModifierKey,
  mergeWithDefaults,
  resolveAction,
} from "./keyBindings";

type Mods = Partial<Pick<KeyboardEvent, "ctrlKey" | "shiftKey" | "altKey" | "metaKey">>;

function key(k: string, mods: Mods = {}): KeyboardEvent {
  return { key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods } as KeyboardEvent;
}

describe("resolveAction", () => {
  const bindings = mergeWithDefaults(undefined);

  it("maps the default keys to their actions", () => {
    expect(resolveAction(key(" "), bindings)).toBe("playPause");
    expect(resolveAction(key("ArrowRight"), bindings)).toBe("next");
    expect(resolveAction(key("Escape"), bindings)).toBe("stop");
    expect(resolveAction(key("ArrowUp"), bindings)).toBe("seekForward");
    expect(resolveAction(key("ArrowDown"), bindings)).toBe("seekBackward");
  });

  it("requires the exact modifiers: Ctrl+Space is not Space", () => {
    expect(resolveAction(key(" ", { ctrlKey: true }), bindings)).toBeNull();
    expect(resolveAction(key("ArrowRight", { shiftKey: true }), bindings)).toBeNull();
  });

  it("honours a custom binding with modifiers", () => {
    const custom = mergeWithDefaults({ stop: { key: "Escape", shift: true } });
    expect(resolveAction(key("Escape"), custom)).toBeNull();
    expect(resolveAction(key("Escape", { shiftKey: true }), custom)).toBe("stop");
  });

  it("ignores a disabled binding", () => {
    const custom = mergeWithDefaults({ next: { key: "" } });
    expect(resolveAction(key("ArrowRight"), custom)).toBeNull();
  });

  it("returns null for an unbound key", () => {
    expect(resolveAction(key("x"), bindings)).toBeNull();
  });
});

describe("mergeWithDefaults", () => {
  it("fills every action the overrides leave out", () => {
    const merged = mergeWithDefaults({ next: { key: "n" } });
    expect(merged.next).toEqual({ key: "n" });
    expect(merged.playPause).toEqual(DEFAULT_BINDINGS.playPause);
    expect(merged.stop).toEqual(DEFAULT_BINDINGS.stop);
  });
});

describe("binding helpers", () => {
  it("builds a binding from an event and compares modifiers", () => {
    const b = bindingFromEvent(key("k", { ctrlKey: true }));
    expect(bindingsEqual(b, { key: "k", ctrl: true })).toBe(true);
    expect(bindingsEqual(b, { key: "k" })).toBe(false);
  });

  it("refuses keys that would break the app or the browser", () => {
    expect(isForbiddenKey("Tab")).toBe(true);
    expect(isForbiddenKey("F5")).toBe(true);
    expect(isForbiddenKey(" ")).toBe(false);
  });

  it("recognises modifier keys", () => {
    expect(isModifierKey("Shift")).toBe(true);
    expect(isModifierKey("a")).toBe(false);
  });
});
