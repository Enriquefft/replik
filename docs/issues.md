# Open Issues

Captured 2026-05-03 after B1 rehost-defer rollout (`95930ae`, `853b92b`).
Severity: 🔴 blocker · 🟡 risk · 🟢 cleanup.

---

## 🔴 EXT-1 — Meta Ad Library token invalid

**Symptom**
`adLibrarySearch` throws `MetaError`:
```
Invalid OAuth access token - Cannot parse access token
```
`scrapeProduct.findAds` falls through to Apify, returns
`source: "apify_fb"` if Apify succeeds (now capped at $0.15/run via Fix 1
below) or `source: "none"` if both fail. Until rotated, every scrape
pays Apify.

**Reproduction**
```sh
bun --preload ./scripts/_preload.ts scripts/diagnostics/probe-apis.ts
# === Meta Ad Library ===
# meta error: Invalid OAuth access token - Cannot parse access token
```

**Resolution**
1. Meta Business Suite → System User → generate fresh long-lived token
   (NOT the user marketing token; this is the server-side ad-library
   token, see `src/lib/meta/adLibrary.ts:7`).
2. Update `META_AD_LIBRARY_TOKEN` in `.env` AND Trigger.dev project env
   (`bunx trigger.dev@latest env set` or dashboard).
3. Confirm with `probe-apis.ts` returning a non-zero count.

**Affected paths**
- `src/lib/meta/adLibrary.ts:69`

---

## ✅ EXT-2 — Apify token: RESOLVED

The new `APIFY_TOKEN` at `.env:20` works (verified via probe). The
"Maximum charged results must be greater than zero" error was a
billing-side issue resolved by topping up credits.

---

## 💸 COST-1 … COST-5 — Apify burn-rate audit

**Window:** 10 hours of manual testing on 2026-05-02 burned **$4.99** of
Apify credit across 13 runs of `apify/facebook-ads-scraper`
(representative run `jcAuvR9376Lghi2Ka`: 82 ads charged at
$0.4756/run, `chargedEventCounts.apify-default-dataset-item: 82`).

Five amplifiers behind that burn — all addressed in this sweep:

- **COST-1: 5 startUrls × resultsLimit:20** — wrapper sent five Ad
  Library URLs per call and accepted up to 20 ads per URL, paying for
  60–80% of items it then dropped via dedup. Fixed by
  `src/lib/apify/index.ts` taking only `keywords[0]` and a single
  startUrl.
- **COST-2: no SDK guardrail** — `actor.call()` had no `maxItems` and
  no `maxTotalChargeUsd`. Fixed: both passed in call options
  (`maxItems: 20`, `maxTotalChargeUsd: 0.15`). The SDK exposes the
  charge cap to the actor process via `ACTOR_MAX_TOTAL_CHARGE_USD`.
- **COST-3: client-side over-fetch** — wrapper read `RESULT_CAP * 2`
  items from the dataset post-run. Cap was already paid, but the
  read-amplification masked the real per-item cost. Fixed: `limit:
  RESULT_CAP`.
- **COST-4: retry bypassed idempotency** — `retryScrape` set
  `attempt: Math.floor(Date.now() / 1000)`, making each retry a new
  idempotency key → full re-scrape every time. Fixed: 60 s cooldown
  gate in `src/server/actions/products.ts:retryScrape` (URL-change
  bypass intact for legitimate re-scrapes).
- **COST-5: keyword tier ordering** — caller passed
  `[...broad, ...narrow]`, so the first keyword (now the only one) was
  the broadest possible term, maximising irrelevant ads. Fixed:
  `scrapeProduct/index.ts:340` flipped to `[...narrow, ...broad]`.

**Expected per-run cost post-fix:** 20 ads × $0.0058 ≈ $0.116 worst
case, hard-capped at $0.15 by the SDK. ~4× reduction vs the
$0.4756/run historical average.

**Affected paths**
- `src/lib/apify/index.ts`
- `src/server/trigger/scrapeProduct/index.ts:340`
- `src/server/actions/products.ts:retryScrape`

---

## ✅ INT-1 — `translateAndBurnSubs` re-transcribe: RESOLVED

Scrape pass now runs `transcribe({ mode: "srt" })` and persists the
SRT as an `assets` row (`kind: "srt"`, `ownerType: "creative"`).
`translateAndBurnSubs` reads that asset by `creativeId` instead of
re-running Whisper, then upserts the final (possibly translated) SRT
back to the same `(ownerType, ownerId, kind)` slot so downstream
readers see the SRT actually burned into the video.

Cost-neutral: `whisper-1` and `gpt-4o-transcribe` are priced the same
per minute; we trade the second per-burn Whisper call for one extra
UploadThing put per scrape pass.

**Affected paths**
- `src/server/trigger/scrapeProduct/index.ts:transcribeOne`
- `src/server/trigger/translateAndBurnSubs/index.ts` (steps 3–6)

---

## ✅ INT-2 — `selectCreatives` ordering: RESOLVED

Reordered `src/server/actions/products.ts:selectCreatives` and
`scripts/onboard.ts:cmdSelect` to flip `selectedBool` first, then
trigger `rehostCreatives`. A trigger-side failure now leaves rows
recoverable (re-clicking Select short-circuits via the
`alreadyHosted` check at `rehostCreatives/index.ts`). The reverse
failure (rehost-without-select) is harder to recover and no longer
reachable.

---

## ✅ INT-3 — `rehostCreatives` JOIN: RESOLVED

`src/server/trigger/rehostCreatives/index.ts` now does one tenant-
scoped LEFT JOIN of `creatives` against `assets` (filtered to
`original_video`). The `assetOwnerId !== null` predicate replaces the
second SELECT.

---

## ✅ CLEAN-1 — Debug scripts: RESOLVED

Promoted to `scripts/diagnostics/`:
- `list-runs.ts`
- `run-detail.ts`
- `probe-apis.ts`
- `retry-scrape.ts`

Dropped:
- `check-asset-dups.ts`
- `check-run.ts`
- `check-status.ts`
- `find-testable-product.ts`
- `probe-trigger.ts`

`bun run lint` clean across the kept set.

---

## Verified (no follow-up needed)

- B1 rehost path — both idempotent (3 alreadyHosted, 1.7s) and fresh
  upload (3 rehosted, 9.1s) verified e2e against dev DB.
- `assetsByKind.original_video` 0→3 transition on `select`.
- Schema unique index `assets_owner_kind_uniq` applied (migration
  `0006_organic_jazinda.sql`).
- `bun test` 281/281, lint clean for tracked files, `tsc --noEmit` clean.
