import { neon } from "@neondatabase/serverless"

const productId = process.argv[2]
if (!productId) {
  console.error("usage: inspect-creatives <productId>")
  process.exit(1)
}
const sql = neon(process.env.DATABASE_URL ?? "")
const product =
  await sql`SELECT id, name, brand, brand_tokens, category, status, scrape_reason, keywords FROM products WHERE id = ${productId} LIMIT 1`
console.log("PRODUCT:")
console.log(JSON.stringify(product[0] ?? null, null, 2))
const rows = await sql`
  SELECT id, source, advertiser_name, angle,
         left(coalesce(transcript_text,''), 60) as transcript_preview,
         length(coalesce(transcript_text,'')) as transcript_len,
         scrape_url
  FROM creatives
  WHERE product_id = ${productId}
  ORDER BY scraped_at`
console.log(`\nCREATIVES (${rows.length}):`)
for (const r of rows) {
  console.log(
    `  ${r.id.slice(0, 8)}  src=${r.source}  advertiser=${r.advertiser_name ?? "<null>"}  angle=${r.angle ?? "<null>"}  txt_len=${r.transcript_len}`,
  )
}
const advertiserCount = new Map<string, number>()
for (const r of rows) {
  const k = r.advertiser_name ?? "<null>"
  advertiserCount.set(k, (advertiserCount.get(k) ?? 0) + 1)
}
console.log(`\nADVERTISERS (${advertiserCount.size} distinct):`)
for (const [k, v] of [...advertiserCount.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v}`)
}
