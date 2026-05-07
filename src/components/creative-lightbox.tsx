"use client"

import { AlertCircle } from "lucide-react"
import * as React from "react"
import { Button } from "@/components/ui/button.tsx"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog.tsx"
import type { Creative } from "@/db/schema"

/**
 * Empty WebVTT track served as a data URL. Used when a creative has no source
 * SRT asset (oversize video, transcribe failure, or non-speech ad). Satisfies
 * the captions affordance without faking subtitles — the track exists but is
 * empty, mirroring reality.
 */
const EMPTY_VTT_DATA_URL = "data:text/vtt;charset=utf-8,WEBVTT%0A%0A"

interface CreativeLightboxProps {
  creative: Creative
  previewUrl: string
  srtUrl: string | null
  selected: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onToggleSelect: () => void
}

export function CreativeLightbox({
  creative,
  previewUrl,
  srtUrl,
  selected,
  open,
  onOpenChange,
  onToggleSelect,
}: CreativeLightboxProps) {
  const [errored, setErrored] = React.useState(false)

  // Reset error when reopening with potentially fresh state.
  React.useEffect(() => {
    if (open) setErrored(false)
  }, [open])

  const transcriptPreview =
    creative.transcriptText !== null && creative.transcriptText.length > 0
      ? creative.transcriptText
      : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden">
        <DialogTitle className="sr-only">Vista previa del creativo</DialogTitle>
        <DialogDescription className="sr-only">
          Reproduce el video original encontrado para revisarlo antes de seleccionarlo.
        </DialogDescription>

        <div
          className="relative w-full bg-black"
          style={{ aspectRatio: "9/16", maxHeight: "80vh" }}
        >
          {errored ? (
            <ErrorOverlay />
          ) : (
            <video
              key={previewUrl}
              src={previewUrl}
              controls
              autoPlay
              playsInline
              preload="metadata"
              onError={() => {
                setErrored(true)
              }}
              className="h-full w-full object-contain"
            >
              <track
                kind="captions"
                srcLang={creative.language ?? "es"}
                src={
                  srtUrl !== null
                    ? `/api/creatives/${creative.id}/captions.vtt`
                    : EMPTY_VTT_DATA_URL
                }
                default
              />
            </video>
          )}
        </div>

        <div className="flex flex-col gap-3 p-4">
          {transcriptPreview !== null && (
            <p className="text-caption text-fg-2 leading-snug line-clamp-3">
              &ldquo;{transcriptPreview}&rdquo;
            </p>
          )}
          <Button
            variant={selected ? "outline" : "default"}
            onClick={onToggleSelect}
            size="lg"
            className="w-full"
          >
            {selected ? "Quitar selección" : "Seleccionar este video"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ErrorOverlay() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white p-6 text-center">
      <AlertCircle className="size-8" strokeWidth={1.5} />
      <p className="text-body font-medium">No pudimos cargar el video</p>
      <p className="text-caption text-white/70">
        Puedes seleccionarlo igual y continuar — lo procesaremos al editar.
      </p>
    </div>
  )
}
