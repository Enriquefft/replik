import "server-only"

import { existsSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Where libass should look for the bundled display font. The repo ships
 * `assets/fonts/Montserrat-ExtraBold.ttf` (SIL OFL) so libass never falls
 * back to a system font (e.g. DejaVu) — fallback is the failure mode that
 * makes captions look "Linux default" instead of viral-tier.
 *
 * Resolution order:
 *   1. `REPLIK_FONTSDIR` env var (set by the Trigger.dev build extension
 *      that copies the fonts into the deployed image).
 *   2. `<repo>/assets/fonts` (local dev + any runtime that mounts the repo).
 */
export function resolveFontsDir(): string {
  const fromEnv = process.env.REPLIK_FONTSDIR
  if (fromEnv !== undefined && fromEnv.length > 0 && existsSync(fromEnv)) {
    return fromEnv
  }
  const repoFonts = resolve(process.cwd(), "assets/fonts")
  return repoFonts
}

/** PostScript family name libass matches against `FontName=`. */
export const VIRAL_FONT_NAME = "Montserrat ExtraBold"
