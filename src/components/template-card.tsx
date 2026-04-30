"use client";

import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import type { TemplateMeta } from "@/lib/shopify/templates/index.ts";

interface TemplateCardProps {
  template: TemplateMeta;
  selected: boolean;
  onSelect: () => void;
}

export function TemplateCard({
  template,
  selected,
  onSelect,
}: TemplateCardProps) {
  const gradients: Record<number, string> = {
    1: "linear-gradient(135deg, #fee2e2 0%, #fde68a 100%)",
    2: "linear-gradient(135deg, #fef3c7 0%, #a7f3d0 100%)",
    3: "linear-gradient(135deg, #bfdbfe 0%, #ddd6fe 100%)",
  };

  const gradient = gradients[template.id] ?? gradients[1];

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative flex flex-col rounded-card overflow-hidden text-left",
        "transition-all duration-200 ease-spring",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "ring-2 shadow-card"
          : "ring-1 ring-border shadow-tight hover:shadow-card",
      )}
      style={
        selected
          ? ({ "--tw-ring-color": template.accent } as React.CSSProperties)
          : undefined
      }
    >
      {/* Preview area */}
      <div
        className="relative aspect-[9/12] w-full flex items-center justify-center"
        style={{ background: gradient }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent" />
        <div className="relative text-center px-4">
          <div
            className="text-sm font-semibold leading-tight"
            style={{ color: template.accent }}
          >
            {template.name}
          </div>
        </div>

        {/* Selected indicator */}
        {selected && (
          <div className="absolute top-2 right-2">
            <CheckCircle2
              className="size-5 bg-white rounded-full"
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
          borderTopColor: selected
            ? `${template.accent}40`
            : undefined,
        }}
      >
        <p className="text-callout font-semibold text-fg-1 truncate">
          {template.name}
        </p>
        <p className="text-caption text-fg-2 mt-0.5 line-clamp-2">
          {template.description}
        </p>
      </div>
    </button>
  );
}
