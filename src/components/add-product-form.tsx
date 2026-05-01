"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Link2, Loader2, Package, Phone } from "lucide-react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { Button } from "@/components/ui/button.tsx"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form.tsx"
import { Input } from "@/components/ui/input.tsx"
import { SolesToCentsSchema } from "@/lib/pricing.ts"
import { createProduct } from "@/server/actions/products.ts"
import { validateUrl } from "@/server/actions/url-probe.ts"

const AddProductSchema = z.object({
  source_url: z.url("Debe ser una URL válida"),
  pricing: SolesToCentsSchema,
  whatsapp_number: z.string().min(7, "Número inválido").optional(),
})

type AddProductFormInput = z.input<typeof AddProductSchema>
type AddProductFormOutput = z.output<typeof AddProductSchema>

interface AddProductFormProps {
  initialWhatsapp?: string | null
}

export function AddProductForm({ initialWhatsapp }: AddProductFormProps) {
  const router = useRouter()
  const needsWhatsapp = !initialWhatsapp

  const form = useForm<AddProductFormInput, unknown, AddProductFormOutput>({
    resolver: zodResolver(AddProductSchema),
    defaultValues: {
      source_url: "",
      pricing: Number.NaN,
      ...(initialWhatsapp !== null && initialWhatsapp !== undefined
        ? { whatsapp_number: initialWhatsapp }
        : {}),
    },
  })

  async function onSubmit(values: AddProductFormOutput) {
    const probe = await validateUrl(values.source_url)
    if (!probe.ok) {
      form.setError("source_url", { type: "manual", message: probe.error ?? "URL inválida." })
      return
    }
    const result = await createProduct({
      source_url: probe.data.finalUrl,
      pricing_cents: values.pricing,
      ...(values.whatsapp_number !== undefined && { whatsapp_number: values.whatsapp_number }),
    })
    if (!result.ok) {
      toast.error(result.error ?? "Error al crear el producto.")
      return
    }
    router.push(`/products/${result.data.id}`)
  }

  // Three click-to-fill examples. Pick the URL of a SPECIFIC product page, not
  // a collection or homepage — Stage A's JSON-LD/og:* extractors only fire on
  // product pages. If any of these URLs goes stale, swap it for another active
  // public storefront.
  const EXAMPLE_URLS: readonly string[] = [
    "https://www.allbirds.com/products/mens-tree-runners",
    "https://us.gymshark.com/products/gymshark-arrival-shorts-charcoal-aw21",
    "https://www.bombas.com/products/originals-ankle-sock-women-4-pack-mixed-pack",
  ]

  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col gap-4">
      {/* Header card */}
      <div className="rounded-card bg-surface glass shadow-card border border-border p-6">
        <p className="text-caption font-semibold uppercase tracking-widest text-mode-web-badge-fg">
          Paso 1 · Cuéntame del producto
        </p>
        <h1 className="text-display mt-2">¿Qué vas a testear hoy?</h1>
        <p className="text-body text-fg-2 mt-2 leading-relaxed">
          Pega el link de un competidor en Shopify — yo lo analizo y te armo los creativos, la
          landing y la campaña.
        </p>
      </div>

      {/* Form card */}
      <div className="rounded-card bg-surface glass shadow-card border border-border p-6">
        <Form {...form}>
          <form
            onSubmit={(e) => {
              void form.handleSubmit(onSubmit)(e)
            }}
            className="flex flex-col gap-5"
          >
            {/* URL field */}
            <FormField
              control={form.control}
              name="source_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1.5">
                    <Link2 className="size-3.5 text-fg-2" strokeWidth={1.8} />
                    URL del competidor
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://tienda.com/products/producto"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormDescription>
                    <span className="text-caption text-fg-3 font-semibold uppercase tracking-wide">
                      Ejemplos:{" "}
                    </span>
                    {EXAMPLE_URLS.map((url) => {
                      const host = new URL(url).host.replace(/^www\./, "")
                      return (
                        <button
                          key={url}
                          type="button"
                          onClick={() => {
                            form.setValue("source_url", url, { shouldValidate: true })
                          }}
                          className="inline-flex items-center h-6 px-2 rounded-pill bg-surface-elevated border border-border text-caption text-fg-2 font-mono hover:text-fg-1 transition-colors ml-1 cursor-pointer"
                        >
                          {host}
                        </button>
                      )
                    })}
                    <br />
                    <span className="text-caption text-fg-3">
                      Tip: pega la URL de un producto individual, no de la colección.
                    </span>
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Pricing */}
            <FormField
              control={form.control}
              name="pricing"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1.5">
                    <Package className="size-3.5 text-fg-2" strokeWidth={1.8} />
                    Precio por unidad (S/)
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0.01}
                      step={0.01}
                      placeholder="79.90"
                      {...field}
                      value={Number.isNaN(field.value) ? "" : field.value}
                      onChange={(e) => {
                        field.onChange(e.target.valueAsNumber)
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    Los precios de Pack × 2 y Pack × 3 los configuras al publicar la landing.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* WhatsApp — only if not set */}
            {needsWhatsapp && (
              <FormField
                control={form.control}
                name="whatsapp_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1.5">
                      <Phone className="size-3.5 text-fg-2" strokeWidth={1.8} />
                      Tu WhatsApp (para pedidos COD)
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="+51 999 999 999" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormDescription>
                      Los clientes serán redirigidos aquí al ordenar.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <Button
              type="submit"
              size="lg"
              className="w-full mt-2"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : null}
              Analizar y crear campaña
            </Button>
          </form>
        </Form>
      </div>
    </div>
  )
}
