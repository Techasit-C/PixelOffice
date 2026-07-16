import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Real-Postgres integration tests only. Deliberately standalone (not merged with
// vitest.config.ts) — mergeConfig concatenates array options, which would carry the base
// config's "tests/integration/**" exclude into this config and silently match zero files.
// Requires TEST_DATABASE_URL / TEST_DIRECT_DATABASE_URL (see tests/integration/harness.ts);
// never DATABASE_URL. Run via `npm run test:integration`, never part of the default suite.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
