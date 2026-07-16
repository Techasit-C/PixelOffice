import { fileURLToPath } from "node:url";
import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

// Pure-logic unit tests only (no DB, no network), Node environment by default; a
// handful of files opt into jsdom per-file via a `@vitest-environment jsdom` pragma
// when they need to render a real component (e.g. tests/backtest-page-client.test.ts).
// `@/*` alias mirrors tsconfig so imports match the app.
//
// The react() plugin is required because tsconfig.json uses `"jsx": "preserve"`
// (Next's own bundler does the JSX transform, not tsc) — Vite's default transformer
// reads that setting and leaves JSX untouched, which fails to parse for any .tsx
// source file this suite imports (a real component, not JSX authored in a test).
// @vitejs/plugin-react transforms JSX itself, independent of tsconfig. This has no
// effect on `next build` or `tsc --noEmit`, which never consult this file.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // tests/integration/** requires a real, isolated Postgres (TEST_DATABASE_URL) and is
    // a separate, mandatory-but-opt-in gate (npm run test:integration), never part of the
    // default suite — unlike tests/live/**, which stays included but self-skips at
    // runtime via describe.skipIf(), integration tests are excluded at the config level
    // so a missing TEST_DATABASE_URL can never silently no-op a real-DB assertion.
    exclude: [...configDefaults.exclude, "tests/integration/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
