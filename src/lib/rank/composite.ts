/**
 * Composite ranker for the Paso 2 creatives grid.
 *
 * Replaces `rankByAngleDiversity` (round-robin only) with a scored
 * round-robin: each row gets a composite quality score, then we bucket by
 * sales angle and round-robin across buckets in descending order of each
 * bucket's leader score. Net effect:
 *   - Position 1 is always the absolute top scorer.
 *   - Top-N spans angles before doubling up — preserves the A/B-test
 *     intent of the original angle-diversity ordering.
 *   - Within each angle, rows order by composite score.
 *   - Unclassified (`angle === null`) rows tail at the end.
 *
 * Scoring components, all clamped to [0, 1]:
 *   - brand    — 1 when `brandMatched` (deterministic page_name match
 *                from the relevance gate), else 0. Customer's manual
 *                workflow treats own-brand ads as canonically relevant.
 *   - eng      — `log10(playCount+1) / log10(maxPlay+1)`. Log scale so a
 *                viral 5M-view outlier doesn't crush the rest into ≈0.
 *                Null/zero playCount → 0 (we lack a signal, not "0 views").
 *   - recency  — exponential half-life decay from `postedAt`. Half-life
 *                90d (TikTok ad-fatigue is fast; FB ads tail longer).
 *                Null `postedAt` → NEUTRAL_RECENCY (0.5) so we don't
 *                punish the row for missing metadata.
 *
 * Weights: brand 0.5, eng 0.3, recency 0.2 — brand-relevance dominates
 * because the customer's hand-pick rule is "is this their ad?" first,
 * "does it perform?" second. Recency is the smallest weight: a winning
 * old ad beats a fresh mediocre one.
 *
 * Pure, deterministic, dependency-free. Inject `now` via options for
 * testing — defaults to `new Date()`.
 */

const HALF_LIFE_DAYS = 90
const W_BRAND = 0.5
const W_ENG = 0.3
const W_REC = 0.2
const NEUTRAL_RECENCY = 0.5
const MS_PER_DAY = 86_400_000

interface CompositeRankable {
  angle: string | null
  brandMatched: boolean
  playCount: number | null
  postedAt: Date | null
  scrapedAt: Date
}

function scoreRow(row: CompositeRankable, maxPlay: number, nowMs: number): number {
  const brand = row.brandMatched ? 1 : 0
  const eng =
    row.playCount !== null && row.playCount > 0 && maxPlay > 0
      ? Math.log10(row.playCount + 1) / Math.log10(maxPlay + 1)
      : 0
  let rec: number
  if (row.postedAt === null) {
    rec = NEUTRAL_RECENCY
  } else {
    const daysSince = Math.max(0, (nowMs - row.postedAt.getTime()) / MS_PER_DAY)
    rec = Math.exp((-Math.LN2 * daysSince) / HALF_LIFE_DAYS)
  }
  return W_BRAND * brand + W_ENG * eng + W_REC * rec
}

interface ScoredRow<T> {
  row: T
  composite: number
}

export interface RankByCompositeOptions {
  /** Override "now" for deterministic tests. Defaults to `new Date()`. */
  now?: Date
}

export function rankByComposite<T extends CompositeRankable>(
  rows: readonly T[],
  options: RankByCompositeOptions = {},
): T[] {
  if (rows.length === 0) return []
  const nowMs = (options.now ?? new Date()).getTime()
  const maxPlay = rows.reduce(
    (m, r) => (r.playCount !== null && r.playCount > m ? r.playCount : m),
    0,
  )

  const scored: ScoredRow<T>[] = rows.map((r) => ({
    row: r,
    composite: scoreRow(r, maxPlay, nowMs),
  }))

  const buckets = new Map<string | null, ScoredRow<T>[]>()
  for (const s of scored) {
    const key = s.row.angle
    const existing = buckets.get(key)
    if (existing) existing.push(s)
    else buckets.set(key, [s])
  }

  // Within each bucket: composite desc, then scrapedAt asc as a stable
  // deterministic tiebreaker (older-discovered first when tied).
  const sortBucket = (a: ScoredRow<T>, b: ScoredRow<T>): number => {
    if (a.composite !== b.composite) return b.composite - a.composite
    return a.row.scrapedAt.getTime() - b.row.scrapedAt.getTime()
  }
  for (const list of buckets.values()) list.sort(sortBucket)

  // Order classified angles by their leader's composite (desc). Lex-sort
  // the angle key as a stable tiebreak so the order is reproducible
  // across runs even if two angles tie.
  const angleKeys = Array.from(buckets.keys())
    .filter((k): k is string => k !== null)
    .sort((a, b) => {
      const aTop = buckets.get(a)?.[0]?.composite ?? 0
      const bTop = buckets.get(b)?.[0]?.composite ?? 0
      if (bTop !== aTop) return bTop - aTop
      return a.localeCompare(b)
    })

  const maxDepth = angleKeys.reduce((max, key) => {
    const len = buckets.get(key)?.length ?? 0
    return len > max ? len : max
  }, 0)

  const interleaved: T[] = []
  for (let depth = 0; depth < maxDepth; depth += 1) {
    for (const key of angleKeys) {
      const item = buckets.get(key)?.[depth]
      if (item !== undefined) interleaved.push(item.row)
    }
  }
  // Unclassified rows trail — they're still selectable but should not
  // crowd out angle-classified picks at the top of the grid.
  const nullBucket = buckets.get(null)
  if (nullBucket !== undefined) {
    for (const item of nullBucket) interleaved.push(item.row)
  }
  return interleaved
}
