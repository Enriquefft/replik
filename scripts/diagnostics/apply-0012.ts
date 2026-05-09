import { neon } from "@neondatabase/serverless"

const sql = neon(process.env.DATABASE_URL ?? "")

// Postgres won't let `ADD VALUE` run inside an existing transaction, so we
// guard against duplicate application by checking the enum first.
const existing = await sql`
  SELECT enumlabel FROM pg_enum
  JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
  WHERE pg_type.typname = 'creative_source'
`
const labels = new Set(existing.map((r) => r.enumlabel))
if (labels.has("apify_tiktok")) {
  console.log("already applied: apify_tiktok present in creative_source")
} else {
  await sql`ALTER TYPE "creative_source" ADD VALUE 'apify_tiktok'`
  console.log("applied: apify_tiktok added to creative_source")
}
