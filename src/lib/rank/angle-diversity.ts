/**
 * Lane L4 — Angle-diversity ranking.
 *
 * Customer manual flow: skim 5-10 creatives, pick *across angles* to A/B
 * test rather than 5 of the same hook. Classifier produces an `angle`
 * label (or null for unclassified rows). The grid currently sorts by
 * (angle IS NOT NULL DESC, scrapedAt ASC) — classified first, but with
 * a single angle stacking together. A user grabbing the first 5 cards
 * gets the same hook 5 times.
 *
 * This module re-orders classified rows into round-robin so the first
 * pass across the grid covers every angle once before repeating any
 * single angle. Unclassified rows are pushed to the tail.
 *
 * Pure, deterministic, dependency-free — testable without a DB.
 */

interface AngleRankable {
  angle: string | null
  scrapedAt: Date
}

/**
 * Round-robin re-order: groups by angle, sorts within each group by
 * scrapedAt asc, then interleaves group #N's k-th element across all
 * groups before any group's (k+1)-th element. Tie-break across angles
 * uses lexicographic angle key for determinism.
 *
 * Unclassified rows (angle === null) are appended at the tail in
 * scrapedAt order — they're still useful but should not crowd out
 * classified picks.
 */
export function rankByAngleDiversity<T extends AngleRankable>(rows: readonly T[]): T[] {
  const buckets = new Map<string, T[]>()
  const unclassified: T[] = []

  for (const row of rows) {
    if (row.angle === null) {
      unclassified.push(row)
      continue
    }
    const existing = buckets.get(row.angle)
    if (existing) {
      existing.push(row)
    } else {
      buckets.set(row.angle, [row])
    }
  }

  const sortByScrapedAtAsc = (a: T, b: T) => a.scrapedAt.getTime() - b.scrapedAt.getTime()
  for (const list of buckets.values()) {
    list.sort(sortByScrapedAtAsc)
  }
  unclassified.sort(sortByScrapedAtAsc)

  const angleKeys = Array.from(buckets.keys()).sort()
  const maxDepth = angleKeys.reduce((max, key) => {
    const list = buckets.get(key)
    return list && list.length > max ? list.length : max
  }, 0)

  const interleaved: T[] = []
  for (let depth = 0; depth < maxDepth; depth += 1) {
    for (const key of angleKeys) {
      const list = buckets.get(key)
      if (list && depth < list.length) {
        interleaved.push(list[depth] as T)
      }
    }
  }

  return [...interleaved, ...unclassified]
}
