export function slugify(name: string): string {
  return name
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
}

/**
 * Folder name for a new show or act. A name with no Latin letter or digit
 * (Japanese, emoji only) has an empty slug, and the project would land in the
 * base folder itself: it gets a dated name instead.
 */
export function folderNameFor(name: string, fallbackPrefix: string, now: Date = new Date()): string {
  const slug = slugify(name);
  if (slug) return slug;
  const pad = (n: number) => n.toString().padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  return `${fallbackPrefix}-${date}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}
