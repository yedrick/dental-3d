import { defineConfig } from "vitest/config";

// Solo pruebas unitarias (sin base de datos ni red). Las de test/api, test/e2e, etc. van aparte.
export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    setupFiles: ["test/unit/setup.ts"],
    environment: "node",
  },
});
