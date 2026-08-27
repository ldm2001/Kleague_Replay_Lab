import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const resolvePackage = (relativePath: string) =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@replay/application": resolvePackage("./apps/web/src/application/index.ts"),
      "@replay/database": resolvePackage("./apps/web/src/database/index.ts"),
      "@replay/adapters": resolvePackage("./apps/web/src/adapters/index.ts"),
      "@replay/shared-types": resolvePackage("./apps/web/src/shared/index.ts"),
      "@replay/rule-data": resolvePackage("./apps/web/src/rules/data/index.ts"),
      "@replay/rule-engine": resolvePackage("./apps/web/src/rules/engine/index.ts"),
    },
  },
  test: {
    include: ["apps/web/test/**/*.test.ts", "apps/web/src/**/*.test.{ts,tsx}"],
  },
});
