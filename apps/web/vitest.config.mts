import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
  resolve: {
    // Mirrors tsconfig.json's `"@/*": ["./*"]` — vitest doesn't read tsconfig
    // path mappings on its own, so without this any test importing through
    // `@/...` (as actions.ts and most of the app does) would fail to resolve.
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
