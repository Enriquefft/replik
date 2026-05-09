import * as apify from "@/lib/apify"

const keywords = ["flores", "ramos"]

console.log("=== Apify FB ===")
for (const keyword of keywords) {
  try {
    const r = await apify.searchFBAdsByKeyword(keyword)
    console.log(`apify "${keyword}" → ${r.length.toString()} ads`)
    if (r.length > 0) console.log(JSON.stringify(r[0], null, 2))
  } catch (err) {
    console.log("apify error:", err instanceof Error ? err.message : String(err))
  }
}
