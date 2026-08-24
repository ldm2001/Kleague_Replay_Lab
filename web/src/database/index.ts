import * as schema from "./schema/tables";

export { client, createDatabaseClient } from "./client/index";
export type { DatabaseClient } from "./client/index";
export * from "./schema/enums";
export * from "./schema/tables";
export { schema };
