import { Project } from "./types";
import { BatteryStatus, LOW_BATTERY_PERCENT } from "./useBattery";
import { formatLongDuration } from "./duration";

export type PreflightSeverity = "error" | "warning";

export interface PreflightIssue {
  severity: PreflightSeverity;
  message: string;
  numeroIndex?: number;
  itemIndex?: number;
}

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
    }
  }

  return { seconds, complete };
}

interface PreflightContext {
  missingFiles: Set<string>;
  availableDeviceIds: Set<string>;
  selectedDeviceId: string | null;
  battery: BatteryStatus | null;
  showDuration: ShowDuration;
}

export function runPreflight(project: Project, ctx: PreflightContext): PreflightIssue[] {
  const issues: PreflightIssue[] = [];

  if (ctx.selectedDeviceId && !ctx.availableDeviceIds.has(ctx.selectedDeviceId)) {
    issues.push({
      severity: "error",
      message: "Sortie audio sélectionnée introuvable. Vérifiez vos périphériques dans les paramètres.",
    });
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
          message:
            `Batterie à ${Math.round(ctx.battery.percent)} %, et le système n'estime pas ` +
            `l'autonomie restante. Branchez l'ordinateur sur le secteur.`,
        });
      }
    } else if (ctx.showDuration.seconds > 0 && left < ctx.showDuration.seconds) {
      const what = project.singleNumero ? "du numéro" : "du spectacle";
      const atLeast = ctx.showDuration.complete ? "" : "au moins ";
      issues.push({
        severity: "warning",
        message:
          `Autonomie restante ${formatLongDuration(left)}, inférieure à la durée ${what} ` +
          `(${atLeast}${formatLongDuration(ctx.showDuration.seconds)}). ` +
          `Branchez l'ordinateur sur le secteur.`,
      });
    }
  }

  project.numeros.forEach((numero, nIdx) => {
    numero.items.forEach((item, iIdx) => {
      if (item.type !== "audio") return;
      const label = `« ${item.original_name} » (${numero.name})`;

      if (ctx.missingFiles.has(item.filename)) {
        issues.push({
          severity: "error",
          message: `Fichier manquant sur ${label}`,
          numeroIndex: nIdx,
          itemIndex: iIdx,
        });
      }

      const hasStart = typeof item.startTime === "number";
      const hasEnd = typeof item.endTime === "number";
      if (hasStart && hasEnd && (item.startTime as number) >= (item.endTime as number)) {
        issues.push({
          severity: "warning",
          message: `Début ≥ fin sur ${label}`,
          numeroIndex: nIdx,
          itemIndex: iIdx,
        });
      }
      if (hasStart && hasEnd) {
        const effective = (item.endTime as number) - (item.startTime as number);
        const fades = (item.fadeIn ?? 0) + (item.fadeOut ?? 0);
        if (effective > 0 && fades > effective) {
          issues.push({
            severity: "warning",
            message: `Fade in + fade out plus long que la durée de lecture sur ${label}`,
            numeroIndex: nIdx,
            itemIndex: iIdx,
          });
        }
      }

      if ((item.volume ?? 100) === 0) {
        issues.push({
          severity: "warning",
          message: `Volume à 0 sur ${label}`,
          numeroIndex: nIdx,
          itemIndex: iIdx,
        });
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
): Promise<PreflightIssue[]> {
  const availableDeviceIds = new Set<string>();
  try {
    if (navigator.mediaDevices?.enumerateDevices) {
      const all = await navigator.mediaDevices.enumerateDevices();
      for (const d of all) {
        if (d.kind === "audiooutput") availableDeviceIds.add(d.deviceId);
      }
    }
  } catch {
    /* ignore; absence of enumerateDevices is not a failure */
  }
  return runPreflight(project, {
    missingFiles,
    availableDeviceIds,
    selectedDeviceId,
    battery,
    showDuration,
  });
}
