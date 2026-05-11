# Replik AI — Roadmap

## Async kickoff (día 0, paralelo a P0)

Estos tienen waits multi-día. Iniciar al arrancar P0; bloquean L3a/L4a (no P0/P1):

- **Meta App Review** — submit `ads_management` + `pages_read_engagement`. ETA 48-72h.
- **Meta Ad Library access** — developer identity verification (`developer.facebook.com` → ID upload). Genera `META_AD_LIBRARY_TOKEN` (user access token) post-approval.
- **Shopify Partner + dev store** — crear cuenta + dev store + Admin API custom app. Scopes: `write_products`, `write_pages`, `write_orders`, `write_themes`. Token debe responder `GET /admin/api/2024-10/shop.json`.

## 1. P0 — Scaffolding

**Blockers:** `DATABASE_URL` (Neon), `CLERK_SECRET_KEY` + `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `TRIGGER_SECRET_KEY` + `TRIGGER_PROJECT_ID` Trigger.dev.

- `bun create next-app@latest` con TS, App Router, RSC, Turbopack, Tailwind v4.
- `bunx shadcn@latest init`. Migrar todos los callers de Primitives.jsx → shadcn equivalents (`Button`, `Input`, `Dialog`, `Form`, `Select`). Borrar Primitives.jsx + `src/components/legacy/`.
- Tokens `foundations.css` → `@theme {}` en `globals.css`.
- Init Drizzle + Neon HTTP driver, Clerk middleware, Trigger.dev v4 SDK.
- `trigger.config.ts` con `build.extensions: [ffmpeg(), aptGet({ packages: ["libass", "fonts-dejavu", "fonts-liberation"] })]`.
- Estructura:
  ```
  src/
    app/
      page.tsx                    # `/` form URL competidor
      dashboard/page.tsx          # returner home
      products/[id]/
    components/ui/                # shadcn
    app/globals.css
    db/{schema,client,zod}.ts
    lib/{meta,shopify,apify,video,agent/scrape,crypto}/
    server/
      actions/
      trigger/
        scrapeProduct/index.ts
        translateAndBurnSubs/index.ts
        publishLanding/index.ts
        launchCampaign/index.ts
  trigger.config.ts
  ```
- `.env.example`: `DATABASE_URL`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `TRIGGER_SECRET_KEY`, `TRIGGER_PROJECT_ID`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `APIFY_TOKEN`, `UPLOADTHING_TOKEN`, `META_AD_LIBRARY_TOKEN`, `ENCRYPTION_KEY`.

**DoD:** `bun dev` arranca, `bun run db:push` corre sin schema, Clerk middleware bloquea, `bun run trigger:dev` conecta, shadcn `Button` renderiza, Primitives.jsx eliminado.

## 2. P1 — Schema + crypto + integrations

**Blockers:** `ENCRYPTION_KEY` (32-byte random). Para DoD round-trip test: token Meta de prueba (`ads_management` aprobada) + `ad_account_id` + `page_id`. Shopify dev store admin token.

Sequential, single agent. Critical path para resto.

1. Drizzle schema completo (arquitectura.md §2).
2. drizzle-zod exports + jsonb hand-written (`EncryptedExtraJson`, `CopyJson`).
3. `pgcrypto` extension via raw SQL migration. `encrypt()` / `decrypt()` helpers.
4. Server Action `saveIntegration({ provider, token, extra })` con validación live → encrypt → persist.
5. Helper `getIntegration(userId, provider)`.
6. `withUser(userId)` query builder en `src/db/client.ts`.
7. Helper `requireIntegration(userId, provider)` que throw / retorna `{ ok: false, needs }` para Server Actions JIT.

**DoD:**
- `bun run db:push` aplica schema.
- Form fake con token Meta inválido → reject. Token válido → row encrypted, decrypt round-trip OK.
- `requireIntegration` retorna `needs` cuando falta integration.

**Gate:** sin DoD verde, no se lanza P2 (excepto L1).

## 3. P2 — Fanout paralelo

| Lane | Owns | Depende |
|---|---|---|
| L1 — Frontend | shadcn migration + routes + JIT modal | nada |
| L2 — Commerce | Shopify lib + landing template + form COD + JIT modal Shopify | P1 |
| L3a — Scrape pipeline | agent/scrape + Apify fallback + transcribe + classify (Trigger task) | P1 + L4a (`adLibrarySearch`) |
| L3b — Video edit | translateAndBurnSubs Trigger task | P1 + L3a (transcript shape) |
| L4a — Meta wrapper | 10 endpoints incl `adLibrarySearch` | P1 |
| L4b — Launch | launchCampaign task + JIT modal Meta + Launch UI | L4a |
| L5 — Dashboard | Dashboard page + manual `syncInsights` button | L4a |

## 4. Lane prompts

### L1 — Frontend

**Blockers:** ninguno (solo P0).
**Owns:** `src/app/`, `src/components/ui/`, `src/styles/globals.css`.

> shadcn/ui ya instalado en P0. Migrar todos los callers de Primitives.jsx → shadcn equivalents. Borrar Primitives.jsx + `src/components/legacy/`. Crea routes:
> - `/` form: URL competidor + `pricing_cents` + `bundle_2_pricing_cents` + `bundle_3_pricing_cents` + `whatsapp_number` (campo solo si `users.whatsapp_number` null, sino prefilled hidden). Submit → persiste user.whatsapp_number si nuevo, crea product, dispara `scrapeProduct` task.
> - `/dashboard` returners, métricas + lista productos.
> - `/products/[id]` status feed scrape + lista 20 creativos con angle badge + transcript preview + checkboxes + botones "publicar landing" + "lanzar campaña" (modals JIT).
>
> Patrón JIT modal: `<CredentialsModal provider="meta"|"shopify" />` controlado por estado cliente. Server Actions retornan `{ ok: false, needs }` → cliente abre modal con form (token + extra) + screenshots + deep-links Business Manager / Shopify Admin embebidos. Validate live al save → reintenta acción original.
>
> Mobile responsive `sm:`/`md:`/`lg:`. Server Actions stubs para forms.
>
> **DoD:** `bun run build` OK, todas las rutas renderizan, modals JIT abren+cierran+validan, Primitives.jsx eliminado.

### L2 — Commerce

**Blockers:** Shopify dev store + admin token (scopes en async kickoff). 3 JSON templates en `src/lib/shopify/templates/{1,2,3}.json` con secciones mínimas: `hero` (title, product_image_url), `form_cod` (fields name/phone/address/city/qty + whatsapp_number + pixel_id), `bundle_pricing` (3 tiers).
**Owns:** `src/lib/shopify/`, `src/server/actions/landing.ts`, `src/server/trigger/publishLanding/`.

> Cliente `@shopify/admin-api-client`. Funciones: `validateToken` (deriva `shop_domain` de la response), `publishProduct` (con bundles 1/2/3 variants + page create), `applyTemplate` (PUT JSON template asset). 3 templates en `src/lib/shopify/templates/{1,2,3}.json`. Engine sustituye placeholders: `{{title}}`, `{{price}}`, `{{bundle_2_price}}`, `{{bundle_3_price}}`, `{{video_urls}}`, `{{product_image_url}}`, `{{whatsapp_number}}`, `{{pixel_id}}`.
>
> LLM template picker: input `{ name, category }` → output `template_id ∈ {1,2,3}`. Persist `products.shopify_template_id`. Single LLM call previo a `applyTemplate`.
>
> Landing 100% hosted en Shopify (`<shop>.myshopify.com/pages/{handle}`). Form COD custom embebido en template Shopify: name, phone, address, city, qty + selector bundle. Submit → `fetch` POST a `https://replik.app/api/orders` (Next.js API route, public, CORS whitelist `*.myshopify.com`, Zod valida, persiste `orders` con `product_id` lookup vía `shopify_page_handle`). On 200 → cliente dispara `fbq('track', 'Purchase', { value, currency })` + redirect `https://wa.me/{whatsapp_number}?text=Hola%2C%20acabo%20de%20ordenar%20{qty}x%20{product_name}.%20Mi%20nombre%3A%20{customer_name}.%20Direcci%C3%B3n%3A%20{address}%2C%20{city}.`. CSP whitelist `connect.facebook.net`.
>
> Server Action `publishLanding` llama `requireIntegration('shopify')` → si falta retorna `{ ok: false, needs: 'shopify' }` → modal abre.
>
> **DoD:** Modal Shopify save → publish task → URL `<shop>.myshopify.com/pages/{handle}` accesible, form COD POST `/api/orders` inserta row, Pixel fires (Events Manager), redirect WhatsApp dispara.

### L3a — Scrape pipeline

**Blockers:** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `APIFY_TOKEN`, `META_AD_LIBRARY_TOKEN` (post identity verification — async kickoff). Curl test: `/ads_archive?search_terms=test&ad_reached_countries=["PE"]` retorna ≥1.
**Owns:** `src/lib/apify/`, `src/lib/agent/scrape/`, `src/server/trigger/scrapeProduct/`.
**Reads:** `src/lib/meta/adLibrarySearch` (L4a — coordinar export early).

> Trigger.dev v4 task `scrapeProduct` con 4 sub-pasos secuenciales emitiendo progress events:
> 1. `extractKeywords(competitorUrl)`: agente LLM (Vercel AI SDK + Anthropic) con tool fetch URL. Output `{ businessInfo, keywords[3-7] }`.
> 2. `findAds(keywords)`: `meta.adLibrarySearch({ searchTerms: keywords.join(' '), countries: ['PE'], limit: 20 })`. Si Meta da 0 / error / rate limit → fallback `apify.searchFBAdsByKeywords(keywords)`. Persist 20 rows en `creatives` (`selected_bool=false`, `source` apropiado, `scrape_url`).
> 3. `transcribeAds`: por creative, descarga video, si > 25MB chunk audio (`-f segment -segment_time 60 -vn -c:a libmp3lame`), Whisper API por chunk con `verbose_json`. SRT post-process (strip Amara hallucinations, dedupe consecutive tokens, merge chunks por timestamps). Persist `creatives.transcript_text` + `creatives.language`.
> 4. `classifyAngles`: single LLM batch — pasa los 20 transcripts, retorna 20 angle labels libres 1-3 palabras. Persist `creatives.angle`.
>
> Si ambos providers dan 0 → status `SCRAPE_EMPTY`. Idempotency: `scrape_${productId}_${attempt}`.
>
> **DoD:** URL real → 20 rows con `transcript_text`, `language`, `angle` poblados, status events visibles UI.

### L3b — Video edit

**Blockers:** `UPLOADTHING_TOKEN`. Trigger.dev v4 build extensions validadas: `bun run trigger:dev` corre task local, ffmpeg + libass + DejaVu resuelven, burn-subs ES con acentos contra video real OK.
**Owns:** `src/lib/video/`, `src/server/trigger/translateAndBurnSubs/index.ts`.

> Trigger.dev v4 task `translateAndBurnSubs`. Trigger por creative `selected_bool=true`. Pipeline: read `transcript_text` + `language` → si `language !== 'es'` translate transcript a ES-PE (LLM call) → genera SRT desde transcript translated → download original video → ffmpeg burn subs (libass + DejaVu Sans ES-PE) + H.264 CRF 23 → upload UploadThing → persist `assets` row kind `edited_video` + `srt`.
>
> Sin crop, sin speed. Machine `large-1x` pinned. Idempotency: `burn_${creativeId}_${attempt}`.
>
> **DoD:** creative selected con `language=en` → versión editada con subs ES-PE quemados accesible URL.

### L4a — Meta wrapper

**Blockers:** Meta App Review aprobada (`ads_management` + `pages_read_engagement` — async kickoff). User test token + `ad_account_id` (`act_xxx`) + `page_id`. Curl test: `GET /me/adaccounts?access_token=$TOKEN` retorna ≥1.
**Owns:** `src/lib/meta/`.

> Wrapper REST artesanal Meta Marketing API v21.0 + Ad Library API. 10 endpoints: `adLibrarySearch` (Ad Library, usa `META_AD_LIBRARY_TOKEN` env, no creds del user, query `/ads_archive?search_terms&ad_type=ALL&ad_reached_countries`), `accountsList`, `campaignCreate`, `campaignList`, `adsetCreate`, `creativeCreate`, `adCreate`, `videoUploadResumable` (start/transfer/finish), `imageUpload`, `insightsGet`.
>
> Cada uno con Zod schema input + output. Static interests dict. Retry exponencial en transients (5xx, rate limit, code 17). Error mapping `MetaError` con `code`, `fbtrace_id`, `friendly` (mensaje español). Detector code 190 → marca `integrations.expires_at`. Helper `pixelsList(creds)` (consumido por `saveIntegration` Meta para resolver y persistir `pixel_id` en `extra`).
>
> **DoD:** `adLibrarySearch` retorna ≥1 ad real con keywords reales. Resto endpoints llamables contra ad account real. Error mapping retorna `friendly`.

### L4b — Launch

**Blockers:** L4a verde (transitive: Meta App Review + test token).
**Owns:** `src/server/actions/launch.ts`, `src/server/trigger/launchCampaign/`.

> Server Action `launchCampaign` llama `requireIntegration('meta')` → si falta retorna `{ ok: false, needs: 'meta' }` → modal abre. Trigger task orquesta 6 pasos: videoUpload → imageUpload → creativeCreate → campaignCreate → adsetCreate → adCreate × N. Idempotency `launch_${userId}_${productId}_${attempt}` → `idempotency_keys` table. Status final PAUSED.
>
> Features: Advantage+ default, audiences broad+detailed, copy LLM por ángulo (1 call genera N copies basado en `creatives.angle`), CTA per ad.
>
> **DoD:** modal Meta save → campaign draft PAUSED visible Ads Manager con video editado + copy + targeting + bundles price. Idempotency rerun no duplica.

### L5 — Dashboard

**Blockers:** L4a verde (transitive: Meta token con ads activas para `insightsGet`).
**Owns:** `src/app/dashboard/`, `src/server/trigger/syncInsights/`, hooks TanStack Query.

> Trigger.dev task `syncInsights`, llama `meta.insightsGet` por campaign/adset/ad de campañas activas, upsert `metrics` (con `withUser`). Botón manual "refresh metrics" en dashboard dispara task. Dashboard renderiza productos en cards: status, métricas (CPA, ROAS, spend), pedidos count, link a landing publicada.
>
> **DoD:** botón refresh dispara task, métricas aparecen en dashboard, pedidos count actualiza al insertar `orders`.
