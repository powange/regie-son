import { describe, it, expect, beforeAll } from "vitest";
import i18next from "i18next";
import { initI18n, FALLBACK_LNG } from "./i18n";
import { isNotFoundError, translateError } from "./errorMessage";
import frErrors from "./i18n/locales/fr/errors.json";

beforeAll(async () => {
  initI18n(FALLBACK_LNG);
  await i18next.changeLanguage("fr");
});

// Le code d'erreur voyage de Rust au catalogue sous forme de chaîne : ni le
// compilateur Rust ni TypeScript ne peuvent vérifier qu'il correspond à une
// entrée réelle. Ce test le fait à leur place, en relisant les sources Rust.
describe("codes d'erreur Rust", () => {
  // Les sources Rust sont lues par le glob de Vite : pas de dépendance à Node,
  // donc ce test tourne aussi bien sous vitest que sous tsc.
  const rustSources = import.meta.glob<string>("../src-tauri/src/*.rs", {
    eager: true,
    query: "?raw",
    import: "default",
  });

  // Every string literal shaped like "namespace.code" whose namespace exists
  // in the catalogue, rather than only the literal right after
  // AppError::new( : that also catches codes picked by an if/else or kept in
  // a constant, which a call-site pattern missed.
  const namespaces = new Set(Object.keys(frErrors));
  const codes = [
    ...new Set(
      Object.values(rustSources).flatMap((source) =>
        // Test modules sit at the end of each file and hold file names and
        // URLs (e.g. "download.php") that look like codes.
        [...source.split("#[cfg(test)]")[0].matchAll(/"([a-z][a-zA-Z0-9]*\.[a-zA-Z0-9_.]+)"/g)]
          .map((m) => m[1])
          .filter((code) => namespaces.has(code.split(".")[0])),
      ),
    ),
  ].sort();

  it("en trouve un nombre plausible", () => {
    expect(codes.length).toBeGreaterThan(60);
  });

  it.each(codes)("%s existe dans le catalogue", (code) => {
    expect(i18next.exists(`errors:${code}`)).toBe(true);
  });
});

describe("translateError", () => {
  it("rend un message générique sans rien à dire", () => {
    expect(translateError("")).toBe("Une erreur inconnue est survenue.");
    expect(translateError(null)).toBe("Une erreur inconnue est survenue.");
    expect(translateError(undefined)).toBe("Une erreur inconnue est survenue.");
  });

  it("traduit un code, détail compris", () => {
    expect(translateError({ code: "io.saveFailed", detail: "permission denied" })).toBe(
      "Impossible de sauvegarder : permission denied",
    );
  });

  it("interpole les paramètres", () => {
    expect(translateError({ code: "archive.corrupt", params: { name: "projet.json" } })).toBe(
      "Archive corrompue : projet.json illisible.",
    );
  });

  it("traduit un code sans détail ni paramètre", () => {
    expect(translateError({ code: "download.cancelled" })).toBe("Téléchargement annulé.");
  });

  // Le détail vient de yt-dlp ou de reqwest, en anglais, et dit souvent quelque
  // chose de plus utile que le code générique qui l'enveloppe.
  it("préfère le détail reconnu au message du code", () => {
    expect(
      translateError({ code: "download.ytDlpFailed", detail: "ERROR: Private video" }),
    ).toBe("Cette vidéo est privée et ne peut pas être téléchargée.");
    expect(
      translateError({ code: "download.failed", detail: "tcp connect error: connection refused" }),
    ).toBe("Impossible de se connecter au serveur.");
  });

  it("reconnaît les statuts HTTP qui méritent mieux qu'un numéro", () => {
    const http = (status: number) => ({ code: "download.httpStatus", params: { status: String(status), url: "http://x" } });
    expect(translateError(http(404))).toBe("URL introuvable (404).");
    expect(translateError(http(403))).toBe("Accès refusé par le serveur (403).");
    expect(translateError(http(401))).toBe("Authentification requise (401).");
    expect(translateError(http(503))).toBe("Erreur côté serveur, réessayez plus tard.");
  });

  it("retombe sur le message du code pour un statut sans traitement", () => {
    expect(
      translateError({ code: "download.httpStatus", params: { status: "418", url: "http://x" } }),
    ).toBe("Erreur HTTP 418 : http://x");
  });

  // set_show_mode rend un code par volet en échec : l'opérateur doit savoir
  // lequel des deux a renoncé.
  it("joint les erreurs du mode spectacle", () => {
    expect(
      translateError([{ code: "showMode.unsupportedOs" }, { code: "sleep.unsupportedOs" }]),
    ).toBe(
      "Mode spectacle non supporté sur cet OS. · Blocage de la mise en veille non supporté sur cet OS.",
    );
  });

  it("expose une erreur qui n'est pas la nôtre plutôt que de la masquer", () => {
    expect(translateError("something went wrong")).toBe("Erreur : something went wrong");
    expect(translateError(new Error("Private video detected"))).toBe(
      "Cette vidéo est privée et ne peut pas être téléchargée.",
    );
  });

  it("suit la langue active", async () => {
    await i18next.changeLanguage("en");
    expect(translateError({ code: "download.cancelled" })).toBe("Download cancelled.");
    await i18next.changeLanguage("fr");
  });
});

describe("isNotFoundError", () => {
  it("recognises a missing project folder on every platform", () => {
    expect(isNotFoundError({ code: "io.readProjectFailed", detail: "No such file or directory (os error 2)" })).toBe(true);
    expect(isNotFoundError({ code: "io.readProjectFailed", detail: "Le chemin d'accès spécifié est introuvable. (os error 3)" })).toBe(true);
  });

  it("leaves the other failures alone", () => {
    expect(isNotFoundError({ code: "io.readProjectFailed", detail: "Permission denied (os error 13)" })).toBe(false);
    expect(isNotFoundError({ code: "project.invalidFile", detail: "expected value at line 1 column 1" })).toBe(false);
    expect(isNotFoundError("boom")).toBe(false);
  });
});
