// Cut points are edited as m:ss.d. A tenth of a second is fine enough to place
// a cut by ear; whole seconds were not, and a cut at 12.7 s used to be saved
// at 12 s.

export function formatTime(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "";
  const tenths = Math.round(seconds * 10);
  const m = Math.floor(tenths / 600);
  const rest = tenths - m * 600;
  const s = Math.floor(rest / 10);
  const d = rest % 10;
  return `${m}:${s.toString().padStart(2, "0")}${d ? `.${d}` : ""}`;
}

/** Reads `m:ss`, `m:ss.d` or plain seconds. Seconds after a colon stop at 59. */
export function parseTime(str: string): number | undefined {
  const v = str.trim().replace(",", ".");
  if (v === "") return undefined;
  const mss = /^(\d+):([0-5]?\d(?:\.\d+)?)$/.exec(v);
  if (mss) return Number(mss[1]) * 60 + Number(mss[2]);
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v);
  return undefined;
}

/** A fade length in seconds. Null when the text is not a number. */
function parseFade(str: string): number | undefined | null {
  const v = str.trim().replace(",", ".");
  if (v === "") return undefined;
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  return n > 0 ? n : undefined;
}

export interface TrackTimes {
  startTime?: number;
  endTime?: number;
  fadeIn?: number;
  fadeOut?: number;
}

export interface TrackTimesInput {
  start: string;
  end: string;
  fadeIn: string;
  fadeOut: string;
}

export type TrackTimesError =
  | { code: "invalidStart" }
  | { code: "invalidEnd" }
  | { code: "endBeforeStart" }
  | { code: "startBeyondFile"; duration: number }
  | { code: "endBeyondFile"; duration: number }
  | { code: "invalidFadeIn" }
  | { code: "invalidFadeOut" }
  | { code: "fadesTooLong"; length: number };

// Cut points are shown rounded to a tenth: an end dragged to the very end of
// the file may read a few hundredths past it.
const ROUNDING_SLACK = 0.1;

/**
 * Checks the four fields of the track settings. `fileDuration` is null while
 * the file has not been measured: bounds against it are then skipped.
 */
export function validateTrackTimes(
  input: TrackTimesInput,
  fileDuration: number | null,
): { ok: true; value: TrackTimes } | { ok: false; error: TrackTimesError } {
  const startTime = parseTime(input.start);
  let endTime = parseTime(input.end);
  if (input.start.trim() !== "" && startTime === undefined) return { ok: false, error: { code: "invalidStart" } };
  if (input.end.trim() !== "" && endTime === undefined) return { ok: false, error: { code: "invalidEnd" } };

  if (fileDuration !== null) {
    if (startTime !== undefined && startTime >= fileDuration) {
      return { ok: false, error: { code: "startBeyondFile", duration: fileDuration } };
    }
    if (endTime !== undefined) {
      if (endTime > fileDuration + ROUNDING_SLACK) {
        return { ok: false, error: { code: "endBeyondFile", duration: fileDuration } };
      }
      endTime = Math.min(endTime, fileDuration);
    }
  }
  if (startTime !== undefined && endTime !== undefined && endTime <= startTime) {
    return { ok: false, error: { code: "endBeforeStart" } };
  }

  const fadeIn = parseFade(input.fadeIn);
  if (fadeIn === null) return { ok: false, error: { code: "invalidFadeIn" } };
  const fadeOut = parseFade(input.fadeOut);
  if (fadeOut === null) return { ok: false, error: { code: "invalidFadeOut" } };

  const segmentEnd = endTime ?? fileDuration;
  if (segmentEnd !== null && segmentEnd !== undefined) {
    const length = segmentEnd - (startTime ?? 0);
    if ((fadeIn ?? 0) + (fadeOut ?? 0) > length) {
      return { ok: false, error: { code: "fadesTooLong", length } };
    }
  }

  return { ok: true, value: { startTime, endTime, fadeIn, fadeOut } };
}
