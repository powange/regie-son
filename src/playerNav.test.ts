import { describe, it, expect } from "vitest";
import { getNextContext } from "./playerNav";
import { Project, AudioFile, PauseItem } from "./types";
import { PlayerState } from "./usePlayer";

function audio(id: string, name = id): AudioFile {
  return { type: "audio", id, filename: `${id}.mp3`, original_name: name, volume: 100 };
}
function pause(id: string): PauseItem { return { type: "pause", id }; }

function makeProject(numeros: Array<{ name: string; items: Array<AudioFile | PauseItem> }>): Project {
  return {
    name: "test",
    path: "/tmp/test",
    numeros: numeros.map((n, i) => ({
      id: `n${i}`,
      type: "numero" as const,
      name: n.name,
      items: n.items,
    })),
  };
}

const idleState: PlayerState = {
  position: null,
  isPlaying: false,
  progress: { position: 0, duration: 0 },
  audioError: null,
  fade: null,
};

describe("getNextContext", () => {
  it("returns null for empty project", () => {
    const p = makeProject([]);
    expect(getNextContext(idleState, p)).toBeNull();
  });

  it("returns the very first item when nothing is playing", () => {
    const p = makeProject([
      { name: "N1", items: [audio("a1")] },
      { name: "N2", items: [audio("a2")] },
    ]);
    const ctx = getNextContext(idleState, p);
    expect(ctx?.item.id).toBe("a1");
    expect(ctx?.numero.name).toBe("N1");
  });

  it("skips empty numeros when idle", () => {
    const p = makeProject([
      { name: "empty", items: [] },
      { name: "has one", items: [audio("a1")] },
    ]);
    const ctx = getNextContext(idleState, p);
    expect(ctx?.item.id).toBe("a1");
    expect(ctx?.numero.name).toBe("has one");
  });

  it("returns the current item when stopped on an audio", () => {
    const p = makeProject([{ name: "N1", items: [audio("a1"), audio("a2")] }]);
    const state: PlayerState = {
      ...idleState,
      position: { numeroIndex: 0, audioIndex: 1 },
      isPlaying: false,
    };
    const ctx = getNextContext(state, p);
    expect(ctx?.item.id).toBe("a2");
  });

  it("advances within the same numero while playing", () => {
    const p = makeProject([{ name: "N1", items: [audio("a1"), audio("a2"), audio("a3")] }]);
    const state: PlayerState = {
      ...idleState,
      position: { numeroIndex: 0, audioIndex: 0 },
      isPlaying: true,
    };
    const ctx = getNextContext(state, p);
    expect(ctx?.item.id).toBe("a2");
  });

  it("jumps to the next non-empty numero when at end of current", () => {
    const p = makeProject([
      { name: "N1", items: [audio("a1")] },
      { name: "empty", items: [] },
      { name: "N3", items: [audio("a3")] },
    ]);
    const state: PlayerState = {
      ...idleState,
      position: { numeroIndex: 0, audioIndex: 0 },
      isPlaying: true,
    };
    const ctx = getNextContext(state, p);
    expect(ctx?.item.id).toBe("a3");
    expect(ctx?.numero.name).toBe("N3");
  });

  it("returns null when on the last item of last numero", () => {
    const p = makeProject([{ name: "N1", items: [audio("a1")] }]);
    const state: PlayerState = {
      ...idleState,
      position: { numeroIndex: 0, audioIndex: 0 },
      isPlaying: true,
    };
    expect(getNextContext(state, p)).toBeNull();
  });

  it("on a pause item (not playing), looks ahead for the next item", () => {
    // On arrête sur une pause : on veut voir ce qui va être lu ensuite
    const p = makeProject([
      { name: "N1", items: [audio("a1"), pause("p1"), audio("a2")] },
    ]);
    const state: PlayerState = {
      ...idleState,
      position: { numeroIndex: 0, audioIndex: 1 }, // on pause
      isPlaying: false,
    };
    const ctx = getNextContext(state, p);
    expect(ctx?.item.id).toBe("a2");
  });

  it("crosses numero boundary when on a pause at end of numero", () => {
    const p = makeProject([
      { name: "N1", items: [audio("a1"), pause("p1")] },
      { name: "N2", items: [audio("a2")] },
    ]);
    const state: PlayerState = {
      ...idleState,
      position: { numeroIndex: 0, audioIndex: 1 }, // sur la pause
      isPlaying: false,
    };
    const ctx = getNextContext(state, p);
    expect(ctx?.item.id).toBe("a2");
    expect(ctx?.numero.name).toBe("N2");
  });
});
