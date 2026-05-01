import { z } from "zod"

const BUNDLE_2_MULTIPLIER = 1.8
const BUNDLE_3_MULTIPLIER = 2.5
const ROUND_TO_CENTS = 100
const MAX_SOLES = 99999.99
const CENTS_PER_SOL = 100

function roundToNearestSol(cents: number): number {
  return Math.round(cents / ROUND_TO_CENTS) * ROUND_TO_CENTS
}

export function defaultBundle2Cents(singleCents: number): number {
  return roundToNearestSol(singleCents * BUNDLE_2_MULTIPLIER)
}

export function defaultBundle3Cents(singleCents: number): number {
  return roundToNearestSol(singleCents * BUNDLE_3_MULTIPLIER)
}

export function resolveBundlePricing(
  singleCents: number,
  storedBundle2: number | null,
  storedBundle3: number | null,
): { bundle2Cents: number; bundle3Cents: number } {
  return {
    bundle2Cents: storedBundle2 ?? defaultBundle2Cents(singleCents),
    bundle3Cents: storedBundle3 ?? defaultBundle3Cents(singleCents),
  }
}

export const SolesToCentsSchema = z
  .number({ error: "Ingresa un precio válido" })
  .positive("Debe ser mayor a 0")
  .max(MAX_SOLES, "Demasiado alto")
  .transform((soles) => Math.round(soles * CENTS_PER_SOL))

export function centsToSoles(cents: number): number {
  return cents / CENTS_PER_SOL
}
