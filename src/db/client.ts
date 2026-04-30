import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

type Sql = ReturnType<typeof neon>;
type Db = ReturnType<typeof drizzle<Record<string, never>, Sql>>;

let cachedSql: Sql | undefined;
let cachedDb: Db | undefined;

function initSql(): Sql {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }
  return neon(databaseUrl);
}

export function getSql(): Sql {
  cachedSql ??= initSql();
  return cachedSql;
}

export function getDb(): Db {
  cachedDb ??= drizzle(getSql());
  return cachedDb;
}
