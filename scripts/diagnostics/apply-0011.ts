import { neon } from "@neondatabase/serverless"

const sql = neon(process.env.DATABASE_URL ?? "")
await sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "canonical_brand" text`
const cols =
  await sql`SELECT column_name FROM information_schema.columns WHERE table_name='products' AND column_name='canonical_brand'`
console.log("canonical_brand col present:", cols.length > 0)
