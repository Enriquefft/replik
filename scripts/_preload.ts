/**
 * Bun preload for the onboarding CLI.
 *
 * Neutralizes the `server-only` package, which throws on import outside a
 * Next.js bundler context. Next rewrites `server-only` → `server-only/empty`
 * at build time; we replicate that behavior at runtime so DB/trigger modules
 * marked `import "server-only"` can be imported by `bun scripts/onboard.ts`.
 */

import { plugin } from "bun"

plugin({
  name: "server-only-noop",
  setup(builder) {
    builder.module("server-only", () => ({
      exports: {},
      loader: "object",
    }))
  },
})
