import { Project } from "./types";
import { BatteryStatus, LOW_BATTERY_PERCENT } from "./useBattery";

export type PreflightSeverity = "error" | "warning";

interface IssueLocation {
  numeroIndex?: number;
  itemIndex?: number;
}

// Issues carry a code and its parameters rather than a sentence: the wording
// belongs to the catalogue (see preflightMessage.ts), and the rules stay
// testable without loading i18next.
//
// The battery cases are four codes rather than one code with two flags because
// the sentences do not decompose the same way in every language: "la durée du
// spectacle" contracts the article, so a French translator needs the whole
// sentence, not the fragments to glue together.
export type PreflightIssue = IssueLocation & { severity: PreflightSeverity } & (
  | { code: "audioDeviceMissing" }
  | { code: "outputRoutingUnsupported" }
  | { code: "batteryLowNoEstimate"; percent: number }
  | { code: "batteryShorterThanShow"; left: number; total: number }
  | { code: "batteryShorterThanShowAtLeast"; left: number; total: number }
  | { code: "batteryShorterThanAct"; left: number; total: number }
  | { code: "batteryShorterThanActAtLeast"; left: number; total: number }
  | { code: "trackFileMissing"; track: string; act: string }
  | { code: "trackStartAfterEnd"; track: string; act: string }
  | { code: "trackStartBeyondFile"; track: string; act: string }
  | { code: "trackEndBeyondFile"; track: string; act: string }
  | { code: "trackFadesTooLong"; track: string; act: string }
  | { code: "trackVolumeZero"; track: string; act: string }
);

export type PreflightIssueCode = PreflightIssue["code"];

export interface ShowDuration {
  seconds: number;
  // False when some steps could not be measured: pauses left without a
  // duration wait for the operator, and a file whose metadata has not been
  // read yet contributes nothing. The real run is then longer than `seconds`.
  complete: boolean;
}

// Playing time of the whole show. This is a floor, never an upper bound: it
// counts no time between numeros and no untimed pause.
export function estimateShowDuration(
  project: Project,
  durations: Map<string, number>,
): ShowDuration {
  let seconds = 0;
  let complete = true;

  for (const numero of project.numeros) {
    for (const item of numero.items) {
      if (item.type === "pause") {
        if (typeof item.duration === "number") seconds += item.duration;
        else complete = false;
        continue;
      }
      const full = durations.get(item.filename);
      const end = item.endTime ?? full;
      if (end === undefined) {
        complete = false;
        continue;
      }
      seconds += Math.max(0, end - (item.startTime ?? 0));
      // A looping track plays until Next: one pass is only a minimum.
      if (item.loop) complete = false;
    }
  }

  return { seconds, complete };
}

interface PreflightContext {
  missingFiles: Set<string>;
  availableDeviceIds: Set<string>;
  // Without the media permission Chromium lists outputs with empty ids: the
  // chosen one cannot be looked up, which says nothing about its presence.
  deviceListReliable: boolean;
  // setSinkId only exists in Chromium (WebView2); elsewhere the chosen
  // output is ignored and sound goes to the default one.
  outputRoutingSupported: boolean;
  selectedDeviceId: string | null;
  battery: BatteryStatus | null;
  showDuration: ShowDuration;
  // Measured file lengths, by filename; a file not measured yet is skipped
  // by the checks that need its length.
  fileDurations?: Map<string, number>;
}

// Metadata durations are rounded differently by each decoder: a cut point a
// hair past the reported end is not a mistake.
const DURATION_TOLERANCE = 0.5;

function batteryShortfallCode(
  singleNumero: boolean,
  complete: boolean,
): Extract<PreflightIssueCode, `batteryShorterThan${string}`> {
  if (singleNumero) {
    return complete ? "batteryShorterThanAct" : "batteryShorterThanActAtLeast";
  }
  return complete ? "batteryShorterThanShow" : "batteryShorterThanShowAtLeast";
}

export function runPreflight(project: Project, ctx: PreflightContext): PreflightIssue[] {
  const issues: PreflightIssue[] = [];

  if (ctx.selectedDeviceId && !ctx.outputRoutingSupported) {
    issues.push({ severity: "warning", code: "outputRoutingUnsupported" });
  } else if (
    ctx.selectedDeviceId &&
    ctx.deviceListReliable &&
    !ctx.availableDeviceIds.has(ctx.selectedDeviceId)
  ) {
    issues.push({ severity: "error", code: "audioDeviceMissing" });
  }

  // Running out of battery mid-show is unrecoverable, so this is worth
  // checking. Kept a warning rather than an error: the autonomy figure is an
  // OS estimate, unstable and sometimes plain wrong, and an error would block
  // the operator from starting the show at all.
  if (ctx.battery?.state === "discharging") {
    const left = ctx.battery.secondsRemaining;
    if (left === null) {
      // No autonomy estimate from the OS. Fall back on the charge level, so
      // that "no warning" cannot quietly mean "never checked".
      if (ctx.battery.percent < LOW_BATTERY_PERCENT) {
        issues.push({
          severity: "warning",
          code: "batteryLowNoEstimate",
          percent: Math.round(ctx.battery.percent),
        });
      }
    } else if (ctx.showDuration.seconds > 0 && left < ctx.showDuration.seconds) {
      issues.push({
        severity: "warning",
        code: batteryShortfallCode(!!project.singleNumero, ctx.showDuration.complete),
        left,
        total: ctx.showDuration.seconds,
      });
    }
  }

  project.numeros.forEach((numero, nIdx) => {
    numero.items.forEach((item, iIdx) => {
      if (item.type !== "audio") return;
      const where = { numeroIndex: nIdx, itemIndex: iIdx };
      const track = { track: item.original_name, act: numero.name };

      if (ctx.missingFiles.has(item.filename)) {
        issues.push({ severity: "error", code: "trackFileMissing", ...track, ...where });
      }

      const hasStart = typeof item.startTime === "number";
      const hasEnd = typeof item.endTime === "number";
      const fileLength = ctx.fileDurations?.get(item.filename);
      if (hasStart && hasEnd && (item.startTime as number) >= (item.endTime as number)) {
        issues.push({ severity: "warning", code: "trackStartAfterEnd", ...track, ...where });
      }
      // Nothing would play at all: the track would end as soon as it starts.
      if (fileLength !== undefined && hasStart && (item.startTime as number) >= fileLength - DURATION_TOLERANCE) {
        issues.push({ severity: "error", code: "trackStartBeyondFile", ...track, ...where });
      }
      // Plays to the end of the file instead: worth knowing, not blocking.
      if (fileLength !== undefined && hasEnd && (item.endTime as number) > fileLength + DURATION_TOLERANCE) {
        issues.push({ severity: "warning", code: "trackEndBeyondFile", ...track, ...where });
      }
      // With a bound missing, the file length stands in for it.
      const start = item.startTime ?? 0;
      const end = item.endTime ?? fileLength;
      if (end !== undefined) {
        const effective = end - start;
        const fades = (item.fadeIn ?? 0) + (item.fadeOut ?? 0);
        if (effective > 0 && fades > effective) {
          issues.push({ severity: "warning", code: "trackFadesTooLong", ...track, ...where });
        }
      }

      if ((item.volume ?? 100) === 0) {
        issues.push({ severity: "warning", code: "trackVolumeZero", ...track, ...where });
      }
    });
  });

  return issues;
}

export async function gatherPreflight(
  project: Project,
  missingFiles: Set<string>,
  selectedDeviceId: string | null,
  battery: BatteryStatus | null,
  showDuration: ShowDuration,
  fileDurations?: Map<string, number>,
): Promise<PreflightIssue[]> {
  const availableDeviceIds = new Set<string>();
  let deviceListReliable = false;
  try {
    if (navigator.mediaDevices?.enumerateDevices) {
      const all = await navigator.mediaDevices.enumerateDevices();
      const outputs = all.filter((d) => d.kind === "audiooutput");
      for (const d of outputs) availableDeviceIds.add(d.deviceId);
      deviceListReliable = outputs.length > 0 && outputs.every((d) => d.deviceId !== "");
    }
  } catch {
    /* ignore; absence of enumerateDevices is not a failure */
  }
  return runPreflight(project, {
    missingFiles,
    availableDeviceIds,
    deviceListReliable,
    outputRoutingSupported: "setSinkId" in HTMLMediaElement.prototype,
    selectedDeviceId,
    battery,
    showDuration,
    fileDurations,
  });
}
