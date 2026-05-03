import * as apify from "@/lib/apify"
import * as meta from "@/lib/meta"

const keywords = ["flores", "ramos"]

console.log("=== Meta Ad Library ===")
for (const keyword of keywords) {
  try {
    const r = await meta.adLibrarySearch({
      searchTerms: keyword,
      countries: ["PE"],
      limit: 20,
    })
    console.log(`meta "${keyword}" → ${r.length.toString()} ads`)
    if (r.length > 0) console.log(JSON.stringify(r[0], null, 2))
  } catch (err) {
    console.log("meta error:", err instanceof Error ? err.message : String(err))
  }
}

console.log("\n=== Apify FB ===")
try {
  const r = await apify.searchFBAdsByKeyword(keywords[0] ?? "")
  console.log(`apify "${keywords[0] ?? ""}" → ${r.length.toString()} ads`)
  if (r.length > 0) console.log(JSON.stringify(r[0], null, 2))
} catch (err) {
  console.log("apify error:", err instanceof Error ? err.message : String(err))
}
