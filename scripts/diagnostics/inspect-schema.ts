import { neon } from "@neondatabase/serverless"

const sql = neon(process.env.DATABASE_URL ?? "")
const cols = await sql`SELECT column_name, data_type, udt_name, is_nullable
                       FROM information_schema.columns
                       WHERE table_name='creatives'
                       ORDER BY ordinal_position`
console.log("creatives columns:")
for (const c of cols) {
  console.log(`  ${c.column_name}: ${c.udt_name} (nullable=${c.is_nullable})`)
}
const e = await sql`SELECT enum_range(NULL::creative_source) AS vals`
console.log("creative_source enum:", e[0]?.vals)
const journal =
  await sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`
console.log("\napplied migrations:")
for (const m of journal) console.log(`  ${m.hash} at ${m.created_at}`)
