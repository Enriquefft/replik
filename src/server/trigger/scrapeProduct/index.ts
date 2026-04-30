import "server-only";

/**
 * Lane L3a — Scrape pipeline orchestrator (Trigger.dev v4).
 *
 * Four-step pipeline:
 *   1. extractKeywords — LLM agent reads the competitor URL and returns
 *      `{ businessInfo, keywords, category }`. We backfill product fields.
 *   2. findAds — try `meta.adLibrarySearch`, fall back to Apify on
 *      empty/error. If both empty → `products.status='SCRAPE_EMPTY'`.
 *   3. transcribeAds — for each creative, download video, push original to
 *      UploadThing, transcribe with Whisper (skip if > 25 MB), strip Amara
 *      hallucinations, persist transcript + language.
 *   4. classifyAngles — single LLM call labels every transcripted creative
 *      with a 1-3-word Spanish sales angle.
 *
 * Idempotency: a row in `idempotency_keys` keyed by
 * `scrape_${productId}_${attempt}` short-circuits a duplicate run with the
 * last-known summary.
 */

import OpenAI from "openai";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { Output, generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { logger, task } from "@trigger.dev/sdk";
import { UTApi } from "uploadthing/server";

import { withUser } from "@/db/client";
import {
  assets,
  creatives,
  idempotencyKeys,
  products,
} from "@/db/schema";
import { extractKeywords } from "@/lib/agent/scrape";
import * as meta from "@/lib/meta";
import * as apify from "@/lib/apify";

const TASK_ID = "scrape-product";
const MAX_ADS = 20;
const WHISPER_MAX_BYTES = 25 * 1024 * 1024;
const TRANSCRIBE_CONCURRENCY = 3;
const CLASSIFY_MODEL = "claude-sonnet-4-5";
const IDEMPOTENCY_TTL_DAYS = 7;

interface ScrapeSummary {
  creativeCount: number;
  withTranscript: number;
  withAngle: number;
  source: "meta_ad_library" | "apify_fb" | "none";
}

const AnglesSchema = z.object({
  angles: z
    .array(
      z.object({
        id: z.string(),
        angle: z.string().min(1).max(40),
      }),
    )
    .min(0),
});

let cachedOpenAI: OpenAI | undefined;
let cachedUTApi: UTApi | undefined;

function getOpenAI(): OpenAI {
  cachedOpenAI ??= new OpenAI();
  return cachedOpenAI;
}

function getUTApi(): UTApi {
  cachedUTApi ??= new UTApi();
  return cachedUTApi;
}

function deriveProductName(businessInfo: string): string {
  const firstSentence = businessInfo.split(/[.!?\n]/)[0] ?? businessInfo;
  return firstSentence.trim().slice(0, 80);
}

function cleanTranscript(text: string): string {
  const amaraPattern = /amara/i;
  const seen: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (amaraPattern.test(trimmed)) continue;
    if (seen[seen.length - 1] === trimmed) continue;
    seen.push(trimmed);
  }
  return seen.join("\n").trim();
}

interface FoundAd {
  source: "meta_ad_library" | "apify_fb";
  ad_id: string;
  scrape_url: string;
}

async function findAds(
  keywords: string[],
): Promise<{ ads: FoundAd[]; source: "meta_ad_library" | "apify_fb" | "none" }> {
  const searchTerms = keywords.join(" ");
  // Try Meta Ad Library first.
  try {
    const metaAds = await meta.adLibrarySearch({
      searchTerms,
      countries: ["PE"],
      limit: MAX_ADS,
    });
    if (metaAds.length > 0) {
      const mapped: FoundAd[] = [];
      for (const ad of metaAds) {
        const url = ad.video_url ?? ad.ad_snapshot_url;
        if (!url) continue;
        mapped.push({
          source: "meta_ad_library",
          ad_id: ad.ad_id,
          scrape_url: url,
        });
        if (mapped.length >= MAX_ADS) break;
      }
      if (mapped.length > 0) return { ads: mapped, source: "meta_ad_library" };
    }
  } catch (err) {
    logger.warn("meta_ad_library_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Fallback to Apify.
  try {
    const apifyAds = await apify.searchFBAdsByKeywords(keywords);
    if (apifyAds.length > 0) {
      const mapped: FoundAd[] = [];
      for (const ad of apifyAds) {
        if (!ad.video_url) continue;
        mapped.push({
          source: "apify_fb",
          ad_id: ad.ad_id,
          scrape_url: ad.video_url,
        });
        if (mapped.length >= MAX_ADS) break;
      }
      if (mapped.length > 0) return { ads: mapped, source: "apify_fb" };
    }
  } catch (err) {
    logger.warn("apify_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { ads: [], source: "none" };
}

interface CreativeRow {
  id: string;
  scrapeUrl: string;
}

async function transcribeOne(
  creative: CreativeRow,
  userId: string,
): Promise<{ transcribed: boolean; reason?: string }> {
  let response: Response;
  try {
    response = await fetch(creative.scrapeUrl, {
      redirect: "follow",
      cache: "no-store",
    });
  } catch (err) {
    logger.warn("creative_fetch_failed", {
      creativeId: creative.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { transcribed: false, reason: "fetch_failed" };
  }

  if (!response.ok) {
    logger.warn("creative_fetch_non_ok", {
      creativeId: creative.id,
      status: response.status,
    });
    return { transcribed: false, reason: `http_${response.status.toString()}` };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const mime = response.headers.get("content-type") ?? "video/mp4";
  const sizeBytes = buffer.byteLength;

  // 1. Upload original to UploadThing.
  let uploadedUrl: string | undefined;
  try {
    const file = new File([new Uint8Array(buffer)], `${creative.id}.mp4`, {
      type: mime,
    });
    const result = await getUTApi().uploadFiles(file);
    if (result.data) {
      uploadedUrl = result.data.ufsUrl;
    } else {
      logger.warn("uploadthing_failed", {
        creativeId: creative.id,
        error: result.error.message,
      });
    }
  } catch (err) {
    logger.warn("uploadthing_threw", {
      creativeId: creative.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (uploadedUrl) {
    try {
      await withUser(userId, async (db) => {
        await db.insert(assets).values({
          ownerType: "creative",
          ownerId: creative.id,
          kind: "original_video",
          url: uploadedUrl,
          bytes: sizeBytes,
          mime,
        });
      });
    } catch (err) {
      logger.warn("asset_insert_failed", {
        creativeId: creative.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2. Skip Whisper if file too big — Whisper API caps at 25 MB.
  if (sizeBytes > WHISPER_MAX_BYTES) {
    logger.info("transcribe_skip_oversize", {
      creativeId: creative.id,
      sizeBytes,
    });
    return { transcribed: false, reason: "oversize" };
  }

  // 3. Transcribe via Whisper.
  let transcriptText: string | undefined;
  let language: string | undefined;
  try {
    const audioFile = new File([new Uint8Array(buffer)], `${creative.id}.mp4`, {
      type: mime,
    });
    const verbose = await getOpenAI().audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    });
    transcriptText = cleanTranscript(verbose.text);
    language = verbose.language;
  } catch (err) {
    logger.warn("whisper_failed", {
      creativeId: creative.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { transcribed: false, reason: "whisper_failed" };
  }

  if (!transcriptText) {
    return { transcribed: false, reason: "empty_transcript" };
  }

  try {
    await withUser(userId, async (db) => {
      await db
        .update(creatives)
        .set({ transcriptText, language })
        .where(
          and(eq(creatives.id, creative.id), eq(creatives.userId, userId)),
        );
    });
  } catch (err) {
    logger.warn("transcript_persist_failed", {
      creativeId: creative.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { transcribed: false, reason: "persist_failed" };
  }

  return { transcribed: true };
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array<PromiseSettledResult<R>>(
    items.length,
  );
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (;;) {
        const idx = cursor++;
        if (idx >= items.length) return;
        const item = items[idx];
        if (item === undefined) return;
        try {
          const value = await worker(item, idx);
          out[idx] = { status: "fulfilled", value };
        } catch (reason) {
          out[idx] = { status: "rejected", reason };
        }
      }
    },
  );
  await Promise.all(runners);
  return out;
}

async function classifyAngles(
  rows: { id: string; transcriptText: string | null }[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const withText = rows.filter(
    (r): r is { id: string; transcriptText: string } =>
      typeof r.transcriptText === "string" && r.transcriptText.length > 0,
  );
  for (const r of rows) {
    if (!withText.find((w) => w.id === r.id)) {
      result.set(r.id, "sin clasificar");
    }
  }
  if (withText.length === 0) return result;

  try {
    const { output } = await generateText({
      model: anthropic(CLASSIFY_MODEL),
      output: Output.object({ schema: AnglesSchema }),
      system: [
        "Clasifica cada video por su 'ángulo de venta' (sales angle) — etiqueta libre 1-3 palabras en español.",
        "Ejemplos: 'precio bajo', 'demostración', 'testimonio', 'antes/después', 'urgencia'.",
        "Devuelve EXACTAMENTE un objeto por cada id de entrada.",
      ].join(" "),
      prompt: JSON.stringify(
        withText.map((c) => ({ id: c.id, transcript: c.transcriptText })),
      ),
    });
    for (const a of output.angles) {
      result.set(a.id, a.angle.trim().slice(0, 40));
    }
  } catch (err) {
    logger.warn("classify_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    for (const w of withText) {
      if (!result.has(w.id)) result.set(w.id, "sin clasificar");
    }
  }

  // Anything we expected but the model omitted defaults to 'sin clasificar'.
  for (const w of withText) {
    if (!result.has(w.id)) result.set(w.id, "sin clasificar");
  }

  return result;
}

interface ScrapePayload {
  productId: string;
  userId: string;
  competitorUrl: string;
  attempt?: number;
}

export const scrapeProduct = task({
  id: TASK_ID,
  maxDuration: 600,
  machine: { preset: "medium-1x" },
  run: async (payload: ScrapePayload): Promise<ScrapeSummary> => {
    const { productId, userId, competitorUrl } = payload;
    const attempt = payload.attempt ?? 1;
    const idempotencyKey = `scrape_${productId}_${attempt.toString()}`;

    // ---------- Idempotency ----------
    const existing = await withUser(userId, async (db) => {
      return await db
        .select({ key: idempotencyKeys.key })
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, idempotencyKey))
        .limit(1);
    });
    if (existing.length > 0) {
      logger.info("idempotency_short_circuit", { idempotencyKey });
      const summary = await withUser(userId, async (db) => {
        return await db
          .select({
            id: creatives.id,
            transcriptText: creatives.transcriptText,
            angle: creatives.angle,
          })
          .from(creatives)
          .where(
            and(
              eq(creatives.productId, productId),
              eq(creatives.userId, userId),
            ),
          );
      });
      return {
        creativeCount: summary.length,
        withTranscript: summary.filter(
          (s) => typeof s.transcriptText === "string",
        ).length,
        withAngle: summary.filter((s) => typeof s.angle === "string").length,
        source: "none",
      };
    }

    try {
      await withUser(userId, async (db) => {
        await db.insert(idempotencyKeys).values({
          key: idempotencyKey,
          userId,
          expiresAt: new Date(
            Date.now() + IDEMPOTENCY_TTL_DAYS * 24 * 60 * 60 * 1000,
          ),
        });
      });
    } catch (err) {
      // Unique violation → another runner won; replay summary.
      logger.info("idempotency_race", {
        idempotencyKey,
        error: err instanceof Error ? err.message : String(err),
      });
      const summary = await withUser(userId, async (db) => {
        return await db
          .select({
            id: creatives.id,
            transcriptText: creatives.transcriptText,
            angle: creatives.angle,
          })
          .from(creatives)
          .where(
            and(
              eq(creatives.productId, productId),
              eq(creatives.userId, userId),
            ),
          );
      });
      return {
        creativeCount: summary.length,
        withTranscript: summary.filter(
          (s) => typeof s.transcriptText === "string",
        ).length,
        withAngle: summary.filter((s) => typeof s.angle === "string").length,
        source: "none",
      };
    }

    // ---------- Step 1 — extractKeywords ----------
    logger.info("extract_started", { productId, competitorUrl });
    let keywordsResult: Awaited<ReturnType<typeof extractKeywords>>;
    try {
      keywordsResult = await extractKeywords(competitorUrl);
    } catch (err) {
      logger.error("extract_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      await withUser(userId, async (db) => {
        await db
          .update(products)
          .set({ status: "FAILED" })
          .where(
            and(eq(products.id, productId), eq(products.userId, userId)),
          );
      });
      throw err instanceof Error
        ? err
        : new Error("extractKeywords failed");
    }
    logger.info("extract_done", { keywords: keywordsResult.keywords });

    // Best-effort backfill of product metadata.
    try {
      await withUser(userId, async (db) => {
        const [row] = await db
          .select({
            name: products.name,
            category: products.category,
          })
          .from(products)
          .where(
            and(eq(products.id, productId), eq(products.userId, userId)),
          )
          .limit(1);
        const updates: Partial<typeof products.$inferInsert> = {};
        if (!row?.name) updates.name = deriveProductName(keywordsResult.businessInfo);
        if (!row?.category) updates.category = keywordsResult.category;
        if (Object.keys(updates).length > 0) {
          await db
            .update(products)
            .set(updates)
            .where(
              and(eq(products.id, productId), eq(products.userId, userId)),
            );
        }
      });
    } catch (err) {
      logger.warn("product_backfill_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // ---------- Step 2 — findAds ----------
    logger.info("find_ads_started", { keywords: keywordsResult.keywords });
    const { ads, source } = await findAds(keywordsResult.keywords);
    logger.info("find_ads_done", { count: ads.length, source });

    if (ads.length === 0) {
      await withUser(userId, async (db) => {
        await db
          .update(products)
          .set({ status: "SCRAPE_EMPTY" })
          .where(
            and(eq(products.id, productId), eq(products.userId, userId)),
          );
      });
      return {
        creativeCount: 0,
        withTranscript: 0,
        withAngle: 0,
        source,
      };
    }

    // Insert creative rows.
    const insertedCreatives = await withUser(userId, async (db) => {
      const rows = ads.map((ad) => ({
        productId,
        userId,
        source: ad.source,
        scrapeUrl: ad.scrape_url,
        selectedBool: false,
      }));
      return await db
        .insert(creatives)
        .values(rows)
        .returning({ id: creatives.id, scrapeUrl: creatives.scrapeUrl });
    });

    // ---------- Step 3 — transcribeAds ----------
    logger.info("transcribe_started", { count: insertedCreatives.length });
    const transcriptionResults = await runWithConcurrency(
      insertedCreatives,
      TRANSCRIBE_CONCURRENCY,
      async (creative) => {
        const res = await transcribeOne(creative, userId);
        logger.info("transcribe_progress", {
          creativeId: creative.id,
          transcribed: res.transcribed,
          reason: res.reason,
        });
        return res;
      },
    );
    const withTranscript = transcriptionResults.filter(
      (r): r is PromiseFulfilledResult<{ transcribed: boolean }> =>
        r.status === "fulfilled" && r.value.transcribed,
    ).length;

    // ---------- Step 4 — classifyAngles ----------
    logger.info("classify_started", { count: insertedCreatives.length });
    const rows = await withUser(userId, async (db) => {
      return await db
        .select({
          id: creatives.id,
          transcriptText: creatives.transcriptText,
        })
        .from(creatives)
        .where(
          and(
            eq(creatives.productId, productId),
            eq(creatives.userId, userId),
          ),
        );
    });

    const angleMap = await classifyAngles(rows);
    logger.info("classify_done", { count: angleMap.size });

    await withUser(userId, async (db) => {
      await Promise.all(
        Array.from(angleMap.entries()).map(([id, angle]) =>
          db
            .update(creatives)
            .set({ angle })
            .where(and(eq(creatives.id, id), eq(creatives.userId, userId))),
        ),
      );
    });

    const withAngle = Array.from(angleMap.values()).filter(
      (a) => a !== "sin clasificar",
    ).length;

    // Final status flip.
    await withUser(userId, async (db) => {
      await db
        .update(products)
        .set({ status: "READY" })
        .where(and(eq(products.id, productId), eq(products.userId, userId)));
    });

    return {
      creativeCount: insertedCreatives.length,
      withTranscript,
      withAngle,
      source,
    };
  },
});
