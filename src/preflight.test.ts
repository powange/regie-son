import { describe, it, expect } from "vitest";
import { estimateShowDuration, runPreflight, ShowDuration } from "./preflight";
import { Project, AudioFile, PauseItem } from "./types";
import { BatteryStatus } from "./useBattery";

function audio(id: string, extra: Partial<AudioFile> = {}): AudioFile {
  return { type: "audio", id, filename: `${id}.mp3`, original_name: id, volume: 100, ...extra };
}
function pause(id: string, duration?: number): PauseItem {
  return { type: "pause", id, duration };
}

function makeProject(items: Array<AudioFile | PauseItem>, singleNumero = false): Project {
  return {
    name: "test",
    path: "/tmp/test",
    singleNumero,
    numeros: [{ id: "n0", type: "numero", name: "N1", items }],
  };
}

const baseCtx = {
  missingFiles: new Set<string>(),
  availableDeviceIds: new Set<string>(),
  selectedDeviceId: null,
  battery: null as BatteryStatus | null,
  showDuration: { seconds: 0, complete: true } as ShowDuration,
};

function battery(over: Partial<BatteryStatus>): BatteryStatus {
  return { percent: 50, state: "discharging", secondsRemaining: null, ...over };
}

describe("estimateShowDuration", () => {
  it("sums full track durations", () => {
    const p = makeProject([audio("a"), audio("b")]);
    const d = new Map([["a.mp3", 120], ["b.mp3", 180]]);
    expect(estimateShowDuration(p, d)).toEqual({ seconds: 300, complete: true });
  });

  it("counts only the trimmed span", () => {
    const p = makeProject([audio("a", { startTime: 10, endTime: 40 })]);
    expect(estimateShowDuration(p, new Map([["a.mp3", 300]])).seconds).toBe(30);
  });

  it("uses endTime even when the file has not been measured", () => {
    const p = makeProject([audio("a", { endTime: 25 })]);
    expect(estimateShowDuration(p, new Map())).toEqual({ seconds: 25, complete: true });
  });

  it("adds timed pauses", () => {
    const p = makeProject([audio("a"), pause("p", 45)]);
    expect(estimateShowDuration(p, new Map([["a.mp3", 60]]))).toEqual({
      seconds: 105,
      complete: true,
    });
  });

  it("flags an untimed pause as incomplete, since it waits for the operator", () => {
    const p = makeProject([audio("a"), pause("p")]);
    const d = estimateShowDuration(p, new Map([["a.mp3", 60]]));
    expect(d).toEqual({ seconds: 60, complete: false });
  });

  it("flags an unmeasured file as incomplete rather than counting it as zero-length", () => {
    const p = makeProject([audio("a"), audio("b")]);
    const d = estimateShowDuration(p, new Map([["a.mp3", 60]]));
    expect(d).toEqual({ seconds: 60, complete: false });
  });
});

describe("battery preflight rule", () => {
  const twoHours: ShowDuration = { seconds: 7200, complete: true };
  const project = makeProject([audio("a")]);

  // Both battery messages end on the same advice; matching that is more
  // robust than matching a wording that differs between the two.
  const isBatteryIssue = (message: string) => message.includes("sur le secteur");

  function batteryIssues(ctx: Partial<typeof baseCtx>) {
    return runPreflight(project, { ...baseCtx, ...ctx }).filter((i) => isBatteryIssue(i.message));
  }

  it("warns when the autonomy is shorter than the show", () => {
    const issues = batteryIssues({
      battery: battery({ secondsRemaining: 3600 }),
      showDuration: twoHours,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].message).toContain("1 h");
    expect(issues[0].message).toContain("2 h");
  });

  it("stays silent when the autonomy covers the show", () => {
    expect(
      batteryIssues({ battery: battery({ secondsRemaining: 10800 }), showDuration: twoHours }),
    ).toHaveLength(0);
  });

  // An error would block show mode entirely; the OS estimate is too shaky for
  // that, so this must never escalate beyond a warning.
  it("never blocks show mode", () => {
    const issues = batteryIssues({
      battery: battery({ secondsRemaining: 60 }),
      showDuration: twoHours,
    });
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
  });

  it("stays silent while charging", () => {
    expect(
      batteryIssues({
        battery: battery({ state: "charging", secondsRemaining: 60 }),
        showDuration: twoHours,
      }),
    ).toHaveLength(0);
  });

  it("falls back on the charge level when the OS gives no estimate", () => {
    const issues = batteryIssues({
      battery: battery({ secondsRemaining: null, percent: 12 }),
      showDuration: twoHours,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].message).toContain("12 %");
  });

  it("stays silent with no estimate but a comfortable charge", () => {
    expect(
      batteryIssues({
        battery: battery({ secondsRemaining: null, percent: 80 }),
        showDuration: twoHours,
      }),
    ).toHaveLength(0);
  });

  it("stays silent while charging on a low battery with no estimate", () => {
    expect(
      batteryIssues({
        battery: battery({ state: "charging", secondsRemaining: null, percent: 5 }),
        showDuration: twoHours,
      }),
    ).toHaveLength(0);
  });

  // The fallback must not fire on top of the duration comparison.
  it("reports a single issue when both the estimate and the charge are low", () => {
    expect(
      batteryIssues({
        battery: battery({ secondsRemaining: 60, percent: 3 }),
        showDuration: twoHours,
      }),
    ).toHaveLength(1);
  });

  it("warns on a flat battery even without a show duration", () => {
    const issues = batteryIssues({
      battery: battery({ secondsRemaining: null, percent: 8 }),
      showDuration: { seconds: 0, complete: true },
    });
    expect(issues).toHaveLength(1);
  });

  it("stays silent without a battery", () => {
    expect(batteryIssues({ battery: null, showDuration: twoHours })).toHaveLength(0);
  });

  it("says the show lasts at least X when the estimate is incomplete", () => {
    const issues = batteryIssues({
      battery: battery({ secondsRemaining: 600 }),
      showDuration: { seconds: 3600, complete: false },
    });
    expect(issues[0].message).toContain("au moins");
  });

  it("names a standalone numero as such", () => {
    const issues = runPreflight(makeProject([audio("a")], true), {
      ...baseCtx,
      battery: battery({ secondsRemaining: 600 }),
      showDuration: twoHours,
    }).filter((i) => i.message.includes("sur le secteur"));
    expect(issues[0].message).toContain("du numéro");
  });
});
