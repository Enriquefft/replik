"use client";

import * as React from "react";
import { Video, CheckCircle2, Clock } from "lucide-react";
import type { Creative, Asset } from "@/db/schema";

type CreativeWithAssets = Creative & { assets: Asset[] };

interface EditPageClientProps {
  productId: string;
  creatives: CreativeWithAssets[];
}

export function EditPageClient({
  creatives,
}: EditPageClientProps) {
  if (creatives.length === 0) {
    return (
      <div className="text-center py-12 text-fg-2">
        <p className="text-body">
          No hay creativos seleccionados. Vuelve al paso anterior y elige al
          menos uno.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {creatives.map((creative) => {
        const editedVideo = creative.assets.find(
          (a) => a.kind === "edited_video",
        );
        const isDone = !!editedVideo;

        return (
          <div
            key={creative.id}
            className="rounded-card bg-surface border border-border shadow-tight overflow-hidden"
          >
            <div className="flex items-start gap-4 p-4">
              {/* Icon */}
              <div className="size-10 rounded-control bg-mode-creative-badge-bg flex items-center justify-center shrink-0">
                <Video
                  className="size-5 text-mode-creative"
                  strokeWidth={1.5}
                />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-callout font-semibold text-fg-1 truncate">
                    {creative.angle ?? "Video sin clasificar"}
                  </p>
                  {creative.language && creative.language !== "es" && (
                    <span className="inline-flex items-center h-5 px-2 rounded-pill bg-mode-creative-badge-bg text-mode-creative-badge-fg text-[10px] font-semibold uppercase">
                      {creative.language} → ES
                    </span>
                  )}
                </div>

                {creative.transcriptText && (
                  <p className="text-caption text-fg-2 line-clamp-2">
                    &ldquo;{creative.transcriptText.slice(0, 120)}&rdquo;
                  </p>
                )}

                {/* Status */}
                {isDone ? (
                  <div className="flex items-center gap-1.5 mt-2">
                    <CheckCircle2
                      className="size-4 text-mode-web"
                      strokeWidth={1.8}
                    />
                    <span className="text-caption text-mode-web-badge-fg font-medium">
                      Listo
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 mt-2">
                    <Clock className="size-4 text-fg-3" strokeWidth={1.8} />
                    <span className="text-caption text-fg-3">
                      Procesando…
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Video preview when done */}
            {editedVideo && (
              <div className="border-t border-border p-4">
                <video
                  src={editedVideo.url}
                  controls
                  className="w-full max-h-64 rounded-control bg-black"
                  preload="metadata"
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
