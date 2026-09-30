import i18next from "i18next";
import { initReactI18next } from "react-i18next";

// Catalogues chargés par glob : ajouter une langue se résume à déposer un
// dossier dans locales/, sans toucher à ce fichier ni au sélecteur de langue.
const modules = import.meta.glob<Record<string, unknown>>("./locales/*/*.json", {
  eager: true,
  import: "default",
});

const resources: Record<string, Record<string, Record<string, unknown>>> = {};
for (const [path, content] of Object.entries(modules)) {
  const match = /\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path);
  if (!match) continue;
  const [, lng, ns] = match;
  (resources[lng] ??= {})[ns] = content;
}

export const FALLBACK_LNG = "fr";
export const DEFAULT_NS = "common";
export const SUPPORTED_LNGS = Object.keys(resources).sort();

// Nom de chaque langue dans cette langue : c'est ce qu'on attend d'un sélecteur
// de langue, puisqu'on le lit justement quand l'interface est dans une langue
// qu'on ne comprend pas. Une langue absente d'ici retombe sur son code.
const ENDONYMS: Record<string, string> = {
  fr: "Français",
  en: "English",
};

export function languageName(lng: string): string {
  return ENDONYMS[lng] ?? lng;
}

// `stored` est le choix explicite de l'utilisateur, `preferred` ce que l'OS
// annonce (navigator.languages). Une correspondance de région suffit : un
// système en "en-GB" reçoit le catalogue "en".
export function resolveLanguage(
  stored: string | null | undefined,
  preferred: readonly string[],
  supported: readonly string[] = SUPPORTED_LNGS,
): string {
  if (stored && supported.includes(stored)) return stored;
  for (const tag of preferred) {
    const base = tag.toLowerCase().split("-")[0];
    const hit = supported.find((lng) => lng.toLowerCase().split("-")[0] === base);
    if (hit) return hit;
  }
  return FALLBACK_LNG;
}

function preferredLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages ?? [navigator.language];
}

// Applies a stored preference. `null` means "follow the OS", so it is resolved
// against navigator.languages again rather than remembered.
export function applyLanguage(stored: string | null | undefined) {
  return i18next.changeLanguage(resolveLanguage(stored, preferredLanguages()));
}

export function initI18n(storedLanguage: string | null | undefined) {
  if (i18next.isInitialized) return i18next;

  i18next.use(initReactI18next).init({
    resources,
    lng: resolveLanguage(storedLanguage, preferredLanguages()),
    fallbackLng: FALLBACK_LNG,
    supportedLngs: SUPPORTED_LNGS,
    defaultNS: DEFAULT_NS,
    ns: Object.keys(resources[FALLBACK_LNG] ?? {}),
    // React échappe déjà tout ce qu'il rend ; laisser i18next le refaire
    // transformerait les apostrophes et guillemets en entités HTML visibles.
    interpolation: { escapeValue: false },
    // i18next-cli extract fills a new key with "" in every locale: an
    // untranslated key must fall back to French, not show an empty label.
    returnEmptyString: false,
  });

  return i18next;
}

export default i18next;
