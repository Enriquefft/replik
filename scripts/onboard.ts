/**
 * Onboarding CLI — backend smoke runner.
 *
 * Drives the full onboarding chain (create → scrape → select → publish →
 * launch) without the web UI. Bypasses Clerk by reading `ONBOARD_USER_ID`
 * from env and using the same `withUser` + Trigger.dev paths the server
 * actions do. Polls the DB (not the Trigger Public API) for completion
 * because the tasks write status/assets transitions atomically.
 *
 * Usage:
 *   bun run onboard <subcommand> [args...] [--flag=value]
 *
 * Subcommands:
 *   whoami                                 print resolved userId
 *   create <url> --price=<cents>           insert product + fire scrape
 *   wait-scrape <productId>                poll until scrape terminal state
 *   creatives <productId>                  list creatives
 *   select <productId> [--pick=auto|i,j]   select N creatives + fire edits
 *   wait-edits <productId>                 poll until selected creatives have edited_video
 *   publish <productId> --bundle2=<cents> --bundle3=<cents> [--template=1|2|3]
 *   wait-publish <productId>               poll until LANDING_PUBLISHED
 *   launch <productId> --budget=<cents>    fire launchCampaign
 *   wait-launch <productId>                poll until CAMPAIGN_LAUNCHED
 *   status <productId>                     snapshot
 *   all <url> --price=<c> --bundle2=<c> --bundle3=<c> --budget=<c> [--template=N]
 */

import { tasks } from "@trigger.dev/sdk"
import { and, eq, inArray } from "drizzle-orm"
import { withUser } from "@/db/client"
import { assets, campaigns, creatives, products, users } from "@/db/schema"
import { productTag } from "@/lib/trigger-tags.ts"
import { toProductId } from "@/lib/types/ids.ts"
import type { launchCampaign as launchCampaignTask } from "@/server/trigger/launchCampaign"
import type { publishLandingTask } from "@/server/trigger/publishLanding"
import type { scrapeProduct } from "@/server/trigger/scrapeProduct"
import type { translateAndBurnSubsTask } from "@/server/trigger/translateAndBurnSubs"

const POLL_INTERVAL_MS = 5_000
const POLL_TIMEOUT_MS = 45 * 60 * 1000

interface ParsedArgs {
  positional: string[]
  flags: Map<string, string>
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = []
  const flags = new Map<string, string>()
  for (const raw of argv) {
    if (raw.startsWith("--")) {
      const [k, ...rest] = raw.slice(2).split("=")
      if (!k) continue
      flags.set(k, rest.length > 0 ? rest.join("=") : "true")
    } else {
      positional.push(raw)
    }
  }
  return { positional, flags }
}

function requireFlagInt(flags: Map<string, string>, name: string): number {
  const v = flags.get(name)
  if (v === undefined) throw new Error(`--${name} is required`)
  const n = Number.parseInt(v, 10)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} must be a positive integer`)
  return n
}

function optionalFlagInt(flags: Map<string, string>, name: string): number | undefined {
  const v = flags.get(name)
  if (v === undefined) return undefined
  const n = Number.parseInt(v, 10)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} must be a positive integer`)
  return n
}

async function resolveUserId(): Promise<string> {
  const fromEnv = process.env.ONBOARD_USER_ID
  if (fromEnv && fromEnv.length > 0) return fromEnv
  const all = await withUser("00000000-0000-0000-0000-000000000000", async (db) =>
    db.select({ id: users.id, email: users.email }).from(users).limit(2),
  )
  if (all.length === 0) throw new Error("No users in DB. Sign in once via the app first.")
  if (all.length > 1) {
    const list = all.map((u) => `  ${u.id}  ${u.email}`).join("\n")
    throw new Error(
      `Multiple users in DB. Set ONBOARD_USER_ID to one of:\n${list}\n(Showing up to 2.)`,
    )
  }
  const only = all[0]
  if (!only) throw new Error("unreachable")
  return only.id
}

async function cmdWhoami(): Promise<void> {
  const userId = await resolveUserId()
  const row = await withUser(userId, async (db) =>
    db.select().from(users).where(eq(users.id, userId)).limit(1),
  )
  console.log(JSON.stringify(row[0] ?? null, null, 2))
}

async function cmdCreate(args: ParsedArgs): Promise<string> {
  const url = args.positional[0]
  if (!url) throw new Error("usage: create <url> --price=<cents>")
  const priceCents = requireFlagInt(args.flags, "price")
  const userId = await resolveUserId()

  const inserted = await withUser(userId, async (db) =>
    db
      .insert(products)
      .values({
        userId,
        sourceUrl: url,
        pricingCents: priceCents,
        status: "SCRAPING",
      })
      .returning({ id: products.id }),
  )
  const row = inserted[0]
  if (!row) throw new Error("insert returned no rows")
  const productId = toProductId(row.id)

  await tasks.trigger<typeof scrapeProduct>(
    "scrape-product",
    { productId, userId, competitorUrl: url },
    { tags: [productTag(productId)] },
  )

  console.log(`product=${productId}`)
  return productId
}

async function pollProductStatus(
  userId: string,
  productId: string,
  done: (status: string) => boolean,
  label: string,
): Promise<string> {
  const startedAt = Date.now()
  let last = ""
  while (true) {
    const rows = await withUser(userId, async (db) =>
      db
        .select({ status: products.status })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.userId, userId)))
        .limit(1),
    )
    const status = rows[0]?.status
    if (!status) throw new Error(`product ${productId} not found`)
    if (status !== last) {
      console.log(`[${label}] status=${status}`)
      last = status
    }
    if (done(status)) return status
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      throw new Error(`[${label}] timeout after ${POLL_TIMEOUT_MS / 1000}s, last status=${status}`)
    }
    await Bun.sleep(POLL_INTERVAL_MS)
  }
}

async function cmdWaitScrape(args: ParsedArgs): Promise<void> {
  const productId = args.positional[0]
  if (!productId) throw new Error("usage: wait-scrape <productId>")
  const userId = await resolveUserId()
  const final = await pollProductStatus(userId, productId, (s) => s !== "SCRAPING", "wait-scrape")
  if (final === "FAILED") process.exit(1)
}

interface CreativeListRow {
  id: string
  source: string
  angle: string | null
  hasTranscript: boolean
  selected: boolean
  scrapeUrl: string
}

async function listCreatives(userId: string, productId: string): Promise<CreativeListRow[]> {
  return withUser(userId, async (db) => {
    const rows = await db
      .select({
        id: creatives.id,
        source: creatives.source,
        angle: creatives.angle,
        transcriptText: creatives.transcriptText,
        selected: creatives.selectedBool,
        scrapeUrl: creatives.scrapeUrl,
      })
      .from(creatives)
      .where(and(eq(creatives.productId, productId), eq(creatives.userId, userId)))
    return rows.map((r) => ({
      id: r.id,
      source: r.source,
      angle: r.angle,
      hasTranscript: r.transcriptText !== null && r.transcriptText.length > 0,
      selected: r.selected,
      scrapeUrl: r.scrapeUrl,
    }))
  })
}

async function cmdCreatives(args: ParsedArgs): Promise<void> {
  const productId = args.positional[0]
  if (!productId) throw new Error("usage: creatives <productId>")
  const userId = await resolveUserId()
  const rows = await listCreatives(userId, productId)
  console.log(JSON.stringify(rows, null, 2))
  console.log(`count=${rows.length}`)
}

function pickCreatives(rows: CreativeListRow[], pickFlag: string | undefined): string[] {
  if (pickFlag === undefined || pickFlag === "auto") {
    const pool = rows.filter((r) => r.hasTranscript)
    const candidates = pool.length >= 3 ? pool : rows
    return candidates.slice(0, 3).map((r) => r.id)
  }
  const indices = pickFlag.split(",").map((s) => Number.parseInt(s.trim(), 10) - 1)
  const out: string[] = []
  for (const i of indices) {
    if (!Number.isFinite(i) || i < 0 || i >= rows.length) {
      throw new Error(`--pick index out of range: ${(i + 1).toString()}`)
    }
    const r = rows[i]
    if (!r) throw new Error("unreachable")
    out.push(r.id)
  }
  return out
}

async function cmdSelect(args: ParsedArgs): Promise<void> {
  const productId = args.positional[0]
  if (!productId) throw new Error("usage: select <productId> [--pick=auto|i,j,k]")
  const userId = await resolveUserId()
  const rows = await listCreatives(userId, productId)
  if (rows.length === 0) throw new Error("no creatives — run scrape first")
  const ids = pickCreatives(rows, args.flags.get("pick"))
  if (ids.length === 0) throw new Error("nothing to select")

  await tasks.batchTrigger<typeof translateAndBurnSubsTask>(
    "translateAndBurnSubs",
    ids.map((creativeId) => ({ payload: { creativeId, userId } })),
  )
  await withUser(userId, async (db) => {
    await db
      .update(creatives)
      .set({ selectedBool: true })
      .where(
        and(
          eq(creatives.productId, productId),
          eq(creatives.userId, userId),
          inArray(creatives.id, ids),
        ),
      )
  })
  console.log(`selected=${ids.length} ids=${ids.join(",")}`)
}

async function cmdWaitEdits(args: ParsedArgs): Promise<void> {
  const productId = args.positional[0]
  if (!productId) throw new Error("usage: wait-edits <productId>")
  const userId = await resolveUserId()
  const startedAt = Date.now()
  let lastReady = -1
  while (true) {
    const result = await withUser(userId, async (db) => {
      const selected = await db
        .select({ id: creatives.id })
        .from(creatives)
        .where(
          and(
            eq(creatives.productId, productId),
            eq(creatives.userId, userId),
            eq(creatives.selectedBool, true),
          ),
        )
      if (selected.length === 0) return { total: 0, ready: 0 }
      const ids = selected.map((r) => r.id)
      const edited = await db
        .select({ ownerId: assets.ownerId })
        .from(assets)
        .where(
          and(
            eq(assets.ownerType, "creative"),
            eq(assets.kind, "edited_video"),
            inArray(assets.ownerId, ids),
          ),
        )
      return { total: ids.length, ready: edited.length }
    })
    if (result.total === 0) throw new Error("no selected creatives")
    if (result.ready !== lastReady) {
      console.log(`[wait-edits] ready=${result.ready}/${result.total}`)
      lastReady = result.ready
    }
    if (result.ready >= result.total) return
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      throw new Error(`[wait-edits] timeout, ready=${result.ready}/${result.total}`)
    }
    await Bun.sleep(POLL_INTERVAL_MS)
  }
}

async function cmdPublish(args: ParsedArgs): Promise<void> {
  const productId = args.positional[0]
  if (!productId) throw new Error("usage: publish <productId> --bundle2=<c> --bundle3=<c>")
  const bundle2 = requireFlagInt(args.flags, "bundle2")
  const bundle3 = requireFlagInt(args.flags, "bundle3")
  const templateRaw = optionalFlagInt(args.flags, "template")
  const templateId =
    templateRaw === 1 || templateRaw === 2 || templateRaw === 3 ? templateRaw : undefined
  const userId = await resolveUserId()

  const updated = await withUser(userId, async (db) =>
    db
      .update(products)
      .set({ bundle2PricingCents: bundle2, bundle3PricingCents: bundle3 })
      .where(and(eq(products.id, productId), eq(products.userId, userId)))
      .returning({ id: products.id }),
  )
  if (updated.length === 0) throw new Error("product not found")

  const handle = await tasks.trigger<typeof publishLandingTask>("publishLanding", {
    productId,
    userId,
    ...(templateId !== undefined && { templateId }),
  })
  console.log(`run=${handle.id}`)
}

async function cmdWaitPublish(args: ParsedArgs): Promise<void> {
  const productId = args.positional[0]
  if (!productId) throw new Error("usage: wait-publish <productId>")
  const userId = await resolveUserId()
  const final = await pollProductStatus(
    userId,
    productId,
    (s) => s === "LANDING_PUBLISHED" || s === "CAMPAIGN_LAUNCHED" || s === "FAILED",
    "wait-publish",
  )
  if (final === "FAILED") process.exit(1)
  const row = await withUser(userId, async (db) =>
    db
      .select({
        handle: products.shopifyPageHandle,
        templateId: products.shopifyTemplateId,
      })
      .from(products)
      .where(and(eq(products.id, productId), eq(products.userId, userId)))
      .limit(1),
  )
  console.log(`handle=${row[0]?.handle ?? "?"} template=${row[0]?.templateId ?? "?"}`)
}

async function cmdLaunch(args: ParsedArgs): Promise<void> {
  const productId = args.positional[0]
  if (!productId) throw new Error("usage: launch <productId> --budget=<cents>")
  const budget = requireFlagInt(args.flags, "budget")
  const userId = await resolveUserId()
  const handle = await tasks.trigger<typeof launchCampaignTask>("launchCampaign", {
    productId,
    userId,
    attempt: Math.floor(Date.now() / 1000),
    budgetDailyCents: budget,
  })
  console.log(`run=${handle.id}`)
}

async function cmdWaitLaunch(args: ParsedArgs): Promise<void> {
  const productId = args.positional[0]
  if (!productId) throw new Error("usage: wait-launch <productId>")
  const userId = await resolveUserId()
  const final = await pollProductStatus(
    userId,
    productId,
    (s) => s === "CAMPAIGN_LAUNCHED" || s === "FAILED",
    "wait-launch",
  )
  if (final === "FAILED") process.exit(1)
}

async function cmdStatus(args: ParsedArgs): Promise<void> {
  const productId = args.positional[0]
  if (!productId) throw new Error("usage: status <productId>")
  const userId = await resolveUserId()
  const snapshot = await withUser(userId, async (db) => {
    const product = await db
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.userId, userId)))
      .limit(1)
    const creativeRows = await db
      .select()
      .from(creatives)
      .where(and(eq(creatives.productId, productId), eq(creatives.userId, userId)))
    const creativeIds = creativeRows.map((c) => c.id)
    const assetRows =
      creativeIds.length === 0
        ? []
        : await db
            .select()
            .from(assets)
            .where(and(eq(assets.ownerType, "creative"), inArray(assets.ownerId, creativeIds)))
    const campaignRows = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.productId, productId), eq(campaigns.userId, userId)))
    return {
      product: product[0] ?? null,
      creatives: creativeRows.length,
      selectedCreatives: creativeRows.filter((c) => c.selectedBool).length,
      assetsByKind: assetRows.reduce<Record<string, number>>((acc, a) => {
        acc[a.kind] = (acc[a.kind] ?? 0) + 1
        return acc
      }, {}),
      campaigns: campaignRows.map((c) => ({ id: c.id, status: c.status })),
    }
  })
  console.log(JSON.stringify(snapshot, null, 2))
}

async function cmdAll(args: ParsedArgs): Promise<void> {
  const url = args.positional[0]
  if (!url) throw new Error("usage: all <url> --price --bundle2 --bundle3 --budget [--template]")
  const productId = await cmdCreate({ positional: [url], flags: args.flags })
  await cmdWaitScrape({ positional: [productId], flags: new Map() })
  await cmdSelect({ positional: [productId], flags: new Map([["pick", "auto"]]) })
  await cmdWaitEdits({ positional: [productId], flags: new Map() })
  await cmdPublish({ positional: [productId], flags: args.flags })
  await cmdWaitPublish({ positional: [productId], flags: new Map() })
  await cmdLaunch({ positional: [productId], flags: args.flags })
  await cmdWaitLaunch({ positional: [productId], flags: new Map() })
  await cmdStatus({ positional: [productId], flags: new Map() })
}

const COMMANDS: Record<string, (a: ParsedArgs) => Promise<unknown>> = {
  whoami: cmdWhoami,
  create: cmdCreate,
  "wait-scrape": cmdWaitScrape,
  creatives: cmdCreatives,
  select: cmdSelect,
  "wait-edits": cmdWaitEdits,
  publish: cmdPublish,
  "wait-publish": cmdWaitPublish,
  launch: cmdLaunch,
  "wait-launch": cmdWaitLaunch,
  status: cmdStatus,
  all: cmdAll,
}

async function main(): Promise<void> {
  const [, , sub, ...rest] = process.argv
  if (!sub || sub === "--help" || sub === "-h") {
    console.log("subcommands:", Object.keys(COMMANDS).join(", "))
    process.exit(sub ? 0 : 1)
  }
  const handler = COMMANDS[sub]
  if (!handler) {
    console.error(`unknown subcommand: ${sub}`)
    console.error("available:", Object.keys(COMMANDS).join(", "))
    process.exit(1)
  }
  await handler(parseArgs(rest))
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`ERROR: ${msg}`)
  if (err instanceof Error && err.stack) console.error(err.stack)
  process.exit(1)
})
