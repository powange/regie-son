import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type BatteryState = "charging" | "discharging" | "full" | "empty" | "unknown";

export interface BatteryStatus {
  percent: number;
  state: BatteryState;
  // null whenever the OS declines to estimate the autonomy — common right
  // after (un)plugging, permanent on some machines.
  secondsRemaining: number | null;
}

const POLL_MS = 30_000;

// Charge level below which the machine is considered at risk. Shared by the
// header indicator and the preflight check so the two cannot drift apart.
export const LOW_BATTERY_PERCENT = 20;

// null means "no battery, or unreadable": a desktop tower is not an error
// condition, the indicator simply does not show.
export function useBattery(): BatteryStatus | null {
  const [status, setStatus] = useState<BatteryStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function read() {
      try {
        const s = await invoke<BatteryStatus | null>("get_battery_status");
        if (!cancelled) setStatus(s ?? null);
      } catch {
        if (!cancelled) setStatus(null);
      }
    }

    read();
    const id = setInterval(read, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return status;
}
