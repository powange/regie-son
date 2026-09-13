import i18next from "i18next";

// Human-readable duration for spans measured in minutes or hours: show length,
// battery autonomy. Distinct from the m:ss used on the player, which would
// render a 92-minute show as "92:30".
//
// The layout itself ("1 h 23" in French, "1h 23m" in English) comes from the
// catalogue, so a new language can pick its own without touching this code.
export function formatLongDuration(seconds: number, lng?: string): string {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const opts = { ns: "common", lng };
  if (h === 0) return i18next.t("duration.minutes", { m, ...opts });
  if (m === 0) return i18next.t("duration.hours", { h, ...opts });
  return i18next.t("duration.hoursMinutes", { h, m: m.toString().padStart(2, "0"), ...opts });
}
