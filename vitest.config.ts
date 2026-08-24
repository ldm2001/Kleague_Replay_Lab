import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const resolvePackage = (relativePath: string) =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@replay/application": resolvePackage("./packages/application/src/index.ts"),
      "@replay/database": resolvePackage("./packages/database/src/index.ts"),
      "@replay/adapters": resolvePackage("./packages/adapters/src/index.ts"),
      "@replay/shared-types": resolvePackage("./packages/shared-types/src/index.ts"),
      "@replay/rule-data": resolvePackage("./packages/rule-data/src/index.ts"),
      "@replay/rule-engine": resolvePackage("./packages/rule-engine/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
  },
});
