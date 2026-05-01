"use client"

import { CheckCircle2 } from "lucide-react"
import type * as React from "react"
import type { TemplateMeta } from "@/lib/shopify/templates/index.ts"
import { cn } from "@/lib/utils.ts"

interface TemplateCardProps {
  template: TemplateMeta
  selected: boolean
  onSelect: () => void
}

export function TemplateCard({ template, selected, onSelect }: TemplateCardProps) {
  const gradients: Record<number, string> = {
    1: "linear-gradient(135deg, #fee2e2 0%, #fde68a 100%)",
    2: "linear-gradient(135deg, #fef3c7 0%, #a7f3d0 100%)",
    3: "linear-gradient(135deg, #bfdbfe 0%, #ddd6fe 100%)",
  }

  const gradient = gradients[template.id] ?? gradients[1]

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative flex flex-col rounded-card overflow-hidden text-left",
        "transition-all duration-200 ease-spring",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "ring-2 shadow-card" : "ring-1 ring-border shadow-tight hover:shadow-card",
      )}
      style={selected ? ({ "--tw-ring-color": template.accent } as React.CSSProperties) : undefined}
    >
      {/* Preview area */}
      <div
        className="relative aspect-[9/12] w-full overflow-hidden"
        style={{ background: gradient }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-white/30 to-transparent" />

        {/* Mini wireframe — hints at landing layout */}
        <div className="absolute inset-0 flex flex-col gap-1.5 p-3">
          {/* Image placeholder */}
          <div className="h-[42%] w-full rounded-tight bg-white/55 backdrop-blur-[2px]" />

          {/* Text-line bars */}
          <div className="mt-1 h-1.5 w-3/4 rounded-pill bg-white/70" />
          <div className="h-1.5 w-1/2 rounded-pill bg-white/55" />
          <div className="h-1 w-2/3 rounded-pill bg-white/45" />

          {/* Spacer pushes CTA to bottom */}
          <div className="flex-1" />

          {/* CTA bar */}
          <div className="h-3 w-full rounded-tight" style={{ background: template.accent }} />
        </div>

        {/* Selected indicator */}
        {selected && (
          <div className="absolute top-2 right-2">
            <CheckCircle2
              className="size-5 bg-surface-solid rounded-full"
              style={{ color: template.accent }}
              strokeWidth={2}
            />
          </div>
        )}
      </div>

      {/* Info */}
      <div
        className={cn(
          "px-3 py-2 bg-surface-elevated border-t border-border",
          selected && "border-t",
        )}
        style={{
          borderTopColor: selected ? `${template.accent}40` : undefined,
        }}
      >
        <p className="text-callout font-semibold text-fg-1 truncate">{template.name}</p>
        <p className="text-caption text-fg-2 mt-0.5 line-clamp-2">{template.description}</p>
      </div>
    </button>
  )
}
