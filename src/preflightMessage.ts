import type { TFunction } from "i18next";
import type { PreflightIssue } from "./preflight";
import { formatLongDuration } from "./duration";

// Turns a preflight issue into a sentence. Every key is written out literally
// so that `i18next-cli extract` and the generated types both see them; a key
// built by string concatenation would be invisible to either.
export type PreflightTFunction = TFunction<["preflight", "common"]>;

export function preflightMessage(t: PreflightTFunction, issue: PreflightIssue): string {
  switch (issue.code) {
    case "audioDeviceMissing":
      return t("preflight:audioDeviceMissing");
    case "outputRoutingUnsupported":
      return t("preflight:outputRoutingUnsupported");
    case "batteryLowNoEstimate":
      return t("preflight:batteryLowNoEstimate", { percent: issue.percent });
    case "batteryShorterThanShow":
      return t("preflight:batteryShorterThanShow", { left: formatLongDuration(issue.left), total: formatLongDuration(issue.total) });
    case "batteryShorterThanShowAtLeast":
      return t("preflight:batteryShorterThanShowAtLeast", { left: formatLongDuration(issue.left), total: formatLongDuration(issue.total) });
    case "batteryShorterThanAct":
      return t("preflight:batteryShorterThanAct", { left: formatLongDuration(issue.left), total: formatLongDuration(issue.total) });
    case "batteryShorterThanActAtLeast":
      return t("preflight:batteryShorterThanActAtLeast", { left: formatLongDuration(issue.left), total: formatLongDuration(issue.total) });
    case "trackFileMissing":
      return t("preflight:trackFileMissing", { label: trackLabel(t, issue) });
    case "trackStartAfterEnd":
      return t("preflight:trackStartAfterEnd", { label: trackLabel(t, issue) });
    case "trackFadesTooLong":
      return t("preflight:trackFadesTooLong", { label: trackLabel(t, issue) });
    case "trackVolumeZero":
      return t("preflight:trackVolumeZero", { label: trackLabel(t, issue) });
  }
}

// The quotation marks differ by language — French guillemets, English double
// quotes — so the label is a catalogue entry rather than a template here.
function trackLabel(t: PreflightTFunction, issue: { track: string; act: string }): string {
  return t("common:trackInAct", { track: issue.track, act: issue.act });
}
