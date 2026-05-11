import "server-only"

import type { TextTrack } from "@/lib/video/text-lines.ts"

/**
 * Chrome filter: cheap regex-based pre-filter to drop text tracks
 * that are obviously NOT burned-in captions before paying for a
 * Haiku classification call. Catches:
 *   - social handles (@username)
 *   - hashtags (#trending)
 *   - URLs (link.com, www.x.com)
 *   - share/like/comment/follow rail UI labels
 *   - clock / timer overlays (12:34, 1:23:45)
 *   - sponsored / promoted labels
 *   - currency-only labels ($9.99, S/49.90, US$ 12)
 *
 * If ANY text sample on a track matches a drop pattern we discard
 * the whole track — chrome and brand elements are stable across
 * frames, so a single match is a reliable signal.
 *
 * The pre-filter is intentionally conservative on false-positives
 * for captions: regex hits are narrow string shapes that real
 * dialog captions never produce.
 */
const DROP_PATTERNS: readonly RegExp[] = [
  // @handle or @ Handle — IG/TikTok mention.
  /(^|\s)@\s?[a-z0-9._]{2,}/i,
  // #hashtag — must start with # then a letter (avoids "#1" rankings).
  /(^|\s)#[a-z][a-z0-9_]{1,}/i,
  // Bare URLs or domain references.
  /\bhttps?:\/\//i,
  /\bwww\.[a-z0-9-]+\.[a-z]{2,}/i,
  /\b[a-z0-9-]+\.(com|net|org|io|app|co|store|shop|me)\b/i,
  // Clock / runtime overlays — caption text never reads "12:34" alone.
  /^\s*\d{1,2}:\d{2}(:\d{2})?\s*$/,
  // Social rail UI labels (en + es).
  /^\s*(like|comment|share|follow|seguir|comentar|compartir|guardar|save)\s*$/i,
  // Music ticker (TikTok puts a music-note glyph + song title on its own line).
  /^♪|♬|♩|♫/u,
  // Sponsored / Promoted / Ad chips.
  /^\s*(sponsored|promoted|patrocinado|publicidad|ad|anuncio)\s*$/i,
  // Currency-only labels (no descriptive caption text around them).
  /^\s*(S\/\.?|US\$|USD|EUR|€|\$)\s*\d/i,
]

/**
 * Decide if a text track is chrome (UI / brand / non-caption).
 * Exposed for unit testing.
 */
export function isChromeTrack(track: TextTrack): boolean {
  for (const sample of track.textSamples) {
    for (const pattern of DROP_PATTERNS) {
      if (pattern.test(sample)) return true
    }
  }
  return false
}

/**
 * Drop chrome tracks. Returns the surviving track list. Order
 * preserved.
 */
export function filterChromeTracks(tracks: readonly TextTrack[]): TextTrack[] {
  return tracks.filter((t) => !isChromeTrack(t))
}
