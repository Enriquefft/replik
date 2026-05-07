"use client"

import { Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import * as React from "react"
import { toast } from "sonner"
import { CreativeCard } from "@/components/creative-card.tsx"
import { Button } from "@/components/ui/button.tsx"
import type { Creative } from "@/db/schema"
import { cn } from "@/lib/utils.ts"
import { selectCreatives } from "@/server/actions/products.ts"

const SELECTION_RECOMMENDED_MIN = 3
const SELECTION_RECOMMENDED_MAX = 5

interface SelectionTone {
  count: string
  helper: string | null
}

function selectionTone(count: number): SelectionTone {
  if (count === 0) {
    return { count: "text-fg-3", helper: null }
  }
  if (count < SELECTION_RECOMMENDED_MIN) {
    return {
      count: "text-mode-traffic-badge-fg",
      helper: `Recomendamos al menos ${SELECTION_RECOMMENDED_MIN.toString()}.`,
    }
  }
  if (count > SELECTION_RECOMMENDED_MAX) {
    return {
      count: "text-mode-traffic-badge-fg",
      helper: `Más de ${SELECTION_RECOMMENDED_MAX.toString()} puede diluir resultados.`,
    }
  }
  return { count: "text-mode-web-badge-fg", helper: null }
}

export type CreativeWithVideo = Creative & {
  /** Playable URL — rehosted UploadThing if available, else direct CDN scrapeUrl. */
  previewUrl: string
  /** Source-language SRT asset URL, when transcribe succeeded. */
  srtUrl: string | null
}

interface CreativesClientProps {
  productId: string
  creatives: CreativeWithVideo[]
}

export function CreativesClient({ productId, creatives }: CreativesClientProps) {
  const router = useRouter()
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = React.useState(false)

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    setSelected(next)
  }

  async function handleContinue() {
    if (selected.size === 0) {
      toast.error("Selecciona al menos un creativo.")
      return
    }
    setSubmitting(true)
    const result = await selectCreatives(productId, Array.from(selected))
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.error ?? "Error al seleccionar creativos.")
      return
    }
    router.push(`/products/${productId}/edit`)
  }

  const tone = selectionTone(selected.size)

  return (
    <div className="flex flex-col gap-4">
      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {creatives.map((creative) => (
          <CreativeCard
            key={creative.id}
            creative={creative}
            previewUrl={creative.previewUrl}
            srtUrl={creative.srtUrl}
            selected={selected.has(creative.id)}
            onToggle={() => {
              toggle(creative.id)
            }}
          />
        ))}
      </div>

      {/* Bottom bar */}
      <div className="sticky bottom-4 flex items-center justify-between gap-4 rounded-card bg-surface-elevated glass shadow-card border border-border px-5 py-3">
        <div className="flex flex-col">
          <p className="text-callout text-fg-2">
            <span className={cn("font-semibold tabular-nums", tone.count)}>{selected.size}</span>{" "}
            seleccionado{selected.size !== 1 ? "s" : ""}
          </p>
          {tone.helper !== null && <p className="text-caption text-fg-3 mt-0.5">{tone.helper}</p>}
        </div>
        <Button
          onClick={() => void handleContinue()}
          disabled={selected.size === 0 || submitting}
          size="lg"
        >
          {submitting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
          Continuar →
        </Button>
      </div>
    </div>
  )
}
