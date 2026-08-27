import { createHash as digest } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const migrationDirectoryUrl = new URL("../../apps/web/src/database/migrations/", import.meta.url);

export const migrations = async () => {
  const entries = await readdir(fileURLToPath(migrationDirectoryUrl), { withFileTypes: true });
  const migrationNames = entries
    .filter((entry) => entry.isFile() && /^\d{4}_.+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    migrationNames.map(async (fileName) => {
      const sql = await readFile(new URL(fileName, migrationDirectoryUrl), "utf8");
      return {
        name: fileName.replace(/\.sql$/, ""),
        sql,
        checksum: digest("sha256").update(sql).digest("hex"),
      };
    }),
  );
};
