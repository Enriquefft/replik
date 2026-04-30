This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Multi-tenant data access

All Drizzle queries that read or write tenant-scoped tables MUST run inside
`withUser(userId, async (db) => { ... })` from `@/db/client`. Inside the
callback, every query MUST filter by `eq(table.userId, userId)`. The wrapper
validates `userId` is a non-empty string and provides a `TenantDB` handle.

```ts
import { withUser } from "@/db/client";
import { products } from "@/db/schema";
import { eq } from "drizzle-orm";

await withUser(userId, async (db) => {
  return db.select().from(products).where(eq(products.userId, userId));
});
```

> P1 does not yet enforce this with a lint rule — direct `import { db }` from
> `@/db/client` outside `withUser` is currently a manual code-review concern.
> A custom ESLint rule that flags `db` imports outside the wrapper is TODO.

## Database migrations

```bash
DATABASE_URL=... bun run db:generate   # diff schema → SQL in drizzle/
DATABASE_URL=... bun run db:push       # apply against Neon
```

The first migration enables `pgcrypto` (used by `pgp_sym_encrypt`/`pgp_sym_decrypt`).

## Required env

- `DATABASE_URL` — Neon Postgres connection string
- `ENCRYPTION_KEY` — symmetric key for `pgp_sym_encrypt`
- `META_AD_LIBRARY_TOKEN` — server-side Meta Ad Library access token (P2+)
- Clerk + Trigger.dev keys (already wired in P0)

## Tests

```bash
bun test --conditions=react-server
```

Round-trip tests live in `src/__tests__/p1.test.ts`. They auto-skip when
`DATABASE_URL` and `ENCRYPTION_KEY` are not set.
