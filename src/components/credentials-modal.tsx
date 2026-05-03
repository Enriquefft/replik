"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { ExternalLink, Loader2 } from "lucide-react"
import * as React from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { Button } from "@/components/ui/button.tsx"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx"
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
import { saveMetaIntegration } from "@/server/actions/integrations.ts"
import { startShopifyOAuth } from "@/server/actions/shopify-oauth.ts"

// --- Shopify form (OAuth — domain only; token comes via callback) ---
const ShopifySchema = z.object({
  shop_domain: z.string().min(3, "Dominio inválido"),
})
type ShopifyFormValues = z.infer<typeof ShopifySchema>

// --- Meta form ---
const MetaSchema = z.object({
  provider: z.literal("meta"),
  token: z.string().min(10, "Token demasiado corto"),
  ad_account_id: z.string().min(1, "Requerido"),
  page_id: z.string().min(1, "Requerido"),
})
type MetaFormValues = z.infer<typeof MetaSchema>

interface CredentialsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: "meta" | "shopify"
  onSaved: () => void
  errorMessage?: string
}

function ShopifyForm({ onError }: { onError: (msg: string) => void }) {
  const form = useForm<ShopifyFormValues>({
    resolver: zodResolver(ShopifySchema),
    defaultValues: { shop_domain: "" },
  })

  async function onSubmit(values: ShopifyFormValues) {
    const result = await startShopifyOAuth({ shop_domain: values.shop_domain })
    if (result.ok) {
      window.location.href = result.data.authorizeUrl
      return
    }
    onError(result.error ?? "No se pudo iniciar la conexión.")
  }

  return (
    <Form {...form}>
      <form
        onSubmit={(e) => {
          void form.handleSubmit(onSubmit)(e)
        }}
        className="flex flex-col gap-4"
      >
        <FormField
          control={form.control}
          name="shop_domain"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Dominio de tu tienda</FormLabel>
              <FormControl>
                <Input placeholder="mitienda.myshopify.com" {...field} />
              </FormControl>
              <FormDescription>
                Te llevaremos al panel de Shopify para autorizar la app.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full mt-2" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
          Conectar Shopify
        </Button>
      </form>
    </Form>
  )
}

function MetaForm({ onSaved, onError }: { onSaved: () => void; onError: (msg: string) => void }) {
  const form = useForm<MetaFormValues>({
    resolver: zodResolver(MetaSchema),
    defaultValues: {
      provider: "meta",
      token: "",
      ad_account_id: "",
      page_id: "",
    },
  })

  async function onSubmit(values: MetaFormValues) {
    const result = await saveMetaIntegration(values)
    if (result.ok) {
      onSaved()
    } else {
      onError(result.error ?? "Error al guardar. Intenta de nuevo.")
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={(e) => {
          void form.handleSubmit(onSubmit)(e)
        }}
        className="flex flex-col gap-4"
      >
        <FormField
          control={form.control}
          name="token"
          render={({ field }) => (
            <FormItem>
              <FormLabel>User Access Token</FormLabel>
              <FormControl>
                <Input type="password" placeholder="EAAxxxxx..." {...field} />
              </FormControl>
              <FormDescription>
                <a
                  href="https://business.facebook.com/settings/system-users"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-mode-live hover:underline"
                >
                  Business Manager → Usuarios del sistema <ExternalLink className="size-3" />
                </a>
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="ad_account_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Ad Account ID</FormLabel>
              <FormControl>
                <Input placeholder="act_123456789" {...field} />
              </FormControl>
              <FormDescription>Formato: act_XXXXXXXXX</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="page_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Facebook Page ID</FormLabel>
              <FormControl>
                <Input placeholder="123456789" {...field} />
              </FormControl>
              <FormDescription>
                <a
                  href="https://business.facebook.com/settings/pages"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-mode-live hover:underline"
                >
                  Business Manager → Páginas <ExternalLink className="size-3" />
                </a>
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full mt-2" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
          Guardar y validar
        </Button>
      </form>
    </Form>
  )
}

export function CredentialsModal({
  open,
  onOpenChange,
  provider,
  onSaved,
  errorMessage,
}: CredentialsModalProps) {
  const [internalError, setInternalError] = React.useState<string | undefined>()

  const displayError = internalError ?? errorMessage

  const title = provider === "shopify" ? "Conectar Shopify" : "Conectar Meta Ads"
  const description =
    provider === "shopify"
      ? "Ingresa tu dominio de tienda. Te llevaremos a Shopify para autorizar la app."
      : "Ingresa tu token de Meta y datos de la cuenta para lanzar la campaña."

  function handleSaved() {
    setInternalError(undefined)
    onSaved()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {displayError && (
          <div className="rounded-control bg-mode-traffic/10 border border-mode-traffic/20 px-4 py-3 text-sm text-mode-traffic">
            {displayError}
          </div>
        )}

        {provider === "shopify" ? (
          <ShopifyForm onError={setInternalError} />
        ) : (
          <MetaForm onSaved={handleSaved} onError={setInternalError} />
        )}
      </DialogContent>
    </Dialog>
  )
}
