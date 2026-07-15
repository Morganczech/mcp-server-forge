import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@mcp-server-forge/schemas": fileURLToPath(
        new URL("./packages/schemas/src/index.ts", import.meta.url),
      ),
      "@mcp-server-forge/validators": fileURLToPath(
        new URL("./packages/validators/src/index.ts", import.meta.url),
      ),
      "@mcp-server-forge/importers": fileURLToPath(
        new URL("./packages/importers/src/index.ts", import.meta.url),
      ),
      "@mcp-server-forge/templates": fileURLToPath(
        new URL("./packages/templates/src/index.ts", import.meta.url),
      ),
      "@mcp-server-forge/generators": fileURLToPath(
        new URL("./packages/generators/src/index.ts", import.meta.url),
      ),
      "@mcp-server-forge/core": fileURLToPath(
        new URL("./packages/core/src/index.ts", import.meta.url),
      ),
      "@mcp-server-forge/fs-adapter": fileURLToPath(
        new URL("./packages/fs-adapter/src/index.ts", import.meta.url),
      ),
      "@mcp-server-forge/engine": fileURLToPath(
        new URL("./packages/engine/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    coverage: {
      reporter: ["text", "html"],
    },
    include: ["{apps,packages}/**/*.test.ts"],
  },
});
