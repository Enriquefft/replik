import "server-only";

/**
 * Lane L3a — Scrape pipeline · keyword extraction agent.
 *
 * Two-step LLM flow over the Vercel AI SDK + Anthropic:
 *
 *   1. `generateText` with a single `fetchUrl(url)` tool — Claude is asked to
 *      explore the competitor URL (and at most a couple of internal links)
 *      and return a free-form summary of what the business sells.
 *   2. `generateObject` coerces the summary into the canonical
 *      `{ businessInfo, keywords, category }` shape that downstream Apify /
 *      Meta Ad Library searches consume.
 *
 * The tool returns whitespace-collapsed HTML stripped of `<script>`,
 * `<style>`, and `<svg>` blocks, capped at 8 KB. That is enough for Claude
 * to reason about a landing page without burning context on minified JS.
 */
import { anthropic } from "@ai-sdk/anthropic";
import { Output, generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

const MODEL_ID = "claude-sonnet-4-5";
const FETCH_HTML_BYTES = 8 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_TOOL_STEPS = 6;

const KeywordsSchema = z.object({
  businessInfo: z
    .string()
    .min(5)
    .describe(
      "1–3 sentence summary of what the business sells, in Spanish if the page is in Spanish.",
    ),
  keywords: z
    .array(z.string().min(2).max(40))
    .min(3)
    .max(7)
    .describe("Search terms a buyer would type to find this kind of product."),
  category: z
    .string()
    .min(3)
    .max(40)
    .describe("Short category label (e.g. 'cocina', 'fitness', 'belleza')."),
});

export type KeywordsResult = z.infer<typeof KeywordsSchema>;

interface FetchUrlOk {
  ok: true;
  url: string;
  status: number;
  contentType: string | null;
  html: string;
}

interface FetchUrlErr {
  ok: false;
  url: string;
  error: string;
}

type FetchUrlResult = FetchUrlOk | FetchUrlErr;

function stripHtml(input: string): string {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchStrippedHtml(target: string): Promise<FetchUrlResult> {
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return { ok: false, url: target, error: "invalid_url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, url: target, error: "unsupported_protocol" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(parsed.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ReplikScraper/1.0; +https://replik.ai)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    const contentType = response.headers.get("content-type");
    if (!response.ok) {
      return {
        ok: false,
        url: parsed.toString(),
        error: `http_${response.status.toString()}`,
      };
    }
    const raw = await response.text();
    const stripped = stripHtml(raw).slice(0, FETCH_HTML_BYTES);
    return {
      ok: true,
      url: parsed.toString(),
      status: response.status,
      contentType,
      html: stripped,
    };
  } catch (err) {
    return {
      ok: false,
      url: parsed.toString(),
      error: err instanceof Error ? err.message : "fetch_failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

const fetchUrlTool = tool({
  description:
    "Fetches a public web page and returns up to 8KB of cleaned HTML " +
    "(script/style/svg/comments stripped, whitespace collapsed). Use it to " +
    "inspect the competitor landing page and a small number of linked pages.",
  inputSchema: z.object({
    url: z.url().describe("Absolute http(s) URL to fetch."),
  }),
  execute: async ({ url }): Promise<FetchUrlResult> => {
    return await fetchStrippedHtml(url);
  },
});

const SYSTEM_PROMPT = [
  "Eres un analista de e-commerce.",
  "Tu objetivo es entender qué vende un competidor a partir de su sitio web,",
  "y proponer 3 a 7 términos de búsqueda en español que un comprador peruano",
  "usaría para encontrar el mismo tipo de producto en Facebook Ad Library.",
  "Usa la herramienta fetchUrl para leer la página principal y, si es útil,",
  "una página de producto interna. No alucines: si la información no está,",
  "dilo. Responde siempre en español.",
].join(" ");

/**
 * Run the two-step keyword-extraction agent against a competitor URL.
 *
 * Throws if Anthropic returns an unparseable response — callers (the Trigger
 * task) wrap this and downgrade the product status accordingly.
 */
export async function extractKeywords(
  competitorUrl: string,
): Promise<KeywordsResult> {
  const exploration = await generateText({
    model: anthropic(MODEL_ID),
    system: SYSTEM_PROMPT,
    tools: { fetchUrl: fetchUrlTool },
    stopWhen: stepCountIs(MAX_TOOL_STEPS),
    prompt: [
      `Investiga este sitio web de competidor: ${competitorUrl}`,
      "1) Llama fetchUrl con la URL.",
      "2) Si necesitas más contexto, llama fetchUrl una o dos veces más con",
      "   URLs internas relevantes (productos, 'sobre nosotros', etc.).",
      "3) Luego escribe un resumen (1-2 párrafos) en español que cubra:",
      "   - qué producto/servicio vende",
      "   - a qué cliente apunta",
      "   - 3-7 términos de búsqueda potenciales",
      "   - una categoría corta (1-2 palabras)",
    ].join("\n"),
  });

  const result = await generateText({
    model: anthropic(MODEL_ID),
    output: Output.object({ schema: KeywordsSchema }),
    system: SYSTEM_PROMPT,
    prompt: [
      "A partir del siguiente análisis, devuelve el JSON estructurado.",
      "El campo `businessInfo` debe ser una descripción de 1-3 oraciones.",
      "Los `keywords` deben ser frases de búsqueda (no hashtags), 3 a 7.",
      "La `category` debe ser corta (1-2 palabras).",
      "",
      "ANÁLISIS:",
      exploration.text,
    ].join("\n"),
  });

  return result.output;
}
