import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const resolvePackage = (relativePath: string) =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@replay/application": resolvePackage("./web/src/application/index.ts"),
      "@replay/database": resolvePackage("./web/src/database/index.ts"),
      "@replay/adapters": resolvePackage("./web/src/adapters/index.ts"),
      "@replay/shared-types": resolvePackage("./web/src/shared/index.ts"),
      "@replay/rule-data": resolvePackage("./web/src/rules/data/index.ts"),
      "@replay/rule-engine": resolvePackage("./web/src/rules/engine/index.ts"),
    },
  },
  test: {
    include: ["web/test/**/*.test.ts", "web/src/**/*.test.{ts,tsx}"],
  },
});
