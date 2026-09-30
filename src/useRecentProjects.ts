import { RecentEntry, useRecentList } from "./storage";

export type RecentProject = RecentEntry;

const KEY = "regie-son:recent-projects";

export function useRecentProjects() {
  return useRecentList(KEY);
}
