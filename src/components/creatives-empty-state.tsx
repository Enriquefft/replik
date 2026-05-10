"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { AlertCircle, Loader2, Pencil, RotateCw, VolumeX, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { ErrorCard } from "@/components/ui/error-card.tsx"
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form.tsx"
import { Input } from "@/components/ui/input.tsx"
import { scrapeReasonCopy } from "@/lib/scrape-reason.ts"
import type { ProductId } from "@/lib/types/ids.ts"
import { retryScrape } from "@/server/actions/products.ts"

interface EmptyStateProps {
  productId: ProductId
  sourceUrl: string
  scrapeReason: string | null
  total: number
  withTranscript: number
}

const EditUrlSchema = z.object({
  newUrl: z.url("Debe ser una URL válida"),
})

type EditUrlInput = z.infer<typeof EditUrlSchema>

interface ResolvedCopy {
  title: string
  detail: string
  hint?: string
}

/**
 * Resolve the empty-state copy from the priority-ordered branches:
 *
 *   1. `total === 0`   → no creatives at all (scrape returned nothing).
 *   2. `total > 0 && withTranscript === 0` → creatives exist but every
 *      transcribe attempt failed (oversize, fetch_failed, whisper_failed)
 *      or was suppressed pre-burn — user got nothing usable.
 *   3. fallback → defer to `scrapeReasonCopy(scrapeReason, sourceUrl)`.
 *
 * Branch (2) is the silent-suppression case the persona pays for and never
 * sees — surfacing it explicitly is the whole point of this component.
 */
function resolveCopy(
  total: number,
  withTranscript: number,
  scrapeReason: string | null,
  sourceUrl: string,
): ResolvedCopy {
  if (total === 0) {
    return {
      title: "No encontramos anuncios",
      detail:
        "El competidor no tiene anuncios visibles en Meta Ad Library, o no logramos extraerlos. Reintenta o cambia la URL.",
    }
  }
  if (withTranscript === 0) {
    return {
      title: `Encontramos ${total.toString()} anuncios pero ninguno tenía audio transcribible`,
      detail:
        "Probable: videos sin audio, o todos fallaron en transcripción. Reintenta para volver a procesarlos.",
      hint: "Si el problema persiste, prueba con un competidor cuyo formato de anuncios incluya voz hablada en español o inglés.",
    }
  }
  const fallback = scrapeReasonCopy(scrapeReason, sourceUrl)
  // Spread to preserve optional `hint` correctly under
  // `exactOptionalPropertyTypes`: copying `hint: fallback.hint` would assign
  // `undefined` to an optional field, which TS rejects.
  return fallback.hint === undefined
    ? { title: fallback.title, detail: fallback.detail }
    : { title: fallback.title, detail: fallback.detail, hint: fallback.hint }
}

export function CreativesEmptyState({
  productId,
  sourceUrl,
  scrapeReason,
  total,
  withTranscript,
}: EmptyStateProps) {
  const router = useRouter()
  const [isRetrying, startRetry] = useTransition()
  const [editing, setEditing] = useState(false)

  const copy = resolveCopy(total, withTranscript, scrapeReason, sourceUrl)
  const icon = total > 0 && withTranscript === 0 ? VolumeX : AlertCircle

  const form = useForm<EditUrlInput>({
    resolver: zodResolver(EditUrlSchema),
    defaultValues: { newUrl: sourceUrl },
  })

  const onRetry = useCallback(() => {
    startRetry(async () => {
      const result = await retryScrape({ productId })
      if (!result.ok) {
        toast.error(result.error ?? "No se pudo reintentar el análisis.")
        return
      }
      router.refresh()
    })
  }, [productId, router])

  const onSubmitNewUrl = useCallback(
    async (values: EditUrlInput) => {
      const result = await retryScrape({ productId, newUrl: values.newUrl })
      if (!result.ok) {
        form.setError("newUrl", { type: "manual", message: result.error ?? "URL inválida." })
        return
      }
      setEditing(false)
      router.refresh()
    },
    [productId, router, form],
  )

  return (
    <div className="min-h-[calc(100vh-56px)] bg-page flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg flex flex-col gap-3">
        <ErrorCard
          title={copy.title}
          detail={copy.detail}
          icon={icon}
          primary={{
            label: "Reintentar con la misma URL",
            onClick: onRetry,
            disabled: isRetrying,
            icon: isRetrying ? (
              <Loader2 className="size-4 animate-spin mr-2" />
            ) : (
              <RotateCw className="size-4 mr-2" />
            ),
          }}
          secondary={{
            label: editing ? "Cancelar" : "Cambiar URL",
            onClick: () => {
              setEditing((prev) => !prev)
            },
            icon: editing ? <X className="size-4 mr-2" /> : <Pencil className="size-4 mr-2" />,
          }}
        />

        <div className="rounded-card bg-surface glass shadow-card border border-border p-4 flex flex-col gap-3">
          <div>
            <p className="text-caption font-semibold uppercase tracking-wide text-fg-3 mb-1">
              URL analizada
            </p>
            <p className="text-caption font-mono text-fg-2 break-all" title={sourceUrl}>
              {sourceUrl}
            </p>
          </div>

          {copy.hint !== undefined ? <p className="text-caption text-fg-3">{copy.hint}</p> : null}

          {editing ? (
            <Form {...form}>
              <form
                onSubmit={(e) => {
                  void form.handleSubmit(onSubmitNewUrl)(e)
                }}
                className="flex flex-col gap-2"
              >
                <FormField
                  control={form.control}
                  name="newUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          placeholder="https://tienda.com/products/producto"
                          {...field}
                          value={field.value ?? ""}
                          autoFocus
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <button
                  type="submit"
                  disabled={form.formState.isSubmitting}
                  aria-busy={form.formState.isSubmitting}
                  className="inline-flex items-center justify-center h-9 rounded-pill bg-mode-live text-white text-caption font-semibold px-4 hover:opacity-90 transition disabled:opacity-50 cursor-pointer"
                >
                  {form.formState.isSubmitting ? (
                    <Loader2 className="size-4 animate-spin mr-2" />
                  ) : (
                    <RotateCw className="size-4 mr-2" />
                  )}
                  Reintentar con esta URL
                </button>
              </form>
            </Form>
          ) : null}
        </div>
      </div>
    </div>
  )
}
