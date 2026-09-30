// @ts-check

import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// Deliberately narrow: only the two hook rules. The player leans on refs and
// stable callbacks (see CLAUDE.md), which is exactly where a missing
// dependency or a conditional hook slips through unnoticed. The plugin's newer
// React Compiler rules would flag the ref-sync pattern itself, so they stay off.
export default defineConfig(
  { ignores: ["dist/**", "src-tauri/**", "node_modules/**"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
