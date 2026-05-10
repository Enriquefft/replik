/**
 * Cross-source engagement signals captured from creative scrapers
 * (TikTok clockworks, Facebook Ad Library) but historically discarded
 * at the Zod parse boundary. This module owns the canonical schema —
 * one shape, derived once via `z.infer`, projected into the persisted
 * `creatives` columns at insert time.
 *
 * All fields are optional so partial extraction (e.g. FB ad with no
 * EU reach data, TikTok video missing collectCount) flows through
 * without failing the row. Counts are non-negative integers; ISO
 * timestamps are strings here and converted to `Date` at the insert
 * site (tolerating bad ISO without crashing the row).
 */

import { z } from "zod"

const NonNegativeInt = z.number().int().nonnegative()
const NonEmpty = z.string().min(1)

export const EngagementSignalsSchema = z.object({
  playCount: NonNegativeInt.optional(),
  likeCount: NonNegativeInt.optional(),
  shareCount: NonNegativeInt.optional(),
  commentCount: NonNegativeInt.optional(),
  collectCount: NonNegativeInt.optional(),
  /** ISO 8601 string. Convert to `Date` at the DB insert site; tolerate
   *  invalid ISO by writing null instead of crashing the insert. */
  postedAt: z.string().optional(),
  isActive: z.boolean().optional(),
  /** Days the ad has been continuously active. Derived from FB
   *  `totalActiveTime` (seconds) via `toActiveDays`. */
  activeDays: NonNegativeInt.optional(),
  euTotalReach: z.number().int().optional(),
  hashtags: z.array(NonEmpty).optional(),
  authorHandle: NonEmpty.optional(),
  authorFans: NonNegativeInt.optional(),
  authorVerified: z.boolean().optional(),
})

export type EngagementSignals = z.infer<typeof EngagementSignalsSchema>

const SECONDS_PER_DAY = 86_400

/**
 * Convert FB ad `totalActiveTime` (seconds) to whole days. Returns null
 * for null/undefined/zero input — the caller writes null to
 * `creatives.activeDays` rather than recording a misleading 0.
 */
export function toActiveDays(totalActiveTimeSecs: number | null | undefined): number | null {
  if (totalActiveTimeSecs === null || totalActiveTimeSecs === undefined) return null
  if (!Number.isFinite(totalActiveTimeSecs) || totalActiveTimeSecs <= 0) return null
  const days = Math.floor(totalActiveTimeSecs / SECONDS_PER_DAY)
  if (days <= 0) return null
  return days
}
