"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, Pencil, RotateCw, X } from "lucide-react"
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

interface RetryScrapeCardProps {
  productId: ProductId
  sourceUrl: string
  reason: string | null
}

const EditUrlSchema = z.object({
  newUrl: z.url("Debe ser una URL válida"),
})

type EditUrlInput = z.infer<typeof EditUrlSchema>

export function RetryScrapeCard({ productId, sourceUrl, reason }: RetryScrapeCardProps) {
  const router = useRouter()
  const [isRetrying, startRetry] = useTransition()
  const [editing, setEditing] = useState(false)

  const copy = scrapeReasonCopy(reason, sourceUrl)

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
