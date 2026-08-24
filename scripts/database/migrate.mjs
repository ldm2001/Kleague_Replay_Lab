import postgres from "postgres";
import { loadMigrations } from "./migrations.mjs";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const sql = postgres(databaseUrl, { max: 1 });
const advisoryLockName = "replay_lab_schema_migrations";

try {
  await sql`select pg_advisory_lock(hashtext(${advisoryLockName}))`;

  const [migrationTable] = await sql`
    select to_regclass('public.schema_migrations') as table_name
  `;

  if (migrationTable?.table_name === null) {
    await sql`create table schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`;
  }

  const appliedRows = await sql`select name, checksum from schema_migrations`;
  const appliedChecksums = new Map(appliedRows.map((row) => [row.name, row.checksum]));

  for (const migration of await loadMigrations()) {
    const appliedChecksum = appliedChecksums.get(migration.name);

    if (appliedChecksum) {
      if (appliedChecksum !== migration.checksum) {
        throw new Error(`Migration checksum changed: ${migration.name}`);
      }
      console.log(`Migration already applied: ${migration.name}`);
      continue;
    }

    await sql.begin(async (transaction) => {
      await transaction.unsafe(migration.sql);
      await transaction`
        insert into schema_migrations (name, checksum)
        values (${migration.name}, ${migration.checksum})
      `;
    });
    console.log(`Migration applied: ${migration.name}`);
  }
} finally {
  await sql`select pg_advisory_unlock(hashtext(${advisoryLockName}))`.catch(() => undefined);
  await sql.end({ timeout: 5 });
}
