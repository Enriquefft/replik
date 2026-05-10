/**
 * Cross-source engagement signals captured from creative scrapers
 * (TikTok clockworks, Facebook Ad Library) but historically discarded
 * at the Zod parse boundary. This module owns the canonical schema —
 * one shape, derived once via `z.infer`, projected into the persisted
 * `creatives` columns at insert time.
 *
 * All fields are optional so partial extraction (e.g. FB ad with no
 * postedAt, TikTok video missing playCount) flows through without
 * failing the row. Counts are non-negative integers; ISO timestamps
 * are strings here and converted to `Date` at the insert site
 * (tolerating bad ISO without crashing the row).
 */

import { z } from "zod"

const NonNegativeInt = z.number().int().nonnegative()
const NonEmpty = z.string().min(1)

export const EngagementSignalsSchema = z.object({
  playCount: NonNegativeInt.optional(),
  likeCount: NonNegativeInt.optional(),
  shareCount: NonNegativeInt.optional(),
  commentCount: NonNegativeInt.optional(),
  /** ISO 8601 string. Convert to `Date` at the DB insert site; tolerate
   *  invalid ISO by writing null instead of crashing the insert. */
  postedAt: z.string().optional(),
  hashtags: z.array(NonEmpty).optional(),
  authorHandle: NonEmpty.optional(),
  authorVerified: z.boolean().optional(),
})

export type EngagementSignals = z.infer<typeof EngagementSignalsSchema>
