/**
 * Tests for adjustCopy — §13 chat route.
 *
 * LLM calls mocked via MockLanguageModelV3 from `ai/test`. Each test injects
 * a primary (and sometimes bumped) model through the optional `deps` arg.
 *
 * Coverage:
 *   1. Fixture size guard: 30 rows, 6 per kind.
 *   2. System-prompt snapshot: ban-list / discriminator tokens present.
 *   3. Prompt builder: includes current copy + user message verbatim.
 *   4. Per-kind happy path (rewrite_hero, adjust_copy, regenerate_angle,
 *      clarify, reject) → ok:true.
 *   5. Input validation (empty message, missing fields) → ok:false.
 *   6. Both tries throw → ok:false ("model could not satisfy constraints").
 *   7. Primary returns AI-speak violation → bumped retry → ok:true on second.
 *   8. Both tries return Meta-policy violation → ok:false (post-check).
 *   9. Length violation surfaces ok:false on the patched field.
 *   10. clarify / reject / regenerate_angle skip the post-check guards.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { LanguageModelV3, LanguageModelV3GenerateResult } from "@ai-sdk/provider"
import { MockLanguageModelV3 } from "ai/test"
import { z } from "zod"

import {
  ADJUST_COPY_SYSTEM_PROMPT,
  adjustCopy,
  buildAdjustCopyUserPrompt,
} from "@/lib/ai/adjust-copy.ts"
import {
  type AdjustCopyAction,
  AdjustCopyActionSchema,
  type AdjustCopyInput,
  AdjustCopyInputSchema,
} from "@/lib/ai/schemas.ts"

// ─── Fixture loader ──────────────────────────────────────────────────────────

const FIXTURE_PATH = join(import.meta.dir, "..", "fixtures", "adjust-copy.json")

const FixtureFileSchema = z.object({
  version: z.number(),
  rows: z.array(
    z.object({
      input: AdjustCopyInputSchema,
      expected: AdjustCopyActionSchema,
    }),
  ),
})

const fixtureFile = FixtureFileSchema.parse(JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")))

// ─── Mock helpers ────────────────────────────────────────────────────────────

function makeGenerateResult(object: unknown): LanguageModelV3GenerateResult {
  return {
    content: [{ type: "text", text: JSON.stringify(object) }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 30, text: 30, reasoning: undefined },
    },
    warnings: [],
  }
}

function modelReturning(action: AdjustCopyAction): LanguageModelV3 {
  return new MockLanguageModelV3({
    doGenerate: async () => makeGenerateResult(action),
  })
}

function throwingModel(): LanguageModelV3 {
  return new MockLanguageModelV3({
    doGenerate: async () => {
      throw new Error("simulated LLM failure")
    },
  })
}

// ─── Fixture size guard ──────────────────────────────────────────────────────

describe("adjust-copy fixture", () => {
  test("has exactly 30 rows", () => {
    expect(fixtureFile.rows).toHaveLength(30)
  })

  test("has 6 rows per kind", () => {
    const kinds = ["rewrite_hero", "adjust_copy", "regenerate_angle", "clarify", "reject"] as const
    for (const k of kinds) {
      expect(fixtureFile.rows.filter((r) => r.expected.kind === k)).toHaveLength(6)
    }
  })
})

// ─── System prompt snapshot ──────────────────────────────────────────────────

describe("ADJUST_COPY_SYSTEM_PROMPT — discriminator + ban-list tokens (§13)", () => {
  test("declares all five kinds verbatim", () => {
    expect(ADJUST_COPY_SYSTEM_PROMPT).toContain("rewrite_hero")
    expect(ADJUST_COPY_SYSTEM_PROMPT).toContain("adjust_copy")
    expect(ADJUST_COPY_SYSTEM_PROMPT).toContain("regenerate_angle")
    expect(ADJUST_COPY_SYSTEM_PROMPT).toContain("clarify")
    expect(ADJUST_COPY_SYSTEM_PROMPT).toContain("reject")
  })

  test("includes hard length bounds from CopyContentSchema", () => {
    expect(ADJUST_COPY_SYSTEM_PROMPT).toContain("125")
    expect(ADJUST_COPY_SYSTEM_PROMPT).toContain("40")
    expect(ADJUST_COPY_SYSTEM_PROMPT).toContain("30")
  })

  test("includes AI-speak ban verbs", () => {
    expect(ADJUST_COPY_SYSTEM_PROMPT).toContain("descubre")
    expect(ADJUST_COPY_SYSTEM_PROMPT).toContain("transforma")
    expect(ADJUST_COPY_SYSTEM_PROMPT).toContain("revoluciona")
    expect(ADJUST_COPY_SYSTEM_PROMPT).toContain("imagina")
  })

  test("includes Meta-policy banned terms", () => {
    expect(ADJUST_COPY_SYSTEM_PROMPT).toContain("milagroso")
    expect(ADJUST_COPY_SYSTEM_PROMPT).toContain("garantizado")
    expect(ADJUST_COPY_SYSTEM_PROMPT).toContain("antes y después")
  })

  test("lists the 8 SalesAngle values for regenerate_angle", () => {
    expect(ADJUST_COPY_SYSTEM_PROMPT).toContain("precio")
    expect(ADJUST_COPY_SYSTEM_PROMPT).toContain("demostracion")
    expect(ADJUST_COPY_SYSTEM_PROMPT).toContain("testimonio")
    expect(ADJUST_COPY_SYSTEM_PROMPT).toContain("urgencia")
    expect(ADJUST_COPY_SYSTEM_PROMPT).toContain("dolor")
    expect(ADJUST_COPY_SYSTEM_PROMPT).toContain("aspiracional")
    expect(ADJUST_COPY_SYSTEM_PROMPT).toContain("comparacion")
    expect(ADJUST_COPY_SYSTEM_PROMPT).toContain("regalo")
  })
})

// ─── Prompt builder ──────────────────────────────────────────────────────────

describe("buildAdjustCopyUserPrompt", () => {
  const sample: AdjustCopyInput = {
    userId: "user-prompt-builder",
    current: {
      primaryText: "Texto principal",
      headline: "Titular corto",
      description: "Descripción ok",
    },
    message: "Cambia el headline a algo más urgente",
    context: {
      productId: "prod-xyz",
      creatives: [
        { id: "c1", angle: "urgencia" },
        { id: "c2", angle: null },
      ],
    },
  }

  test("includes productId", () => {
    expect(buildAdjustCopyUserPrompt(sample)).toContain("prod-xyz")
  })

  test("includes every current copy field verbatim", () => {
    const p = buildAdjustCopyUserPrompt(sample)
    expect(p).toContain("Texto principal")
    expect(p).toContain("Titular corto")
    expect(p).toContain("Descripción ok")
  })

  test("includes user message verbatim", () => {
    expect(buildAdjustCopyUserPrompt(sample)).toContain("Cambia el headline a algo más urgente")
  })

  test("renders nullable angle as '(angle: null)'", () => {
    expect(buildAdjustCopyUserPrompt(sample)).toContain("c2: (angle: null)")
  })

  test("renders non-null angle as 'cN: <angle>'", () => {
    expect(buildAdjustCopyUserPrompt(sample)).toContain("c1: urgencia")
  })

  test("emits placeholder when no creatives are attached", () => {
    const empty: AdjustCopyInput = {
      ...sample,
      context: { productId: "prod-xyz", creatives: [] },
    }
    expect(buildAdjustCopyUserPrompt(empty)).toContain("(sin creativos asociados)")
  })
})

// ─── Per-kind happy paths (mocked LLM, fixture-driven) ───────────────────────

describe("adjustCopy — fixture happy paths (mocked LLM)", () => {
  for (const kind of [
    "rewrite_hero",
    "adjust_copy",
    "regenerate_angle",
    "clarify",
    "reject",
  ] as const) {
    test(`returns ok:true with action.kind === "${kind}"`, async () => {
      const row = fixtureFile.rows.find((r) => r.expected.kind === kind)
      if (!row) throw new Error(`no fixture row for kind=${kind}`)
      const result = await adjustCopy(row.input, {
        primaryModel: modelReturning(row.expected),
        bumpedModel: modelReturning(row.expected),
        rateLimiters: passingLimiters(),
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.action.kind).toBe(kind)
      }
    })
  }
})

// ─── Input validation ────────────────────────────────────────────────────────

describe("adjustCopy — input validation", () => {
  const baseInput: AdjustCopyInput = {
    userId: "user-validation",
    current: { primaryText: "p", headline: "h", description: "d" },
    message: "ok",
    context: { productId: "p1", creatives: [] },
  }

  test("rejects empty message → ok:false with descriptive error", async () => {
    const result = await adjustCopy(
      { ...baseInput, message: "" },
      {
        primaryModel: modelReturning({ kind: "clarify", message: "?" }),
        rateLimiters: passingLimiters(),
      },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("message")
    }
  })

  test("rejects missing productId → ok:false", async () => {
    const result = await adjustCopy(
      { ...baseInput, context: { productId: "", creatives: [] } },
      {
        primaryModel: modelReturning({ kind: "clarify", message: "?" }),
        rateLimiters: passingLimiters(),
      },
    )
    expect(result.ok).toBe(false)
  })

  test("rejects oversized current.headline → ok:false", async () => {
    const result = await adjustCopy(
      { ...baseInput, current: { ...baseInput.current, headline: "x".repeat(50) } },
      {
        primaryModel: modelReturning({ kind: "clarify", message: "?" }),
        rateLimiters: passingLimiters(),
      },
    )
    expect(result.ok).toBe(false)
  })

  test("rejects empty userId → ok:false", async () => {
    const result = await adjustCopy(
      { ...baseInput, userId: "" },
      {
        primaryModel: modelReturning({ kind: "clarify", message: "?" }),
        rateLimiters: passingLimiters(),
      },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("userId")
    }
  })
})

// ─── Fallback / retry ────────────────────────────────────────────────────────

describe("adjustCopy — retry + fallback", () => {
  const validInput: AdjustCopyInput = {
    userId: "user-retry",
    current: { primaryText: "p", headline: "h", description: "d" },
    message: "ajusta el headline",
    context: { productId: "p1", creatives: [] },
  }

  test("both tries throw → ok:false with 'model could not satisfy constraints'", async () => {
    const result = await adjustCopy(validInput, {
      primaryModel: throwingModel(),
      bumpedModel: throwingModel(),
      rateLimiters: passingLimiters(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe("model could not satisfy constraints")
    }
  })

  test("primary returns AI-speak violation, bumped returns clean → ok:true on bumped", async () => {
    const dirty: AdjustCopyAction = {
      kind: "rewrite_hero",
      hero: { headline: "Descubre el futuro" },
    }
    const clean: AdjustCopyAction = {
      kind: "rewrite_hero",
      hero: { headline: "Tu día más simple" },
    }
    const result = await adjustCopy(validInput, {
      primaryModel: modelReturning(dirty),
      bumpedModel: modelReturning(clean),
      rateLimiters: passingLimiters(),
    })
    expect(result.ok).toBe(true)
    if (result.ok && result.action.kind === "rewrite_hero") {
      expect(result.action.hero.headline).toBe("Tu día más simple")
    }
  })

  test("both tries return Meta-policy violation → ok:false", async () => {
    const dirty: AdjustCopyAction = {
      kind: "adjust_copy",
      overrides: { description: "milagroso" },
    }
    const result = await adjustCopy(validInput, {
      primaryModel: modelReturning(dirty),
      bumpedModel: modelReturning(dirty),
      rateLimiters: passingLimiters(),
    })
    expect(result.ok).toBe(false)
  })

  test("length violation in primaryText → bumped also bad → ok:false", async () => {
    const tooLong: AdjustCopyAction = {
      kind: "rewrite_hero",
      hero: { primaryText: "a".repeat(200) },
    }
    const result = await adjustCopy(validInput, {
      primaryModel: modelReturning(tooLong),
      bumpedModel: modelReturning(tooLong),
      rateLimiters: passingLimiters(),
    })
    expect(result.ok).toBe(false)
  })

  test("clarify action skips post-check (long message under 300 still passes)", async () => {
    const action: AdjustCopyAction = { kind: "clarify", message: "milagroso?" }
    const result = await adjustCopy(validInput, {
      primaryModel: modelReturning(action),
      rateLimiters: passingLimiters(),
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.action.kind).toBe("clarify")
  })

  test("reject action skips post-check (banned tokens in reason are allowed there)", async () => {
    const action: AdjustCopyAction = {
      kind: "reject",
      reason: "no se permiten claims de 'milagroso'",
    }
    const result = await adjustCopy(validInput, {
      primaryModel: modelReturning(action),
      rateLimiters: passingLimiters(),
    })
    expect(result.ok).toBe(true)
  })

  test("regenerate_angle skips post-check, ok:true with the new angle", async () => {
    const action: AdjustCopyAction = { kind: "regenerate_angle", angle: "urgencia" }
    const result = await adjustCopy(validInput, {
      primaryModel: modelReturning(action),
      rateLimiters: passingLimiters(),
    })
    expect(result.ok).toBe(true)
    if (result.ok && result.action.kind === "regenerate_angle") {
      expect(result.action.angle).toBe("urgencia")
    }
  })
})

// ─── Rate limiting (§13) ─────────────────────────────────────────────────────

describe("adjustCopy — Upstash rate limit (§13)", () => {
  const validInput: AdjustCopyInput = {
    userId: "user-ratelimit",
    current: { primaryText: "p", headline: "h", description: "d" },
    message: "ajusta el headline",
    context: { productId: "p1", creatives: [] },
  }

  test("perSec denies → ok:false with error 'rate_limited'", async () => {
    const calls: string[] = []
    const limiters = {
      perSec: makeLimiter(false, calls),
      perMin: makeLimiter(true, calls),
    }
    const result = await adjustCopy(validInput, {
      primaryModel: modelReturning({ kind: "clarify", message: "?" }),
      rateLimiters: limiters,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe("rate_limited")
    }
    expect(calls).toContain("user-ratelimit")
  })

  test("perMin denies → ok:false with error 'rate_limited'", async () => {
    const limiters = {
      perSec: makeLimiter(true, []),
      perMin: makeLimiter(false, []),
    }
    const result = await adjustCopy(validInput, {
      primaryModel: modelReturning({ kind: "clarify", message: "?" }),
      rateLimiters: limiters,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe("rate_limited")
    }
  })

  test("both windows pass → LLM is reached and ok:true", async () => {
    const result = await adjustCopy(validInput, {
      primaryModel: modelReturning({ kind: "clarify", message: "?" }),
      rateLimiters: passingLimiters(),
    })
    expect(result.ok).toBe(true)
  })

  test("both limiters are keyed by userId from input", async () => {
    const callsSec: string[] = []
    const callsMin: string[] = []
    const limiters = {
      perSec: makeLimiter(true, callsSec),
      perMin: makeLimiter(true, callsMin),
    }
    await adjustCopy(
      { ...validInput, userId: "user-keyed-by-id" },
      {
        primaryModel: modelReturning({ kind: "clarify", message: "?" }),
        rateLimiters: limiters,
      },
    )
    expect(callsSec).toEqual(["user-keyed-by-id"])
    expect(callsMin).toEqual(["user-keyed-by-id"])
  })
})

// ─── Limiter helpers ─────────────────────────────────────────────────────────

function makeLimiter(
  success: boolean,
  calls: string[],
): { limit: (id: string) => Promise<{ success: boolean }> } {
  return {
    limit: async (id: string) => {
      calls.push(id)
      return { success }
    },
  }
}

function passingLimiters() {
  return {
    perSec: makeLimiter(true, []),
    perMin: makeLimiter(true, []),
  }
}
