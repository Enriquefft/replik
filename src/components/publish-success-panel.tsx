"use client"

import { Copy, ExternalLink, MessageCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button.tsx"

interface PublishSuccessPanelProps {
  url: string
}

/**
 * Post-publish success surface — renders the merchant's live storefront URL
 * with three calls to action: open, copy, share via WhatsApp.
 *
 * Reused on both the publish wait surface (via `PhaseProgress.detailSlot`)
 * and the product-detail page, so post-publish discovery is consistent
 * whether the merchant just finished or is coming back days later.
 */
export function PublishSuccessPanel({ url }: PublishSuccessPanelProps) {
  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(`Mira mi nuevo producto: ${url}`)}`

  function handleCopy() {
    void navigator.clipboard
      .writeText(url)
      .then(() => toast.success("Enlace copiado"))
      .catch(() => toast.error("No se pudo copiar el enlace"))
  }

  return (
    <div className="rounded-card border border-border bg-surface p-4 flex flex-col gap-3">
      <div>
        <p className="text-callout font-semibold text-fg-1">Tu landing está publicada</p>
        <p className="text-caption text-fg-2 mt-0.5">
          Comparte este enlace con tus clientes para empezar a vender.
        </p>
      </div>
      <code className="block rounded-control bg-surface-muted px-3 py-2 text-caption text-fg-1 font-mono truncate">
        {url}
      </code>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Button asChild size="sm" className="bg-mode-web text-fg-on-accent hover:bg-mode-web/90">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-3.5 mr-1.5" strokeWidth={1.8} />
            Abrir landing
          </a>
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={handleCopy}>
          <Copy className="size-3.5 mr-1.5" strokeWidth={1.8} />
          Copiar enlace
        </Button>
        <Button asChild size="sm" variant="outline">
          <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="size-3.5 mr-1.5" strokeWidth={1.8} />
            WhatsApp
          </a>
        </Button>
      </div>
    </div>
  )
}
