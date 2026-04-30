# Replik — Project Rules

These rules are non-negotiable. Every agent, every file, every line.

## Development Philosophy

This is an MVP for a functional, sellable product.

## TypeScript

- **Never use `any`**. Use `unknown` + runtime validation, generics, or explicit types.
- **Never use `as` type casting** (except `as const`). Use type guards, Zod parse, or structural fixes. Only `as` if genuinely no other way — and document why.
- Derive types from sources (Zod `z.infer`, Drizzle `$inferSelect`, pgEnum). Never duplicate. SSOT is top priority, avoid hardcoding return types, infer as much as possible.
- Use types as narrow as possible, avoid string, use branded types, etc

## Biome / Linting

- **Never silence warnings or errors with biome-ignore comments** unless genuinely no fix. Fix the code.
- Run `bun run lint` before considering any phase done. Zero errors required.

## Code Conventions

- Named exports only (except framework defaults: vite.config, astro.config, drizzle.config).
- kebab-case for file names, PascalCase for components/types, camelCase for variables/functions.
- Import with `.ts` / `.tsx` extensions. `@/` path alias resolves to `./src/*`.
