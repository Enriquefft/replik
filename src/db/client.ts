import "server-only"
import { neon } from "@neondatabase/serverless"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/neon-http"
import { users } from "./schema"

type Sql = ReturnType<typeof neon>
type Db = ReturnType<typeof drizzle<Record<string, never>, Sql>>

let cachedSql: Sql | undefined
let cachedDb: Db | undefined

function initSql(): Sql {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set")
  }
  try {
    return neon(databaseUrl)
  } catch (cause) {
    // Scrub URL from error to prevent credential leak in logs/traces.
    throw new Error("DATABASE_URL is set but is not a valid Postgres connection string", { cause })
  }
}

export function getSql(): Sql {
  cachedSql ??= initSql()
  return cachedSql
}

export function getDb(): Db {
  cachedDb ??= drizzle(getSql())
  return cachedDb
}

/**
 * Tenant-scoped DB handle. P1 contract: identical type to Db, but the only
 * way to obtain one is through `withUser`. Future iterations may swap this
 * for a row-level filter wrapper. Lint enforcement of "no `db` import outside
 * `withUser`" is documented in README; manual for now.
 */
export type TenantDB = Db

export class TenantError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TenantError"
  }
}

/**
 * Validates `userId` is a non-empty string and invokes `fn` with a TenantDB.
 * Queries inside MUST filter by `eq(table.userId, userId)`. P1 does not
 * rewrite SQL — the wrapper is a contract surface, not RLS.
 */
export async function withUser<T>(
  userId: string,
  fn: (db: TenantDB) => Promise<T> | T,
): Promise<T> {
  if (typeof userId !== "string" || userId.length === 0) {
    throw new TenantError("withUser: userId must be a non-empty string")
  }
  return await fn(getDb())
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("Unauthenticated")
    this.name = "UnauthenticatedError"
  }
}

/**
 * Requires an authenticated Clerk session and returns the matching internal
 * users row (creating it on first call). Email is fetched from Clerk Backend
 * API to avoid relying on custom session claims.
 */
export async function requireUser(): Promise<{
  clerkUserId: string
  userId: string
  email: string
}> {
  // Dynamic import keeps Clerk + next/navigation out of the static module
  // graph so non-request entrypoints (e.g. bun:test) can import this file.
  const { auth, clerkClient } = await import("@clerk/nextjs/server")
  const session = await auth()
  const clerkUserId = session.userId
  if (!clerkUserId) {
    throw new UnauthenticatedError()
  }
  const dbHandle = getDb()
  const existing = await dbHandle
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1)
  const found = existing[0]
  if (found) {
    return { clerkUserId, userId: found.id, email: found.email }
  }
  const client = await clerkClient()
  const clerkUser = await client.users.getUser(clerkUserId)
  const email =
    clerkUser.primaryEmailAddress?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress
  if (!email) {
    throw new Error("requireUser: Clerk user has no email address")
  }
  const inserted = await dbHandle
    .insert(users)
    .values({ clerkUserId, email })
    .returning({ id: users.id, email: users.email })
  const row = inserted[0]
  if (!row) {
    throw new Error("requireUser: failed to create user row")
  }
  return { clerkUserId, userId: row.id, email: row.email }
}
