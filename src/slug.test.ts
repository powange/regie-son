import { describe, expect, it } from "vitest";
import { folderNameFor, joinPath, slugify } from "./slug";

describe("slugify", () => {
  it("strips accents and joins words with dashes", () => {
    expect(slugify("  Cabaret de Printemps été 2025 ")).toBe("cabaret-de-printemps-ete-2025");
  });

  it("is empty for a name without Latin letters or digits", () => {
    expect(slugify("公演")).toBe("");
  });
});

describe("folderNameFor", () => {
  const now = new Date(2026, 2, 7, 9, 5);

  it("uses the slug when there is one", () => {
    expect(folderNameFor("Tango de la rose", "numero", now)).toBe("tango-de-la-rose");
  });

  it("falls back to a dated name when the slug is empty", () => {
    expect(folderNameFor("公演", "projet", now)).toBe("projet-20260307-0905");
    expect(folderNameFor("🎭🎶", "numero", now)).toBe("numero-20260307-0905");
  });
});

describe("joinPath", () => {
  it("uses the separator of the base folder", () => {
    expect(joinPath("/home/me/Spectacles", "gala")).toBe("/home/me/Spectacles/gala");
    expect(joinPath("C:\\Users\\me\\Spectacles", "gala")).toBe("C:\\Users\\me\\Spectacles\\gala");
  });

  it("does not double a trailing separator", () => {
    expect(joinPath("/data/", "gala")).toBe("/data/gala");
  });
});
