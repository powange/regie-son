import { describe, expect, it } from "vitest";
import { RECENT_MAX, parseKeyBindings, parseRecentList } from "./storage";
import { parseSettings } from "./useSettings";

describe("parseRecentList", () => {
  it("returns an empty list for nothing stored, broken JSON or a non-array", () => {
    expect(parseRecentList(null)).toEqual([]);
    expect(parseRecentList("{not json")).toEqual([]);
    expect(parseRecentList("{}")).toEqual([]);
    expect(parseRecentList('"text"')).toEqual([]);
  });

  it("keeps well-formed entries and drops the rest", () => {
    const raw = JSON.stringify([
      { name: "Gala", path: "/shows/gala", lastOpened: "2026-01-02T10:00:00.000Z" },
      { name: 3, path: "/bad" },
      null,
      { name: "No path" },
      { name: "Empty path", path: "" },
    ]);
    expect(parseRecentList(raw)).toEqual([
      { name: "Gala", path: "/shows/gala", lastOpened: "2026-01-02T10:00:00.000Z" },
    ]);
  });

  it("replaces an unreadable date instead of dropping the entry", () => {
    const [entry] = parseRecentList(JSON.stringify([{ name: "A", path: "/a", lastOpened: "yesterday" }]));
    expect(entry.path).toBe("/a");
    expect(Number.isNaN(Date.parse(entry.lastOpened))).toBe(false);
  });

  it("removes duplicate paths and caps the length", () => {
    const many = Array.from({ length: RECENT_MAX + 5 }, (_, i) => ({ name: `S${i}`, path: `/s${i % (RECENT_MAX + 2)}`, lastOpened: "2026-01-01T00:00:00.000Z" }));
    const list = parseRecentList(JSON.stringify(many));
    expect(list).toHaveLength(RECENT_MAX);
    expect(new Set(list.map((r) => r.path)).size).toBe(RECENT_MAX);
  });
});

describe("parseKeyBindings", () => {
  it("keeps valid bindings of known actions only", () => {
    expect(parseKeyBindings({
      next: { key: "n", ctrl: true, shift: "yes" },
      stop: { key: "" },
      bogus: { key: "x" },
      playPause: { code: "Space" },
    })).toEqual({ next: { key: "n", ctrl: true }, stop: { key: "" } });
  });

  it("returns undefined when nothing is usable", () => {
    expect(parseKeyBindings([])).toBeUndefined();
    expect(parseKeyBindings({ next: 3 })).toBeUndefined();
  });
});

describe("parseSettings", () => {
  it("falls back to defaults for nothing stored or a non-object", () => {
    expect(parseSettings(null)).toEqual({ audioOutputDeviceId: null });
    expect(parseSettings("[]")).toEqual({ audioOutputDeviceId: null });
    expect(parseSettings("oops")).toEqual({ audioOutputDeviceId: null });
  });

  it("drops each invalid field on its own", () => {
    expect(parseSettings(JSON.stringify({
      audioOutputDeviceId: 42,
      autoUpdateYtDlp: false,
      language: 7,
      keyBindings: { next: { key: "n" } },
    }))).toEqual({ audioOutputDeviceId: null, autoUpdateYtDlp: false, keyBindings: { next: { key: "n" } } });
  });

  it("keeps a valid device, an explicit null language and unknown fields", () => {
    expect(parseSettings(JSON.stringify({ audioOutputDeviceId: "dev1", language: null, futureOption: 1 })))
      .toEqual({ audioOutputDeviceId: "dev1", language: null, futureOption: 1 });
  });
});

describe("parseSettings — playback settings", () => {
  it("keeps valid playback settings", () => {
    expect(parseSettings(JSON.stringify({ protectStop: true, crossfadeSeconds: 3, previewDeviceId: "hp" })))
      .toMatchObject({ protectStop: true, crossfadeSeconds: 3, previewDeviceId: "hp" });
  });

  it("drops or clamps invalid ones instead of handing them to the player", () => {
    const s = parseSettings(JSON.stringify({ protectStop: "yes", crossfadeSeconds: "5", previewDeviceId: 3 }));
    expect(s.protectStop).toBeUndefined();
    expect(s.crossfadeSeconds).toBeUndefined();
    expect(s.previewDeviceId).toBeUndefined();
    expect(parseSettings(JSON.stringify({ crossfadeSeconds: 99 })).crossfadeSeconds).toBe(10);
    expect(parseSettings(JSON.stringify({ crossfadeSeconds: -2 })).crossfadeSeconds).toBe(0);
  });
});
