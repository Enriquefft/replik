/**
 * Bun test preload — maps packages that only work inside Next.js to no-ops
 * so `bun test` can import Server Component modules.
 */
import { mock } from "bun:test"

// server-only throws outside the Next.js runtime. The package ships an
// empty.js shim for exactly this use case.
mock.module("server-only", () => ({}))
