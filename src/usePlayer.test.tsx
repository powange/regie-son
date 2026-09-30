// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePlayer } from "./usePlayer";
import { AudioFile, PauseItem, Project } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: vi.fn(),
}));

// Stands in for the <audio> element: jsdom has no media playback. Each play()
// returns a promise the test settles, so that loads can be left in flight.
class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  src = "";
  currentTime = 0;
  duration = 120;
  volume = 1;
  paused = true;
  ended = false;
  preload = "";
  pending: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];

  constructor() {
    super();
    FakeAudio.instances.push(this);
  }
  play(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pending.push({
        resolve: () => { this.paused = false; resolve(); },
        reject,
      });
    });
  }
  pause() { this.paused = true; }
  load() {}
  getAttribute(name: string) { return name === "src" && this.src ? this.src : null; }
  removeAttribute(name: string) { if (name === "src") this.src = ""; }
  fire(type: string) { this.dispatchEvent(new Event(type)); }
}

function audio(id: string, over: Partial<AudioFile> = {}): AudioFile {
  return { type: "audio", id, filename: `${id}.mp3`, original_name: id, volume: 100, ...over };
}
function pause(id: string, duration?: number): PauseItem {
  return { type: "pause", id, duration };
}
function project(items: Array<AudioFile | PauseItem>): Project {
  return { name: "t", path: "/show", numeros: [{ id: "n0", type: "numero", name: "N", items }] };
}

// The hook's <audio> element (it is created on mount).
function el(): FakeAudio {
  return FakeAudio.instances[FakeAudio.instances.length - 1];
}

async function settle(fn: () => void) {
  await act(async () => { fn(); await Promise.resolve(); });
}

beforeEach(() => {
  FakeAudio.instances = [];
  vi.stubGlobal("Audio", FakeAudio);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("usePlayer", () => {
  it("streams the file through the asset protocol", async () => {
    const { result } = renderHook(() => usePlayer(project([audio("a")]), null));
    await settle(() => result.current.playAt(0, 0));
    expect(el().src).toBe("asset:///show/musiques/a.mp3");
    await settle(() => el().pending[0].resolve());
    expect(result.current.state.isPlaying).toBe(true);
    expect(result.current.state.position).toEqual({ numeroIndex: 0, audioIndex: 0 });
  });

  it("does not start a track whose load was still pending when Stop was pressed", async () => {
    const { result } = renderHook(() => usePlayer(project([audio("a")]), null));
    await settle(() => result.current.playAt(0, 0));
    await settle(() => result.current.stop());
    await settle(() => el().pending[0].resolve());
    expect(result.current.state.isPlaying).toBe(false);
    expect(result.current.state.position).toBeNull();
  });

  it("stays on a track that failed to load, so that Next moves past it", async () => {
    const { result } = renderHook(() => usePlayer(project([audio("a"), audio("b")]), null));
    await settle(() => result.current.playAt(0, 0));
    await settle(() => el().pending[0].reject(new Error("unsupported")));
    expect(result.current.state.audioError).not.toBeNull();
    expect(result.current.state.position).toEqual({ numeroIndex: 0, audioIndex: 0 });

    await settle(() => result.current.next());
    expect(el().src).toBe("asset:///show/musiques/b.mp3");
    expect(result.current.state.position).toEqual({ numeroIndex: 0, audioIndex: 1 });
  });

  it("follows the current track by id when the list is edited around it", async () => {
    let p = project([audio("a"), audio("b")]);
    const { result, rerender } = renderHook(({ proj }) => usePlayer(proj, null), { initialProps: { proj: p } });
    await settle(() => result.current.playAt(0, 1));
    await settle(() => el().pending[0].resolve());

    p = project([audio("new"), audio("a"), audio("b")]);
    rerender({ proj: p });
    expect(result.current.state.position).toEqual({ numeroIndex: 0, audioIndex: 2 });
  });

  it("stops cleanly when the last track of the show ends", async () => {
    const { result } = renderHook(() => usePlayer(project([audio("a")]), null));
    await settle(() => result.current.playAt(0, 0));
    await settle(() => el().pending[0].resolve());

    el().ended = true;
    el().paused = true;
    await settle(() => el().fire("ended"));
    expect(result.current.state.isPlaying).toBe(false);
    expect(result.current.state.position).toBeNull();
  });

  it("moves on by itself when a timed pause runs out", async () => {
    const { result } = renderHook(() => usePlayer(project([pause("p", 2), audio("b")]), null));
    await settle(() => result.current.playAt(0, 0));
    expect(result.current.state.isPlaying).toBe(true);

    await act(async () => { vi.advanceTimersByTime(2100); });
    expect(el().src).toBe("asset:///show/musiques/b.mp3");
    expect(result.current.state.position).toEqual({ numeroIndex: 0, audioIndex: 1 });
  });

  it("reports progress relative to the excerpt and keeps seeking inside it", async () => {
    const { result } = renderHook(() => usePlayer(project([audio("a", { startTime: 30, endTime: 90 })]), null));
    await settle(() => result.current.playAt(0, 0));
    await settle(() => el().pending[0].resolve());

    el().currentTime = 45;
    await settle(() => el().fire("timeupdate"));
    expect(result.current.state.progress).toEqual({ position: 15, duration: 60 });

    await settle(() => result.current.seek(500));
    expect(el().currentTime).toBe(90);
    await settle(() => result.current.seek(-10));
    expect(el().currentTime).toBe(30);
  });

  it("fades out ahead of endTime so that the fade ends on the cut", async () => {
    const { result } = renderHook(() =>
      usePlayer(project([audio("a", { endTime: 60, fadeOut: 4 }), audio("b")]), null),
    );
    await settle(() => result.current.playAt(0, 0));
    await settle(() => el().pending[0].resolve());

    el().currentTime = 57;
    await settle(() => el().fire("timeupdate"));
    expect(result.current.state.fade?.type).toBe("out");
    expect(result.current.state.fade?.total).toBeCloseTo(3);

    await act(async () => { vi.advanceTimersByTime(3100); });
    expect(el().src).toBe("asset:///show/musiques/b.mp3");
  });
});
