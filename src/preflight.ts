import { Project } from "./types";

export type PreflightSeverity = "error" | "warning";

export interface PreflightIssue {
  severity: PreflightSeverity;
  message: string;
  numeroIndex?: number;
  itemIndex?: number;
}

interface PreflightContext {
  missingFiles: Set<string>;
  availableDeviceIds: Set<string>;
  selectedDeviceId: string | null;
}

export function runPreflight(project: Project, ctx: PreflightContext): PreflightIssue[] {
  const issues: PreflightIssue[] = [];

  if (ctx.selectedDeviceId && !ctx.availableDeviceIds.has(ctx.selectedDeviceId)) {
    issues.push({
      severity: "error",
      message: "Sortie audio sélectionnée introuvable. Vérifiez vos périphériques dans les paramètres.",
    });
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
  return runPreflight(project, { missingFiles, availableDeviceIds, selectedDeviceId });
}
