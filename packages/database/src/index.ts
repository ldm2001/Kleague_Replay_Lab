import * as schema from "./schema/tables.js";

export { client, createDatabaseClient } from "./client/index.js";
export type { DatabaseClient } from "./client/index.js";
export * from "./schema/enums.js";
export * from "./schema/tables.js";
export { schema };
