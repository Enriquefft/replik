import "server-only"

/**
 * Owner: Lane L4a (Meta wrapper).
 *
 * Manual smoke harness. NOT a unit test, NOT auto-run by CI. Demonstrates
 * the call shape for `adLibrarySearch` against the live Ad Library API.
 *
 * run with `bun run src/lib/meta/__smoke__.ts` when META_AD_LIBRARY_TOKEN is set
 *
 * If the env is not configured we exit 0 with a friendly message — the
 * script must never throw at import time so it's safe to land in the repo
 * even when the token isn't available locally.
 */

import { adLibrarySearch } from "./adLibrary"

async function main(): Promise<void> {
  const token = process.env.META_AD_LIBRARY_TOKEN
  if (!token) {
    console.log("[meta:smoke] META_AD_LIBRARY_TOKEN no está configurado — skipping.")
    return
  }

  const ads = await adLibrarySearch({
    searchTerms: "termo electrico",
    countries: ["PE"],
    limit: 5,
  })

  console.log(`[meta:smoke] adLibrarySearch returned ${String(ads.length)} video ads`)
  for (const ad of ads) {
    console.log(
      `  - ${ad.ad_id} page=${ad.page_name ?? "?"} video_url=${ad.video_url ? "yes" : "no"}`,
    )
  }
}

main().catch((err: unknown) => {
  console.error("[meta:smoke] failed:", err)
  process.exit(1)
})
