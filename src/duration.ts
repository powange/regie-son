// Human-readable duration for spans measured in minutes or hours: show length,
// battery autonomy. Distinct from the m:ss used on the player, which would
// render a 92-minute show as "92:30".
export function formatLongDuration(seconds: number): string {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m.toString().padStart(2, "0")}`;
}
