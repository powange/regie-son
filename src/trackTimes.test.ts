import { describe, expect, it } from "vitest";
import { formatTime, parseTime, validateTrackTimes } from "./trackTimes";

describe("formatTime", () => {
  it("keeps tenths of a second", () => {
    expect(formatTime(12.7)).toBe("0:12.7");
    expect(formatTime(83.25)).toBe("1:23.3");
  });

  it("leaves whole seconds without a decimal", () => {
    expect(formatTime(30)).toBe("0:30");
    expect(formatTime(0)).toBe("0:00");
  });

  it("carries a rounding up to the next minute", () => {
    expect(formatTime(59.96)).toBe("1:00");
  });

  it("is empty for no value", () => {
    expect(formatTime(undefined)).toBe("");
    expect(formatTime(NaN)).toBe("");
  });
});

describe("parseTime", () => {
  it("reads m:ss, m:ss.d and plain seconds", () => {
    expect(parseTime("1:05")).toBe(65);
    expect(parseTime("0:12.7")).toBeCloseTo(12.7);
    expect(parseTime("165")).toBe(165);
    expect(parseTime("12.5")).toBe(12.5);
  });

  it("accepts a decimal comma", () => {
    expect(parseTime("0:12,7")).toBeCloseTo(12.7);
  });

  it("rejects seconds past 59 after a colon", () => {
    expect(parseTime("1:75")).toBeUndefined();
    expect(parseTime("1:60")).toBeUndefined();
  });

  it("rejects garbage and negatives", () => {
    expect(parseTime("abc")).toBeUndefined();
    expect(parseTime("-3")).toBeUndefined();
    expect(parseTime("1:2:3")).toBeUndefined();
  });

  it("round-trips with formatTime", () => {
    for (const v of [0, 12.7, 59.9, 60, 125.4, 3600.1]) {
      expect(parseTime(formatTime(v))).toBeCloseTo(v);
    }
  });
});

const empty = { start: "", end: "", fadeIn: "", fadeOut: "" };

describe("validateTrackTimes", () => {
  it("accepts empty fields", () => {
    expect(validateTrackTimes(empty, 120)).toEqual({ ok: true, value: {} });
  });

  it("reports unreadable fields", () => {
    expect(validateTrackTimes({ ...empty, start: "1:75" }, 120)).toMatchObject({ error: { code: "invalidStart" } });
    expect(validateTrackTimes({ ...empty, end: "x" }, 120)).toMatchObject({ error: { code: "invalidEnd" } });
    expect(validateTrackTimes({ ...empty, fadeIn: "-1" }, 120)).toMatchObject({ error: { code: "invalidFadeIn" } });
    expect(validateTrackTimes({ ...empty, fadeOut: "abc" }, 120)).toMatchObject({ error: { code: "invalidFadeOut" } });
  });

  it("requires the end after the start", () => {
    expect(validateTrackTimes({ ...empty, start: "1:00", end: "0:30" }, 120)).toMatchObject({ error: { code: "endBeforeStart" } });
  });

  it("bounds the cut points by the file duration", () => {
    expect(validateTrackTimes({ ...empty, start: "2:00" }, 120)).toMatchObject({ error: { code: "startBeyondFile", duration: 120 } });
    expect(validateTrackTimes({ ...empty, end: "2:30" }, 120)).toMatchObject({ error: { code: "endBeyondFile", duration: 120 } });
  });

  it("clamps an end rounded just past the file", () => {
    expect(validateTrackTimes({ ...empty, end: "3:03.5" }, 183.47)).toEqual({ ok: true, value: { endTime: 183.47 } });
  });

  it("skips the bounds while the duration is unknown", () => {
    expect(validateTrackTimes({ ...empty, end: "9:00" }, null)).toEqual({ ok: true, value: { endTime: 540 } });
  });

  it("requires both fades to fit in the played segment", () => {
    expect(validateTrackTimes({ start: "0:10", end: "0:20", fadeIn: "6", fadeOut: "5" }, 120))
      .toMatchObject({ error: { code: "fadesTooLong", length: 10 } });
    expect(validateTrackTimes({ ...empty, fadeIn: "70", fadeOut: "60" }, 120))
      .toMatchObject({ error: { code: "fadesTooLong", length: 120 } });
    expect(validateTrackTimes({ start: "0:10", end: "0:20", fadeIn: "5", fadeOut: "5" }, 120))
      .toEqual({ ok: true, value: { startTime: 10, endTime: 20, fadeIn: 5, fadeOut: 5 } });
  });

  it("treats a zero fade as no fade", () => {
    expect(validateTrackTimes({ ...empty, fadeIn: "0" }, 120)).toEqual({ ok: true, value: {} });
  });
});
