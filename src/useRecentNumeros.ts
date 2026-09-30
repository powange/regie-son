import { RecentEntry, useRecentList } from "./storage";

export type RecentNumero = RecentEntry;

const KEY = "regie-son:recent-numeros";

export function useRecentNumeros() {
  return useRecentList(KEY);
}
