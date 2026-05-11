# Replik AI — Arquitectura

## 1. Stack

| Pieza | Tech |
|---|---|
| Package manager | Bun |
| Framework | Next.js 16 (App Router, Server Actions, RSC, Turbopack) |
| Hosting | Vercel |
| Auth | Clerk (magic link, multi-tenant via `userId`) |
| DB | Neon Postgres + `@neondatabase/serverless` HTTP driver |
| ORM | Drizzle + drizzle-kit + drizzle-zod |
| Background jobs | Trigger.dev v4 (build extensions: `ffmpeg()` + `aptGet({ packages: ["libass", "fonts-dejavu", "fonts-liberation"] })`) |
| LLM | Vercel AI SDK + Anthropic Claude Sonnet |
| Meta | REST wrapper artesanal + Zod (Marketing API v21.0 + Ad Library API) |
| Apify | `apify-client` (FB Ads fallback) |
| Shopify | `@shopify/admin-api-client` |
| Whisper | OpenAI API |
| Files | UploadThing |
| Forms | Zod (drizzle-zod) |
| Encryption | `pgcrypto` raw SQL migration + `ENCRYPTION_KEY` env (`pgp_sym_encrypt`) |
| Cache | TanStack Query (dashboard manual refresh) |
| UI | shadcn/ui (Radix + Tailwind v4 CSS-first `@theme`) |
| Class merge | `tailwind-merge` v3 + `cn()` |

## 2. Data model

```sql
users             (id, clerk_user_id, email, whatsapp_number, created_at)

integrations      (id, user_id, provider [meta|shopify], encrypted_token,
                   encrypted_extra_json, key_version, validated_at, expires_at,
                   created_at)
                  -- shopify extra: { shop_domain }     -- derivado de validate token
                  -- meta extra:    { ad_account_id, page_id, pixel_id }

products          (id, user_id, source_url, name, image_url, category,
                   pricing_cents, bundle_2_pricing_cents, bundle_3_pricing_cents,
                   status, shopify_product_id, shopify_page_handle,
                   shopify_template_id, created_at)
                  -- status enum: SCRAPING | READY | LANDING_PUBLISHED |
                  --              CAMPAIGN_LAUNCHED | SCRAPE_EMPTY | FAILED
                  -- shopify_template_id: 1|2|3, set por LLM picker en publishLanding
                  -- pricing_cents + bundle_2/3: input user en form `/`
                  -- category: output extractKeywords agent
                  -- whatsapp_number: heredado de users.whatsapp_number

creatives         (id, product_id, user_id, source [meta_ad_library|apify_fb],
                   scrape_url, angle, transcript_text, language,
                   selected_bool, scraped_at)

assets            (id, owner_type [creative|product], owner_id,
                   kind [original_video|edited_video|srt],
                   url, bytes, mime, created_at)

campaigns         (id, product_id, user_id, meta_campaign_id, structure [CBO],
                   budget_daily_cents, status, idempotency_key, launched_at)

ads               (id, campaign_id, user_id, creative_id, meta_ad_id,
                   primary_text, headline, description, cta_type, copy_json)

metrics           (id, ad_id, user_id, date, spend_cents int, results int,
                   cpa_cents int, impressions int, ctr numeric(6,4),
                   roas numeric(8,4), fetched_at)

orders            (id, product_id, user_id, customer_name, phone, address,
                   city, qty, total_cents, status, created_at)
                  -- status enum: PENDING | CONTACTED | DELIVERED | CANCELLED

idempotency_keys  (key PRIMARY KEY, user_id, created_at, expires_at)
```

Multi-tenant: `withUser(userId)` query builder wrapper obligatorio. Lint rule: import `db` directo fuera de `withUser` → error.

## 3. Encryption

- `pgcrypto` extension via raw SQL migration.
- `pgp_sym_encrypt(plaintext, ENCRYPTION_KEY)` symmetric.
- Decrypt solo en Server Actions con `requireUser()` verified.
- Validación tokens al guardar:
  - Meta: `GET /me/adaccounts?access_token=X` debe contener `act_id` pegado. Resolver `pixel_id` vía `GET /act_{id}/adspixels` (primer pixel activo) y persistir en `extra`.
  - Shopify: `GET /admin/api/2024-10/shop.json` retorna shop info → `shop_domain` derivado de respuesta y persistido en `extra` (no se pide al user).
  - Token inválido → reject form con mensaje + deep-link.

## 4. Trigger.dev tasks

```
scrapeProduct           → Pipeline secuencial single task, emite progress events:
                          1. extractKeywords: agente LLM con tool fetch URL.
                             Output { businessInfo, keywords[3-7], category }.
                          2. findAds: meta.adLibrarySearch con META_AD_LIBRARY_TOKEN.
                             Fallback apify.searchFBAdsByKeywords si Meta da
                             0 / error / rate limit. Persist 20 en creatives.
                          3. transcribeAds: download video desde scrape_url
                             (FB CDN URLs expiran) → upload UploadThing → persist
                             assets row kind=original_video. Whisper API
                             verbose_json (chunk si > 25MB). Persist
                             creatives.transcript_text + language.
                          4. classifyAngles: single LLM call batch los 20
                             transcripts → 20 angle labels. Persist.
                          Si ambos providers dan 0 → status SCRAPE_EMPTY.
                          Idempotency: scrape_${productId}_${attempt}.

translateAndBurnSubs    → Trigger por creative selected. Pipeline: read
                          transcript_text + language → si language !== 'es'
                          translate transcript a ES-PE (LLM) → genera SRT →
                          download original video → ffmpeg burn subs (libass +
                          DejaVu Sans) + H.264 CRF 23 → upload UploadThing →
                          persist assets edited_video + srt.
                          Sin crop, sin speed.
                          Machine large-1x. Idempotency: burn_${creativeId}_${attempt}.

publishLanding          → LLM picker: input { name, category } → output
                          template_id ∈ {1,2,3}. Persist products.shopify_template_id.
                          Shopify Admin API: product create con bundles 1/2/3
                          variants + page create + PUT JSON template asset
                          con content overrides (texts, video_urls, price,
                          product_image_url, whatsapp_number, pixel_id).
                          Form COD custom embebido en template render Pixel
                          script con CSP whitelist.
                          Idempotency: publish_${productId}_${attempt}.

launchCampaign          → Meta REST wrapper en orden:
                          1. videoUploadResumable (start/transfer/finish)
                          2. imageUpload (product image)
                          3. creativeCreate (object_story_spec + video_data)
                          4. campaignCreate (OUTCOME_SALES, CBO)
                          5. adsetCreate (Advantage+, targeting, daily budget,
                             promoted_object.pixel_id desde integrations.extra)
                          6. adCreate (1 por selected creative, copy LLM por
                             ángulo persistida en ads.copy_json)
                          Status final: PAUSED.
                          Idempotency: launch_${userId}_${productId}_${attempt}.

syncInsights (manual)   → GET /insights por campaign/adset/ad → metrics table.
                          Trigger manual desde dashboard (botón refresh).
```

Cada task emite eventos (`started`, `progress`, `completed`, `failed`) → UI dashboard live status.

Token expiration: wrapper Meta detecta `(#190) Session has expired` → marca `integrations.expires_at` → UI modal banner "renueva token Meta" + deep-link.

## 5. Module contracts

### `src/db/zod.ts`

```ts
export const Product = selectProductSchema
export const ProductInsert = insertProductSchema
// idem para Creative, Asset, Campaign, Ad, Metric, Order, Integration

export const EncryptedExtraJson = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("shopify"), shop_domain: z.string() }),
  z.object({ provider: z.literal("meta"), ad_account_id: z.string(), page_id: z.string(), pixel_id: z.string() }),
])
export const CopyJson = z.object({
  primary_text: z.string(), headline: z.string(), description: z.string()
})
```

### `src/db/client.ts`

```ts
export const db = drizzle(neon(process.env.DATABASE_URL!))
export function withUser<T>(userId: string, fn: (db: TenantDB) => T): T
```

### `src/lib/meta/`

```ts
export async function adLibrarySearch(query: { searchTerms: string, countries?: string[], limit?: number }): Promise<AdLibraryResult[]>
export async function accountsList(creds): Promise<MetaAccount[]>
export async function campaignCreate(creds, input: CampaignCreateInput): Promise<Campaign>
export async function campaignList(creds, filter): Promise<Campaign[]>
export async function adsetCreate(creds, input: AdSetCreateInput): Promise<AdSet>
export async function creativeCreate(creds, input: CreativeCreateInput): Promise<Creative>
export async function adCreate(creds, input: AdCreateInput): Promise<Ad>
export async function videoUploadResumable(creds, file): Promise<{ video_id: string }>
export async function imageUpload(creds, file): Promise<{ image_hash: string }>
export async function insightsGet(creds, filter): Promise<Insight[]>

export type MetaError = { code: number, fbtrace_id: string, friendly: string }
export async function pixelsList(creds): Promise<{ id: string, name: string }[]>  // usado en validateToken para resolver pixel_id
```

### `src/lib/shopify/`

```ts
export async function validateToken(creds): Promise<ShopInfo>
export async function publishProduct(creds, p: ProductInsert): Promise<{ shopify_product_id, shopify_page_handle }>
export async function applyTemplate(creds, themeId: string, key: string, content: object): Promise<void>  // PUT /admin/api/2024-10/themes/{themeId}/assets.json, key="templates/page.{handle}.json"
```

### `src/lib/apify/`

```ts
export async function searchFBAdsByKeywords(keywords: string[]): Promise<RawCreative[]>
```

### `src/lib/agent/scrape/`

```ts
export async function extractKeywords(competitorUrl: string): Promise<{ businessInfo: string, keywords: string[], category: string }>
```

### `src/lib/video/`

```ts
export async function transcribe(videoUrl): Promise<{ text: string, language: string, srt: string }>
export async function translateSrt(srt, targetLang: string): Promise<string>
export async function burnSubs(videoUrl, srt): Promise<{ editedUrl: string }>
```

### JIT credentials Server Action contract

```ts
type ActionResult<T> = { ok: true, data: T } | { ok: false, needs: 'meta' | 'shopify', error?: string }
```

Cliente abre `<CredentialsModal provider={needs} />` cuando `ok: false`, reintenta acción al save.

### Pixel Purchase ownership

- Landing 100% en Shopify (`<shop>.myshopify.com/pages/{handle}`). Shopify template embebe `<script>` que: (1) `fetch` POST a `https://replik.app/api/orders` con form data, (2) on 200 dispara `fbq('track', 'Purchase', { value, currency })`, (3) redirect WhatsApp.
- `pixel_id` leído de `integrations.encrypted_extra_json` (Meta provider) e inyectado en template render-time.
- API route `/api/orders`: público, CORS whitelist `*.myshopify.com`, Zod valida, `product_id` resuelto vía `shopify_page_handle` lookup, persiste `orders`.
- CSP whitelist `connect.facebook.net` en template `<head>`.

