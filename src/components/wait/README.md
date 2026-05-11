# Wait-state UX — Submit-Receipt Convention

This directory documents the **submit-receipt convention** used across the app
whenever a Server Action kicks off a long-running Trigger.dev task and the UI
must transition to a wait surface (`<PhaseProgress>`, `<JobsDock>` row, etc.).

This is a **convention**, not a primitive — there is no shared component to
import. The rules below MUST be followed at every submit boundary so users
always see consistent, instant feedback when they hit "Generar", "Lanzar",
"Publicar", or "Sincronizar".

---

## Why this exists

The realtime stream from Trigger.dev has a non-trivial cold-start (token
mint + websocket handshake + first `metadata.set` from the worker). Without
a synchronous, optimistic confirmation, the UI looks frozen for ~1–3 seconds
after the user clicks the primary CTA. That gap erodes trust: users double-
click, hit back, or assume the action failed.

The fix is a **submit receipt**: a `sonner` toast fired **before** the route
change / wait-surface mount, acknowledging that the run was accepted and
giving the user a coherent next step ("Generando creativos…").

---

## The rules

For every Server Action that calls `tasks.trigger(...)` and transitions the UI
to a wait surface:

### 1. Server Action returns a discriminated result

```ts
type Result =
  | { ok: true; data: { runId: string; accessToken: string } }
  | { ok: false; needs: "meta" | "shopify" }
  | { ok: false; error: string }
```

Never throw on user-correctable errors. The client needs the discriminant
to render the right recovery affordance (toast for transient, CTA for
"needs integration", inline form error for validation).

### 2. Client fires a sonner toast **before** routing / state-flip

Use the **present-progressive** Spanish verb that matches what the user
will see on the wait surface. Examples:

| CTA                  | Toast copy                  |
| -------------------- | --------------------------- |
| "Agregar producto"   | "Analizando producto…"      |
| "Generar landing"    | "Generando landing…"        |
| "Lanzar campaña"     | "Lanzando campaña…"         |
| "Sincronizar"        | "Sincronizando métricas…"   |
| "Generar creativos"  | "Procesando creativos…"     |

Always use `toast.success(...)` (not `toast.info`) — the action **succeeded**
from the user's perspective; the long-running work is implementation detail.

### 3. Toast fires **before** `router.push` / `router.refresh`

```ts
const result = await launchCampaign(productId)
if (!result.ok) {
  toast.error(result.error ?? "Error al lanzar la campaña.")
  return
}
toast.success("Lanzando campaña…")          // ← BEFORE the route change
router.push(`/products/${productId}/launching`)
```

Order matters: sonner's portal renders on the **current** route. If the
push fires first, the toast may flash on the destination route or be
swallowed by the unmount.

### 4. Failure mode is a `toast.error(...)` on the same surface

If the action returns `{ ok: false }`, render the recovery affordance
**without** navigating away. The user is still on the submit surface; the
toast tells them what went wrong; the CTA stays active so they can retry
once the prerequisite is fixed.

### 5. Wait surface assumes the toast has fired

The wait surface (`<PhaseProgress>`) starts in `queued` or `executing`
state with no metadata. It MUST NOT show a "Iniciando…" placeholder of
its own — that's the toast's job. The wait surface's first visible state
is the phase rail with the first phase in `active`.

---

## Anti-patterns

- **Optimistic UI without a receipt.** Flipping a card to "Procesando…"
  in-place feels laggy because the user can't tell if their click
  registered. Always emit the toast.

- **`toast.loading(...)` for short waits.** `loading` toasts imply
  "you're blocked here until this finishes". Our waits are async and
  the user can navigate freely; `toast.success` with present-progressive
  copy is correct.

- **Multiple toasts per submit.** One submit = one receipt. If a server
  action fans out into multiple tasks, the receipt describes the
  user-visible outcome ("Procesando creativos…"), not the internal
  task graph.

- **English copy.** All user-facing strings are Spanish (LatAm). No
  exceptions on the submit-receipt path.

---

## Where this convention is enforced

There is no lint rule for this — it lives in code review and the per-route
client components under `src/app/.../*-client.tsx`. Search for
`tasks.trigger` call sites in `src/server/actions/` and verify each one
has a corresponding `toast.success(...)` on the client before the route
change.

Current submit-receipt boundaries:

- `src/app/page.tsx` → `add-product-form.tsx` → `createProduct` → scrape task
- `src/app/products/[id]/creatives-client.tsx` → `selectCreatives` → rehost task
- `src/app/products/[id]/landing/landing-client.tsx` → `publishLanding` → publish task
- `src/app/products/[id]/launch/launch-client.tsx` → `launchCampaign` → launch task
- `src/app/dashboard/dashboard-client.tsx` → `refreshInsights` → sync-insights task
