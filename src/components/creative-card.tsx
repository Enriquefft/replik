"use client"

import { ImageOff, Play } from "lucide-react"
import * as React from "react"
import { CreativeLightbox } from "@/components/creative-lightbox.tsx"
import { Badge } from "@/components/ui/badge.tsx"
import { Checkbox } from "@/components/ui/checkbox.tsx"
import type { Creative } from "@/db/schema"
import type { SalesAngle } from "@/lib/ai/taxonomies.ts"
import { cn } from "@/lib/utils.ts"

// Reuses the 5 mode tokens declared in globals.css; multiple angles share a
// token when sentiment matches. Re-tune mappings if design publishes per-angle
// tokens.
const ANGLE_COLORS: Record<SalesAngle, string> = {
  precio: "bg-mode-web-badge-bg text-mode-web-badge-fg",
  demostracion: "bg-mode-live-badge-bg text-mode-live-badge-fg",
  comparacion: "bg-mode-live-badge-bg text-mode-live-badge-fg",
  testimonio: "bg-mode-system-badge-bg text-mode-system-badge-fg",
  urgencia: "bg-mode-traffic-badge-bg text-mode-traffic-badge-fg",
  dolor: "bg-mode-traffic-badge-bg text-mode-traffic-badge-fg",
  aspiracional: "bg-mode-creative-badge-bg text-mode-creative-badge-fg",
  regalo: "bg-mode-creative-badge-bg text-mode-creative-badge-fg",
}

const ANGLE_GRADIENTS: readonly string[] = [
  "linear-gradient(135deg, #fee2e2 0%, #fde68a 100%)",
  "linear-gradient(135deg, #dbeafe 0%, #a7f3d0 100%)",
  "linear-gradient(135deg, #bfdbfe 0%, #ddd6fe 100%)",
  "linear-gradient(135deg, #fef3c7 0%, #a7f3d0 100%)",
  "linear-gradient(135deg, #ede9fe 0%, #dbeafe 100%)",
]

/**
 * Stable id-derived gradient index. Hashing the creative id keeps the loading
 * gradient consistent across re-renders even if the parent reorders the grid,
 * unlike a positional `index` prop.
 */
function gradientFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0
  }
  const bucket = Math.abs(h) % ANGLE_GRADIENTS.length
  return ANGLE_GRADIENTS[bucket] ?? ANGLE_GRADIENTS[0] ?? ""
}

interface CreativeCardProps {
  creative: Creative
  previewUrl: string
  srtUrl: string | null
  selected: boolean
  onToggle: () => void
}

export function CreativeCard({
  creative,
  previewUrl,
  srtUrl,
  selected,
  onToggle,
}: CreativeCardProps) {
  const gradient = gradientFor(creative.id)
  const [hovering, setHovering] = React.useState(false)
  const [errored, setErrored] = React.useState(false)
  const [lightboxOpen, setLightboxOpen] = React.useState(false)
  const videoRef = React.useRef<HTMLVideoElement | null>(null)

  // Hover-driven autoplay polish on desktop. The video element is always
  // mounted (so the still frame renders for touch users), but we only call
  // `play()` while hovered; on unhover we pause and reset to the first frame
  // so the next hover restarts cleanly.
  React.useEffect(() => {
    const el = videoRef.current
    if (el === null || errored) return
    if (hovering) {
      void el.play().catch(() => {
        // Autoplay may reject for reasons unrelated to the video itself
        // (e.g. browser policy); ignore — the still frame remains visible.
      })
    } else {
      el.pause()
      el.currentTime = 0
    }
  }, [hovering, errored])

  function openLightbox() {
    setLightboxOpen(true)
  }

  return (
    <>
      <article
        aria-label={creative.transcriptText ?? "Creativo encontrado"}
        onMouseEnter={() => {
          setHovering(true)
        }}
        onMouseLeave={() => {
          setHovering(false)
        }}
        className={cn(
          "group relative flex flex-col text-left rounded-card overflow-hidden",
          "transition-all duration-200 ease-spring",
          "focus-within:outline-none focus-within:ring-2 focus-within:ring-ring",
          selected
            ? "ring-2 ring-mode-creative shadow-card"
            : "ring-1 ring-border shadow-tight hover:shadow-card",
        )}
      >
        {/* Thumbnail — clicking opens the lightbox. The whole zone is the
            Play affordance. Selection lives in the checkbox at top-left. */}
        <button
          type="button"
          onClick={openLightbox}
          aria-label="Ver video completo"
          className="relative w-full block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          style={{ aspectRatio: "9/16", background: gradient }}
        >
          <div className="absolute inset-0 bg-radial-gradient-subtle" />

          {!errored && (
            <video
              ref={videoRef}
              src={previewUrl}
              muted
              playsInline
              loop
              preload="metadata"
              onError={() => {
                setErrored(true)
              }}
              className="absolute inset-0 z-0 h-full w-full object-cover"
            />
          )}

          {errored && (
            <div className="absolute inset-0 z-0 flex flex-col items-center justify-center gap-1 text-fg-3">
              <ImageOff className="size-6" strokeWidth={1.5} />
              <span className="text-caption font-medium">Sin preview</span>
            </div>
          )}

          {/* Play affordance overlay — visual only, parent button owns the click. */}
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-150 group-hover:opacity-0">
            <div className="size-12 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center shadow-lg">
              <Play className="size-5 text-white translate-x-0.5" strokeWidth={1.8} fill="white" />
            </div>
          </div>
        </button>

        {/* Selection checkbox — sibling of the Play button, no nesting. */}
        <div className="absolute top-2 left-2 z-20">
          <Checkbox
            checked={selected}
            onCheckedChange={() => {
              onToggle()
            }}
            aria-label={selected ? "Quitar selección" : "Seleccionar creativo"}
            className="size-6 bg-white/90 border-white shadow-md data-[state=checked]:bg-mode-creative data-[state=checked]:border-mode-creative"
          />
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
                  ANGLE_COLORS[creative.angle],
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
      </article>

      <CreativeLightbox
        creative={creative}
        previewUrl={previewUrl}
        srtUrl={srtUrl}
        selected={selected}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onToggleSelect={onToggle}
      />
    </>
  )
}
