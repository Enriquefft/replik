"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { DollarSign, ExternalLink, Loader2, Target } from "lucide-react"
import * as React from "react"
import { useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { CredentialsModal } from "@/components/credentials-modal.tsx"
import { TaskProgress } from "@/components/task-progress.tsx"
import { Badge } from "@/components/ui/badge.tsx"
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
import { launchCampaign } from "@/server/actions/launch.ts"

const LaunchSchema = z.object({
  budget_daily: SolesToCentsSchema,
})

type LaunchFormInput = z.input<typeof LaunchSchema>
type LaunchFormOutput = z.output<typeof LaunchSchema>

const DEFAULT_DAILY_BUDGET_SOLES = 120
const EST_REACH_PER_SOL_PER_WEEK = 7 * 120
const EST_CPA_SOLES = 26

interface SelectedCreative {
  id: string
  angle: string | null
  transcriptText: string | null
}

interface LaunchClientProps {
  productId: string
  productName: string
  pricingCents: number
  bundle2PricingCents: number
  bundle3PricingCents: number
  selectedCreatives: SelectedCreative[]
}

function formatPrice(cents: number): string {
  return `S/ ${(cents / 100).toFixed(0)}`
}

export function LaunchClient({
  productId,
  productName,
  pricingCents,
  bundle2PricingCents,
  bundle3PricingCents,
  selectedCreatives,
}: LaunchClientProps) {
  const [runId, setRunId] = React.useState<string | null>(null)
  const [credModalOpen, setCredModalOpen] = React.useState(false)
  const [credError, setCredError] = React.useState<string | undefined>()

  const form = useForm<LaunchFormInput, unknown, LaunchFormOutput>({
    resolver: zodResolver(LaunchSchema),
    defaultValues: { budget_daily: DEFAULT_DAILY_BUDGET_SOLES },
  })

  async function onSubmit(values: LaunchFormOutput): Promise<void> {
    const result = await launchCampaign({
      productId,
      budgetDailyCents: values.budget_daily,
    })

    if (!result.ok) {
      if (result.needs === "meta") {
        setCredError(result.error)
        setCredModalOpen(true)
        return
      }
      toast.error(result.error ?? "Error al lanzar la campaña.")
      return
    }

    setRunId(result.data.runId)
    toast.success("¡Campaña creada en Meta!")
  }

  function handleCredSaved() {
    setCredModalOpen(false)
    setCredError(undefined)
    void form.handleSubmit(onSubmit)()
  }

  const watchedBudget = useWatch({ control: form.control, name: "budget_daily" })
  const dailyBudgetSoles = Number.isFinite(watchedBudget) && watchedBudget > 0 ? watchedBudget : 0
  const estReach = Math.round(dailyBudgetSoles * EST_REACH_PER_SOL_PER_WEEK)
  const estResults = Math.round((dailyBudgetSoles * 7) / EST_CPA_SOLES)

  return (
    <div className="flex flex-col gap-5">
      {/* Campaign config form */}
      <div className="rounded-card bg-surface glass border border-border shadow-tight p-5">
        <div className="flex items-center gap-2 mb-4">
          <DollarSign className="size-4 text-mode-traffic" strokeWidth={1.8} />
          <h3 className="text-callout font-semibold text-fg-1">Presupuesto diario</h3>
        </div>

        <Form {...form}>
          <form
            onSubmit={(e) => {
              void form.handleSubmit(onSubmit)(e)
            }}
            className="flex flex-col gap-4"
          >
            <FormField
              control={form.control}
              name="budget_daily"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Presupuesto diario (S/)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      placeholder="120"
                      {...field}
                      value={Number.isNaN(field.value) ? "" : field.value}
                      onChange={(e) => {
                        field.onChange(e.target.valueAsNumber)
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    {dailyBudgetSoles > 0
                      ? `S/ ${dailyBudgetSoles.toFixed(0)} / día · ~${String(estResults)} ventas estimadas en 7 días · Alcance ~${estReach.toLocaleString("es-PE")}`
                      : "Ingresa el presupuesto diario"}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Targeting summary (read-only) */}
            <div className="rounded-control bg-surface-muted p-4">
              <div className="flex items-center gap-2 mb-3">
                <Target className="size-4 text-mode-live" strokeWidth={1.8} />
                <p className="text-callout font-semibold text-fg-1">Targeting (CBO + Advantage+)</p>
              </div>
              <div className="flex flex-wrap gap-2 text-caption text-fg-2">
                <span className="inline-flex items-center h-5 px-2 rounded-pill bg-surface-elevated border border-border">
                  🇵🇪 Perú
                </span>
                <span className="inline-flex items-center h-5 px-2 rounded-pill bg-surface-elevated border border-border">
                  Lima + Callao
                </span>
                <span className="inline-flex items-center h-5 px-2 rounded-pill bg-surface-elevated border border-border">
                  24–45 años
                </span>
                <span className="inline-flex items-center h-5 px-2 rounded-pill bg-surface-elevated border border-border">
                  Advantage+ Placements
                </span>
                <span className="inline-flex items-center h-5 px-2 rounded-pill bg-surface-elevated border border-border">
                  OUTCOME_SALES
                </span>
              </div>
            </div>

            {/* Ad copy previews */}
            {selectedCreatives.length > 0 && (
              <div className="rounded-control bg-surface-muted p-4">
                <p className="text-callout font-semibold text-fg-1 mb-3">
                  Copy por anuncio ({selectedCreatives.length} ads)
                </p>
                <div className="flex flex-col gap-2">
                  {selectedCreatives.map((creative) => (
                    <div
                      key={creative.id}
                      className="flex items-start gap-2 p-3 rounded-tight bg-surface-elevated border border-border"
                    >
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        {creative.angle ?? "sin clasificar"}
                      </Badge>
                      <p className="text-caption text-fg-2 line-clamp-2 min-w-0">
                        {creative.transcriptText?.slice(0, 80) ?? "Copy generado por LLM al lanzar"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Bundle pricing */}
            <div className="rounded-control bg-surface-muted p-4">
              <p className="text-callout font-semibold text-fg-1 mb-3">
                Precios de bundles en anuncios
              </p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "1 unidad", price: pricingCents },
                  { label: "Pack × 2", price: bundle2PricingCents },
                  { label: "Pack × 3", price: bundle3PricingCents },
                ].map((pack) => (
                  <div
                    key={pack.label}
                    className="rounded-tight bg-surface-elevated p-2 text-center"
                  >
                    <p className="text-[10px] text-fg-3">{pack.label}</p>
                    <p className="text-callout font-semibold text-fg-1">
                      {formatPrice(pack.price)}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {runId ? (
              <TaskProgress
                runId={runId}
                step="Lanzando campaña en Meta Ads…"
                detail="Video upload → Creative → Campaign → AdSet → Ads"
              />
            ) : (
              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting ? (
                  <Loader2 className="size-4 animate-spin mr-2" />
                ) : null}
                Lanzar campaña (PAUSED)
              </Button>
            )}

            {runId && (
              <a
                href="https://business.facebook.com/adsmanager/manage/campaigns"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 h-9 px-4 rounded-lg border border-border bg-surface text-sm font-medium text-fg-1 hover:bg-surface-muted transition-colors"
              >
                Ver en Ads Manager <ExternalLink className="size-3.5" />
              </a>
            )}

            <p className="text-caption text-fg-3 text-center">
              Campaña creada en estado PAUSED para tu revisión antes de activar.
            </p>
          </form>
        </Form>
      </div>

      {/* Product info */}
      <div className="rounded-card bg-surface glass border border-border shadow-tight p-4">
        <p className="text-caption text-fg-2 mb-1 uppercase font-semibold tracking-wide">
          Producto
        </p>
        <p className="text-callout font-semibold text-fg-1">{productName}</p>
      </div>

      {/* Credentials modal */}
      <CredentialsModal
        open={credModalOpen}
        onOpenChange={setCredModalOpen}
        provider="meta"
        onSaved={handleCredSaved}
        {...(credError !== undefined && { errorMessage: credError })}
      />
    </div>
  )
}
