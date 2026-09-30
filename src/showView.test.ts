import { describe, expect, it } from "vitest";
import { formatCountdown, showViewModel } from "./showView";
import type { PlayerState } from "./usePlayer";
import { AudioFile, PauseItem, Project } from "./types";

function track(id: string, cue?: string): AudioFile {
  return { type: "audio", id, filename: `${id}.mp3`, original_name: id, volume: 100, cue };
}
function pause(id: string, duration?: number): PauseItem {
  return { type: "pause", id, duration };
}

const project: Project = {
  name: "Gala",
  path: "/gala",
  numeros: [
    { id: "n1", type: "numero", name: "Jugglers", items: [track("a", "Lights down"), pause("p", 10)] },
    { id: "n2", type: "entracte", name: "Break", items: [] },
    { id: "n3", type: "numero", name: "Finale", items: [pause("w"), track("b", "Bow")] },
  ],
};

function state(partial: Partial<PlayerState>): PlayerState {
  return {
    position: null,
    isPlaying: false,
    progress: { position: 0, duration: 0 },
    audioError: null,
    outputError: null,
    fade: null,
    ...partial,
  };
}

describe("showViewModel", () => {
  it("shows the first item as next when nothing plays", () => {
    const m = showViewModel(state({}), project);
    expect(m.current).toBeNull();
    expect(m.next?.item.id).toBe("a");
    expect(m.remaining).toBeNull();
    expect(m.hasAudio).toBe(true);
  });

  it("counts down the excerpt of the playing track", () => {
    const m = showViewModel(state({
      position: { numeroIndex: 0, audioIndex: 0 },
      isPlaying: true,
      progress: { position: 30, duration: 120 },
    }), project);
    expect(m.current?.item.id).toBe("a");
    expect(m.remaining).toBe(90);
    expect(m.elapsedRatio).toBe(0.25);
    expect(m.next?.item.id).toBe("p");
  });

  it("shows the item after the current one when stopped on a track", () => {
    const m = showViewModel(state({ position: { numeroIndex: 0, audioIndex: 0 } }), project);
    expect(m.next?.item.id).toBe("p");
  });

  it("counts down a timed pause and skips empty acts for next", () => {
    const m = showViewModel(state({
      position: { numeroIndex: 0, audioIndex: 1 },
      progress: { position: 4, duration: 10 },
    }), project);
    expect(m.remaining).toBe(6);
    expect(m.onUntimedPause).toBe(false);
    expect(m.next?.item.id).toBe("w");
    expect(m.next?.numero.name).toBe("Finale");
  });

  it("has no countdown on an untimed pause", () => {
    const m = showViewModel(state({ position: { numeroIndex: 2, audioIndex: 0 } }), project);
    expect(m.remaining).toBeNull();
    expect(m.onUntimedPause).toBe(true);
    expect(m.next?.item.id).toBe("b");
  });

  it("has nothing next on the last item", () => {
    const m = showViewModel(state({
      position: { numeroIndex: 2, audioIndex: 1 },
      isPlaying: true,
      progress: { position: 1, duration: 60 },
    }), project);
    expect(m.next).toBeNull();
  });
});

describe("formatCountdown", () => {
  it("rounds up so that the clock reads 0:00 only at the end", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(0.2)).toBe("0:01");
    expect(formatCountdown(59.5)).toBe("1:00");
    expect(formatCountdown(125)).toBe("2:05");
    expect(formatCountdown(-3)).toBe("0:00");
  });
});
