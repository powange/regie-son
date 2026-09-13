import { defineConfig } from "i18next-cli";

export default defineConfig({
  // La première locale est la langue de référence : c'est en français qu'on
  // écrit les clés, les autres se remplissent ensuite.
  locales: ["fr", "en"],

  extract: {
    input: ["src/**/*.{ts,tsx}"],
    output: "src/i18n/locales/{{language}}/{{namespace}}.json",
    defaultNS: "common",
    functions: ["t"],
    transComponents: ["Trans"],
    sort: true,
    // Les namespaces dont les clés viennent de données (preflight, plus tard
    // errors) sont maintenus à la main : l'extraction statique ne les voit pas
    // toujours, et un nettoyage automatique les effacerait.
    removeUnusedKeys: false,
  },

  types: {
    input: ["src/i18n/locales/fr/**/*.json"],
    output: "src/types/i18next.d.ts",
  },

  lint: {
    checkInterpolationParams: true,
    checkConcatenation: "warn",
  },
});
