"use server"

import { requireUser, UnauthenticatedError } from "@/db/client"
import {
  NarrateProgressInputSchema,
  type NarrateProgressResult,
  narrateProgress,
} from "@/lib/ai/narrate.ts"

export interface NarrateProgressActionInput {
  taskKind: string
  phase: string | null
  metadataJson: string
}

const EMPTY: NarrateProgressResult = { text: null }

/**
 * Client-side entry-point for the narration LLM. Validates the input
 * against the zod schema and gates behind a Clerk session — the
 * `narration_cache` table is shared across users (the hash includes
 * `taskKind + phase + metadataJson`, no user-specific data), but the LLM
 * call itself is gated to prevent anonymous abuse of our model spend.
 *
 * Returns `{ text: null }` when validation, auth, or the LLM fails so the
 * caller can fall back to the template.
 */
export async function narrateProgressAction(
  input: NarrateProgressActionInput,
): Promise<NarrateProgressResult> {
  try {
    await requireUser()
  } catch (err) {
    if (err instanceof UnauthenticatedError) return EMPTY
    throw err
  }
  const parsed = NarrateProgressInputSchema.safeParse(input)
  if (!parsed.success) return EMPTY
  return await narrateProgress(parsed.data)
}
