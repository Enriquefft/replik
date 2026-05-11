# Replik AI — Specs

## 1. Producto

A partir de **una URL de competidor**, Replik:

1. Agente scrapea URL → extrae business info + keywords (3-7 terms) + category.
2. Keywords → Meta Ad Library API (`/ads_archive`, server-side `META_AD_LIBRARY_TOKEN` — user access token de un developer con identity verification, persistido como env) → top 20 video ads. Fallback Apify FB Ads actor si Meta da 0 results / error / rate limit.
3. Whisper transcribe los 20 batch (`response_format=verbose_json`, word-level timestamps + language detection).
4. LLM clasifica cada video por "ángulo de venta" — label libre 1-3 palabras (`creatives.angle`, dynamic, sin curated pool).
5. UI lista 20 con angle badge + transcript preview. User selecciona N (default 5).
6. Por seleccionado: si `language !== 'es'` translate transcript → SRT → ffmpeg burn subs (libass + DejaVu Sans ES-PE) → upload UploadThing. Subs siempre on. Sin crop, sin speed.
7. Publish landing en Shopify del user (LLM pick 1 de 3 templates JSON según categoría producto, bundles 1/2/3) — credentials Shopify pedidas via modal JIT.
8. Launch campaña draft Meta Ads (CBO + Advantage+, copy por ángulo, status PAUSED) — credentials Meta full pedidas via modal JIT.
9. Form COD en landing → `orders` table.
10. Cliente final post submit → redirect WhatsApp dropshipper con prefilled message: `Hola, acabo de ordenar {qty}x {product_name}. Mi nombre: {customer_name}. Dirección: {address}, {city}.`
11. Dashboard: métricas + pedidos (refresh manual).

**Mercado:** LATAM, foco Perú. **Idioma:** ES-PE. **Modelo cliente final:** COD.

## 2. Usuario target

Dropshipper LATAM fase testeo:
- Tiene tienda Shopify activa.
- Tiene Meta Business + ad account verificado.
- Tiene WhatsApp para coordinar entregas.

**Ámbito MVP:** 1 usuario. Multi-tenant ready en schema, no en operación.

## 3. Surfaces principales

| Flujo | Surface |
|---|---|
| First-time | Signup Clerk → redirect `/`. Form: URL competidor + 3 precios (single + bundle 2 + bundle 3) + WhatsApp (solo si `users.whatsapp_number` null). Returners → `/dashboard` via nav. |
| Add product | Form en `/`: URL competidor + 3 precios. WhatsApp prefilled de user. |
| Scrape pipeline | Trigger task con status feed live |
| Selección creativos | Form: lista 20 con angle badge + transcript preview, checkboxes |
| Edit videos | Trigger task auto (sin UI toggle) |
| Credentials JIT | Modal abre cuando Server Action retorna `{ ok: false, needs: 'meta'\|'shopify' }` |
| Publish landing | Server Action → Shopify Admin API |
| Launch campaña | Server Action → Meta REST wrapper |
| Form COD (cliente final) | Form en landing |
| Confirmación cliente | Redirect WhatsApp con prefilled message |
| Dashboard | Tabla métricas + pedidos |

## 4. Scope MVP

- Modal JIT credentials Meta + Shopify (screenshots + deep-links embebidos), validación live al save.
- shadcn/ui + Tailwind v4 (migración completa Primitives.jsx en P0).
- Meta Ad Library API search server-side (sin creds del user para scrape).
- Apify FB Ads fallback.
- Whisper batch los 20, transcripts persistidos.
- LLM angle classification dynamic, label libre.
- Translate solo si `language !== 'es'`.
- 3 JSON templates landing pre-construidos. LLM picker selecciona template según categoría producto.
- Form COD custom + Pixel client-side + redirect WhatsApp.
- Bundles 1/2/3 como Shopify product variants.
- CBO + Advantage+ placements.
- Audiencias broad + detailed (static interests dict).
- Hardcoded Spanish error map.

## 5. Manual validation E2E

1. Signup Clerk → redirect `/`.
2. Pegar URL competidor → submit (sin credentials prompt).
3. Scrape: agente extrae keywords → Ad Library devuelve 20 (o Apify fallback).
4. Whisper batch 20 + LLM classify → UI muestra 20 con angle + transcript.
5. Selección 5 → submit. `selected_bool=true`.
6. Edit auto: translate (si non-ES) → SRT → burn → upload. Status feed live.
7. Click "publicar landing" → modal Shopify (form + deep-links + validate live) → save → publish → URL real accesible, form COD funcional, bundles 1/2/3.
8. Submit form COD test → row `orders` + Pixel Purchase fires + redirect WhatsApp con phone correcto.
9. Click "lanzar campaña" → modal Meta (token + ad_account_id + page_id) → save → launch → campaign draft `PAUSED` visible Ads Manager con videos editados + copy + targeting + bundles price.
10. Refresh metrics → insights call retorna data.
11. Dashboard muestra producto, métricas, pedidos.
12. Multi-tenant: segundo user dummy → no ve data del primero.

**Edge cases:**
- URL inválida / 404 → reject.
- Agent extrae 0 keywords → UI fallback "ingresa keywords manual".
- Meta Ad Library 0 / error / rate limit → fallback Apify auto.
- Apify también 0 → status `SCRAPE_EMPTY`.
- Whisper falla → video excluido.
- LLM angle malformado → `angle = 'sin clasificar'`.
- Translate falla → fallback subs idioma original.
- Shopify token inválido → modal vuelve abrir con error + deep-link.
- Meta token expirado mid-flight → modal banner "renueva token" + deep-link.
- Trigger task timeout → idempotency rerun no duplica.
- Re-launch mismo producto → idempotency previene duplicados.
- Customer COD phone inválido → Zod reject.
