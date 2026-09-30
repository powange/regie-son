import { describe, expect, it } from "vitest";
import { itemDuration, numeroDuration, remainingShowDuration } from "./runningTime";
import { estimateShowDuration } from "./preflight";
import { AudioFile, PauseItem, Project } from "./types";

function track(id: string, extra: Partial<AudioFile> = {}): AudioFile {
  return { type: "audio", id, filename: `${id}.mp3`, original_name: id, volume: 100, ...extra };
}
function pause(id: string, duration?: number): PauseItem {
  return { type: "pause", id, duration };
}

const durations = new Map([["a.mp3", 100], ["b.mp3", 200], ["c.mp3", 60]]);

const project: Project = {
  name: "Gala",
  path: "/gala",
  numeros: [
    { id: "n1", type: "numero", name: "One", items: [track("a", { startTime: 10, endTime: 70 }), pause("p", 5)] },
    { id: "n2", type: "numero", name: "Two", items: [track("b"), track("c", { startTime: 20 })] },
  ],
};

describe("itemDuration", () => {
  it("counts the excerpt of a track", () => {
    expect(itemDuration(track("a", { startTime: 10, endTime: 70 }), durations)).toBe(60);
    expect(itemDuration(track("c", { startTime: 20 }), durations)).toBe(40);
  });

  it("is unknown for an unmeasured file and an untimed pause", () => {
    expect(itemDuration(track("x"), durations)).toBeNull();
    expect(itemDuration(pause("w"), durations)).toBeNull();
    expect(itemDuration(pause("t", 8), durations)).toBe(8);
  });
});

describe("numeroDuration", () => {
  it("adds up an act and says when it is only a minimum", () => {
    expect(numeroDuration(project.numeros[0], durations)).toEqual({ seconds: 65, complete: true });
    expect(numeroDuration({ ...project.numeros[1], items: [...project.numeros[1].items, pause("w")] }, durations))
      .toEqual({ seconds: 240, complete: false });
  });

  it("agrees with estimateShowDuration over the whole show", () => {
    const total = project.numeros.reduce((s, n) => s + numeroDuration(n, durations).seconds, 0);
    expect(total).toBe(estimateShowDuration(project, durations).seconds);
  });
});

describe("remainingShowDuration", () => {
  const idle = { position: 0, duration: 0 };

  it("is the whole show when nothing is current", () => {
    expect(remainingShowDuration(project, durations, null, idle)).toEqual({ seconds: 305, complete: true });
  });

  it("counts what is left of the playing excerpt and everything after it", () => {
    const r = remainingShowDuration(project, durations, { numeroIndex: 0, audioIndex: 0 }, { position: 20, duration: 60 });
    expect(r).toEqual({ seconds: 40 + 5 + 200 + 40, complete: true });
  });

  it("counts what is left of a timed pause", () => {
    const r = remainingShowDuration(project, durations, { numeroIndex: 0, audioIndex: 1 }, { position: 2, duration: 5 });
    expect(r).toEqual({ seconds: 3 + 240, complete: true });
  });

  it("is a minimum while on an untimed pause", () => {
    const p: Project = { ...project, numeros: [{ ...project.numeros[0], items: [pause("w")] }, project.numeros[1]] };
    expect(remainingShowDuration(p, durations, { numeroIndex: 0, audioIndex: 0 }, idle))
      .toEqual({ seconds: 240, complete: false });
  });
});
