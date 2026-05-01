"use client"

import { Play } from "lucide-react"
import { Badge } from "@/components/ui/badge.tsx"
import type { Creative } from "@/db/schema"
import { cn } from "@/lib/utils.ts"

const ANGLE_COLORS: Record<string, { bg: string; text: string }> = {
  pain: { bg: "bg-mode-traffic-badge-bg", text: "text-mode-traffic-badge-fg" },
  lifestyle: { bg: "bg-mode-creative-badge-bg", text: "text-mode-creative-badge-fg" },
  demo: { bg: "bg-mode-live-badge-bg", text: "text-mode-live-badge-fg" },
}

const ANGLE_GRADIENTS: string[] = [
  "linear-gradient(135deg, #fee2e2 0%, #fde68a 100%)",
  "linear-gradient(135deg, #dbeafe 0%, #a7f3d0 100%)",
  "linear-gradient(135deg, #bfdbfe 0%, #ddd6fe 100%)",
  "linear-gradient(135deg, #fef3c7 0%, #a7f3d0 100%)",
  "linear-gradient(135deg, #ede9fe 0%, #dbeafe 100%)",
]

interface CreativeCardProps {
  creative: Creative
  selected: boolean
  onToggle: () => void
  index?: number
}

export function CreativeCard({ creative, selected, onToggle, index = 0 }: CreativeCardProps) {
  const gradient = ANGLE_GRADIENTS[index % ANGLE_GRADIENTS.length] ?? ANGLE_GRADIENTS[0]
  const angleKey = creative.angle?.toLowerCase() ?? ""
  const angleColors = ANGLE_COLORS[angleKey] ?? {
    bg: "bg-surface-muted",
    text: "text-fg-2",
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "group relative flex flex-col text-left rounded-card overflow-hidden",
        "transition-all duration-200 ease-spring cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "ring-2 ring-mode-creative shadow-card"
          : "ring-1 ring-border shadow-tight hover:shadow-card",
      )}
    >
      {/* Thumbnail */}
      <div className="relative w-full" style={{ aspectRatio: "9/16", background: gradient }}>
        <div className="absolute inset-0 bg-radial-gradient-subtle" />

        {/* Play button */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="size-12 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center shadow-lg">
            <Play className="size-5 text-white translate-x-0.5" strokeWidth={1.8} fill="white" />
          </div>
        </div>

        {/* Checkbox */}
        <button
          type="button"
          aria-label={selected ? "Deseleccionar creativo" : "Seleccionar creativo"}
          aria-pressed={selected}
          className="absolute top-2 left-2"
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
        >
          <div
            className={cn(
              "size-6 rounded-full flex items-center justify-center shadow-md",
              selected ? "bg-mode-creative" : "bg-white/85 border border-white",
            )}
          >
            {selected && (
              <svg
                className="size-3 text-white"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                aria-hidden="true"
              >
                <title>Seleccionado</title>
                <path d="M2 6l3 3 5-5" />
              </svg>
            )}
          </div>
        </button>

        {/* Source badge */}
        <div className="absolute top-2 right-2">
          <span className="inline-flex items-center h-5 px-2 rounded-full bg-black/80 text-white text-[10px] font-semibold tracking-wide">
            {creative.source === "meta_ad_library" ? "FB" : "Apify"}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-3 bg-surface-elevated">
        {creative.transcriptText ? (
          <p className="text-caption text-fg-1 leading-snug line-clamp-2">
            &ldquo;{creative.transcriptText.slice(0, 80)}&rdquo;
          </p>
        ) : (
          <p className="text-caption text-fg-3 italic">Sin transcripción</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {creative.angle ? (
            <span
              className={cn(
                "inline-flex items-center h-5 px-2 rounded-full text-[10px] font-semibold",
                angleColors.bg,
                angleColors.text,
              )}
            >
              {creative.angle}
            </span>
          ) : (
            <span className="inline-flex items-center h-5 px-2 rounded-full text-[10px] font-medium bg-surface-muted text-fg-3">
              sin clasificar
            </span>
          )}
          {creative.translated === false && (
            <Badge variant="secondary">Subtítulos sin traducir</Badge>
          )}
        </div>
      </div>
    </button>
  )
}
