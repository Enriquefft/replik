"use client"

import { Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import * as React from "react"
import { toast } from "sonner"
import { CreativeCard } from "@/components/creative-card.tsx"
import { Button } from "@/components/ui/button.tsx"
import type { Creative } from "@/db/schema"
import { selectCreatives } from "@/server/actions/products.ts"

interface CreativesClientProps {
  productId: string
  creatives: Creative[]
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

  return (
    <div className="flex flex-col gap-4">
      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {creatives.map((creative, i) => (
          <CreativeCard
            key={creative.id}
            creative={creative}
            selected={selected.has(creative.id)}
            onToggle={() => {
              toggle(creative.id)
            }}
            index={i}
          />
        ))}
      </div>

      {/* Bottom bar */}
      <div className="sticky bottom-4 flex items-center justify-between gap-4 rounded-card bg-surface-elevated glass shadow-card border border-border px-5 py-3">
        <p className="text-callout text-fg-2">
          <span className="font-semibold text-fg-1">{selected.size}</span> seleccionado
          {selected.size !== 1 ? "s" : ""}
        </p>
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
