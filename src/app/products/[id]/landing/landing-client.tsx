"use client"

import { Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import * as React from "react"
import { toast } from "sonner"
import type { ChatMessage } from "@/components/chat-panel.tsx"
import { ChatPanel } from "@/components/chat-panel.tsx"
import { CredentialsModal } from "@/components/credentials-modal.tsx"
import { IphonePreview } from "@/components/iphone-preview.tsx"
import { TaskProgress } from "@/components/task-progress.tsx"
import { TemplateCard } from "@/components/template-card.tsx"
import { Button } from "@/components/ui/button.tsx"
import type { TemplateMeta } from "@/lib/shopify/templates/index.ts"
import { publishLanding } from "@/server/actions/landing.ts"
import { adjustLandingCopy } from "@/server/actions/products.ts"

interface LandingClientProps {
  productId: string
  templates: readonly TemplateMeta[]
  productName: string
  pricingCents: number
  bundle2PricingCents: number
  bundle3PricingCents: number
}

function formatPrice(cents: number): string {
  return `S/ ${(cents / 100).toFixed(0)}`
}

export function LandingClient({
  productId,
  templates,
  productName,
  pricingCents,
  bundle2PricingCents,
  bundle3PricingCents,
}: LandingClientProps) {
  const router = useRouter()
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<number>(templates[0]?.id ?? 1)
  const [overrides, setOverrides] = React.useState<{
    headline?: string
    subheadline?: string
  }>({})
  const [messages, setMessages] = React.useState<ChatMessage[]>([
    {
      id: "init-0",
      from: "replik",
      text: `¡Hola! Te armé 3 templates basados en los videos que escogiste para "${productName}". ¿Cuál se siente mejor?`,
    },
  ])
  const [chatPending, setChatPending] = React.useState(false)
  const [publishing, setPublishing] = React.useState(false)
  const [runId, setRunId] = React.useState<string | null>(null)
  const [credModalOpen, setCredModalOpen] = React.useState(false)
  const [credError, setCredError] = React.useState<string | undefined>()

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? templates[0]

  const headline = overrides.headline ?? selectedTemplate?.headline ?? ""
  const subheadline = overrides.subheadline ?? selectedTemplate?.subheadline ?? ""

  async function handleChat(text: string) {
    setChatPending(true)
    setMessages((prev) => [...prev, { id: `user-${Date.now()}`, from: "user", text }])

    const result = await adjustLandingCopy(productId, text)

    if (result.ok && (result.data.headline ?? result.data.subheadline)) {
      setOverrides((prev) => ({ ...prev, ...result.data }))
      setMessages((prev) => [
        ...prev,
        {
          id: `replik-${Date.now()}`,
          from: "replik",
          text: "¡Listo! Mira el preview a la derecha. ¿Algo más que cambiar?",
        },
      ])
    } else {
      setMessages((prev) => [
        ...prev,
        {
          id: `replik-${Date.now()}`,
          from: "replik",
          text: "Entendido. Puedo ajustar el título, subtítulo o el template. ¿Qué quieres cambiar?",
        },
      ])
    }
    setChatPending(false)
  }

  async function handlePublish() {
    setPublishing(true)
    const result = await publishLanding({
      productId,
      templateId: selectedTemplateId as 1 | 2 | 3,
      overrides,
    })
    setPublishing(false)

    if (!result.ok) {
      if (result.needs === "shopify") {
        setCredError(result.error)
        setCredModalOpen(true)
        return
      }
      toast.error(result.error ?? "Error al publicar.")
      return
    }

    setRunId(result.data.runId)
    toast.success("¡Publicación iniciada!")
  }

  function handleCredSaved() {
    setCredModalOpen(false)
    setCredError(undefined)
    // Retry publish
    void handlePublish()
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 items-start">
      {/* Left: template picker + chat */}
      <div className="flex flex-col gap-5">
        {/* Template grid */}
        <div className="grid grid-cols-3 gap-3">
          {templates.map((tpl) => (
            <TemplateCard
              key={tpl.id}
              template={tpl}
              selected={tpl.id === selectedTemplateId}
              onSelect={() => {
                setSelectedTemplateId(tpl.id)
              }}
            />
          ))}
        </div>

        {/* Chat panel */}
        <ChatPanel messages={messages} onSend={handleChat} pending={chatPending} />

        {/* Bundle pricing preview */}
        <div className="rounded-card bg-surface glass border border-border shadow-tight p-4">
          <p className="text-callout font-semibold text-fg-1 mb-3">Packs configurados</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "1 unidad", price: pricingCents },
              { label: "Pack × 2", price: bundle2PricingCents },
              { label: "Pack × 3", price: bundle3PricingCents },
            ].map((pack) => (
              <div key={pack.label} className="rounded-control bg-surface-muted p-3 text-center">
                <p className="text-caption text-fg-2 mb-1">{pack.label}</p>
                <p className="text-headline font-semibold text-fg-1">{formatPrice(pack.price)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Publish button */}
        {runId ? (
          <TaskProgress
            runId={runId}
            step="Publicando landing en Shopify…"
            detail="Creando producto + página + aplicando template"
          />
        ) : (
          <Button
            size="lg"
            className="w-full bg-mode-web text-fg-on-accent hover:bg-mode-web/90"
            onClick={() => void handlePublish()}
            disabled={publishing}
          >
            {publishing ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
            Publicar landing en Shopify
          </Button>
        )}

        {/* Continue to launch */}
        {runId && (
          <Button
            variant="outline"
            size="lg"
            className="w-full"
            onClick={() => {
              router.push(`/products/${productId}/launch`)
            }}
          >
            Continuar → Lanzar campaña
          </Button>
        )}
      </div>

      {/* Right: iPhone preview */}
      <div className="hidden lg:flex flex-col gap-4">
        <p className="text-callout font-semibold text-fg-1 text-center">Vista previa</p>
        <IphonePreview>
          <div className="px-4 py-6 flex flex-col gap-4">
            {/* Product name */}
            <div
              className="rounded-control p-4"
              style={{
                background:
                  selectedTemplateId === 1
                    ? "linear-gradient(135deg, #fee2e2, #fde68a)"
                    : selectedTemplateId === 2
                      ? "linear-gradient(135deg, #fef3c7, #a7f3d0)"
                      : "linear-gradient(135deg, #bfdbfe, #ddd6fe)",
              }}
            >
              <p className="text-sm font-bold leading-tight" style={{ fontSize: 14 }}>
                {headline || productName}
              </p>
              {subheadline && <p className="text-[11px] mt-1 opacity-80">{subheadline}</p>}
            </div>

            {/* Bundles */}
            <div className="flex flex-col gap-2">
              {[
                {
                  label: "1 unidad",
                  price: pricingCents,
                  badge: null,
                },
                {
                  label: "Pack × 2",
                  price: bundle2PricingCents,
                  badge: "Ahorra 15%",
                },
                {
                  label: "Pack × 3",
                  price: bundle3PricingCents,
                  badge: "Más popular",
                },
              ].map((pack) => (
                <div
                  key={pack.label}
                  className="flex items-center justify-between rounded-lg border px-3 py-2"
                  style={{
                    background: "rgba(255,255,255,0.7)",
                    borderColor: "rgba(0,0,0,0.06)",
                    fontSize: 12,
                  }}
                >
                  <span className="font-medium">{pack.label}</span>
                  <span className="font-semibold">{formatPrice(pack.price)}</span>
                </div>
              ))}
            </div>

            {/* CTA */}
            <button
              type="button"
              className="w-full rounded-lg py-2.5 text-white text-sm font-semibold"
              style={{
                background:
                  selectedTemplateId === 1
                    ? "#ff453a"
                    : selectedTemplateId === 2
                      ? "#ff9f0a"
                      : "#0a84ff",
                fontSize: 13,
              }}
            >
              Ordenar ahora
            </button>
          </div>
        </IphonePreview>
      </div>

      {/* Credentials modal */}
      <CredentialsModal
        open={credModalOpen}
        onOpenChange={setCredModalOpen}
        provider="shopify"
        onSaved={handleCredSaved}
        {...(credError !== undefined && { errorMessage: credError })}
      />
    </div>
  )
}
