import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Vitest needs the same `@/*` -> `src/*` alias `tsconfig.json` gives the compiler
 * and Next gives the bundler. Without it a test can only import modules whose own
 * imports are all `import type` (erased before resolution), which is an invisible
 * limit on what is testable rather than a deliberate one.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
