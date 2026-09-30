import { describe, it, expect, beforeAll } from "vitest";
import i18next from "i18next";
import { initI18n, resolveLanguage, FALLBACK_LNG, SUPPORTED_LNGS } from "./i18n";
import { formatLongDuration } from "./duration";
import { preflightMessage, type PreflightTFunction } from "./preflightMessage";
import type { PreflightIssue } from "./preflight";

beforeAll(() => {
  initI18n(FALLBACK_LNG);
});

describe("resolveLanguage", () => {
  const supported = ["en", "fr"];

  it("honours an explicit choice over the system preference", () => {
    expect(resolveLanguage("en", ["fr-FR"], supported)).toBe("en");
  });

  it("matches a regional tag to its base language", () => {
    expect(resolveLanguage(null, ["en-GB"], supported)).toBe("en");
  });

  it("walks down the preference list", () => {
    expect(resolveLanguage(null, ["de-DE", "en-US"], supported)).toBe("en");
  });

  it("falls back when nothing matches", () => {
    expect(resolveLanguage(null, ["ja"], supported)).toBe(FALLBACK_LNG);
  });

  // A stale settings file must not pin the app to a catalogue that has since
  // been removed.
  it("ignores a stored language that is no longer shipped", () => {
    expect(resolveLanguage("eo", ["en"], supported)).toBe("en");
  });
});

// Guards the promise made in CLAUDE.md: adding a language means translating,
// nothing else. A missing key would silently fall back to French, which is
// exactly the kind of half-translated screen this test exists to catch.
describe("catalogue parity", () => {
  const modules = import.meta.glob<Record<string, unknown>>("./i18n/locales/*/*.json", {
    eager: true,
    import: "default",
  });

  // Plural suffixes are a property of the language, not of the catalogue:
  // French needs _one/_other, Polish needs four forms. Comparing them literally
  // would reject a correct translation, so they are stripped before comparing.
  const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

  function flatten(value: unknown, prefix = ""): string[] {
    if (value === null || typeof value !== "object") return [prefix.replace(PLURAL_SUFFIX, "")];
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      flatten(v, prefix ? `${prefix}.${k}` : k),
    );
  }

  const byLocale: Record<string, Record<string, string[]>> = {};
  for (const [path, content] of Object.entries(modules)) {
    const [, lng, ns] = /\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path)!;
    (byLocale[lng] ??= {})[ns] = [...new Set(flatten(content))].sort();
  }

  const others = Object.keys(byLocale).filter((lng) => lng !== FALLBACK_LNG);

  it("ships more than one locale", () => {
    expect(others.length).toBeGreaterThan(0);
    expect(SUPPORTED_LNGS).toContain(FALLBACK_LNG);
  });

  // A misspelt {{param}} in a translation renders the placeholder as is.
  function params(value: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
    if (typeof value === "string") {
      out[prefix] = [...value.matchAll(/{{\s*([\w.]+)/g)].map((m) => m[1]).sort().join(",");
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) params(v, prefix ? `${prefix}.${k}` : k, out);
    }
    return out;
  }
  const raw: Record<string, Record<string, unknown>> = {};
  for (const [path, content] of Object.entries(modules)) {
    const [, lng, ns] = /\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path)!;
    (raw[lng] ??= {})[ns] = content;
  }

  function emptyKeys(value: unknown, prefix: string): string[] {
    if (typeof value === "string") return value.trim() === "" ? [prefix] : [];
    if (!value || typeof value !== "object") return [];
    return Object.entries(value).flatMap(([k, v]) => emptyKeys(v, `${prefix}.${k}`));
  }

  it.each(Object.keys(raw))("%s has no empty string", (lng) => {
    const empty = Object.entries(raw[lng]).flatMap(([ns, content]) => emptyKeys(content, ns));
    expect(empty).toEqual([]);
  });

  it.each(others)("%s uses the same {{params}} as the reference locale", (lng) => {
    for (const ns of Object.keys(raw[FALLBACK_LNG])) {
      const ref = params(raw[FALLBACK_LNG][ns]);
      const cur = params(raw[lng][ns]);
      // Plural forms differ by language: compare each base key against the
      // union of its reference forms.
      const base = (k: string) => k.replace(PLURAL_SUFFIX, "");
      const refByBase: Record<string, Set<string>> = {};
      for (const [k, p] of Object.entries(ref)) (refByBase[base(k)] ??= new Set()).add(p);
      for (const [k, p] of Object.entries(cur)) {
        expect(refByBase[base(k)], `${lng} ${ns}:${k}`).toBeDefined();
        expect([...refByBase[base(k)]], `${lng} ${ns}:${k} has {{${p}}}`).toContain(p);
      }
    }
  });

  it.each(others)("%s has exactly the keys of the reference locale", (lng) => {
    expect(Object.keys(byLocale[lng]).sort()).toEqual(Object.keys(byLocale[FALLBACK_LNG]).sort());
    for (const ns of Object.keys(byLocale[FALLBACK_LNG])) {
      expect(byLocale[lng][ns]).toEqual(byLocale[FALLBACK_LNG][ns]);
    }
  });
});

describe("formatLongDuration", () => {
  it.each([
    ["fr", 2700, "45 min"],
    ["fr", 7200, "2 h"],
    ["fr", 4980, "1 h 23"],
    ["en", 2700, "45 min"],
    ["en", 7200, "2h"],
    ["en", 4980, "1h 23m"],
  ])("formats %s %i s as %s", (lng, seconds, expected) => {
    expect(formatLongDuration(seconds, lng)).toBe(expected);
  });

  it("never goes negative", () => {
    expect(formatLongDuration(-60, "fr")).toBe("0 min");
  });
});

// The count-based plural replaced a concatenated "s". Asserting both forms in
// both languages is what stops that shortcut from creeping back.
describe("plurals", () => {
  it.each([
    ["fr", 1, "1 fichier manquant"],
    ["fr", 3, "3 fichiers manquants"],
    ["en", 1, "1 missing file"],
    ["en", 3, "3 missing files"],
  ])("%s renders %i as %s", async (lng, count, expected) => {
    await i18next.changeLanguage(lng);
    expect(i18next.t("editor:verify.missingFiles", { count })).toBe(expected);
  });
});

describe("preflightMessage", () => {
  // Bound to the same namespaces the modal binds, so the test exercises the
  // real lookup path rather than a laxer one.
  const fixedT = () => i18next.getFixedT(null, ["preflight", "common"]) as PreflightTFunction;

  const issue: PreflightIssue = {
    severity: "warning",
    code: "batteryShorterThanShowAtLeast",
    left: 3600,
    total: 7200,
  };

  it("renders durations in French", async () => {
    await i18next.changeLanguage("fr");
    expect(preflightMessage(fixedT(), issue)).toBe(
      "Autonomie restante 1 h, inférieure à la durée du spectacle (au moins 2 h). " +
        "Branchez l'ordinateur sur le secteur.",
    );
  });

  it("renders durations in English", async () => {
    await i18next.changeLanguage("en");
    expect(preflightMessage(fixedT(), issue)).toBe(
      "Battery runtime 1h, shorter than the show (at least 2h). " +
        "Plug the computer into mains power.",
    );
  });

  it("quotes the track the way the language does", async () => {
    const missing: PreflightIssue = {
      severity: "error",
      code: "trackFileMissing",
      track: "intro.mp3",
      act: "Ouverture",
    };
    await i18next.changeLanguage("fr");
    expect(preflightMessage(fixedT(), missing)).toBe(
      "Fichier manquant sur « intro.mp3 » (Ouverture)",
    );
    await i18next.changeLanguage("en");
    expect(preflightMessage(fixedT(), missing)).toBe(
      'Missing file on "intro.mp3" (Ouverture)',
    );
  });
});
