import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const sql = postgres(databaseUrl, { max: 1 });

try {
  await sql`create extension if not exists pg_stat_statements`;
  console.log("pg_stat_statements enabled");
} finally {
  await sql.end({ timeout: 5 });
}
