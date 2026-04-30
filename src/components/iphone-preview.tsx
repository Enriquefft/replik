import type * as React from "react"
import { cn } from "@/lib/utils.ts"

interface IphonePreviewProps {
  children: React.ReactNode
  gradient?: string
  className?: string
}

export function IphonePreview({ children, gradient, className }: IphonePreviewProps) {
  return (
    <div className={cn("flex justify-center", className)}>
      {/* Phone shell */}
      <div
        className="relative flex flex-col"
        style={{
          width: 280,
          height: 560,
          borderRadius: 44,
          background: "#1c1c1e",
          boxShadow: "0 0 0 2px #3a3a3c, 0 0 0 4px #1c1c1e, 0 32px 64px rgba(0,0,0,0.35)",
          padding: 10,
        }}
      >
        {/* Side button */}
        <div
          className="absolute"
          style={{
            right: -3,
            top: 100,
            width: 3,
            height: 40,
            borderRadius: "0 3px 3px 0",
            background: "#3a3a3c",
          }}
        />
        {/* Volume buttons */}
        <div
          className="absolute"
          style={{
            left: -3,
            top: 90,
            width: 3,
            height: 28,
            borderRadius: "3px 0 0 3px",
            background: "#3a3a3c",
          }}
        />
        <div
          className="absolute"
          style={{
            left: -3,
            top: 128,
            width: 3,
            height: 28,
            borderRadius: "3px 0 0 3px",
            background: "#3a3a3c",
          }}
        />

        {/* Screen */}
        <div
          className="relative flex flex-col overflow-hidden"
          style={{
            flex: 1,
            borderRadius: 36,
            background: gradient ?? "var(--color-page)",
            overflow: "hidden",
          }}
        >
          {/* Status bar */}
          <div
            className="flex items-center justify-between px-6"
            style={{
              height: 44,
              paddingTop: 12,
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: gradient ? "rgba(0,0,0,0.7)" : "var(--color-fg-1)",
                fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
              }}
            >
              9:41
            </span>
            {/* Notch */}
            <div
              style={{
                width: 80,
                height: 20,
                borderRadius: 10,
                background: "#1c1c1e",
              }}
            />
            <div style={{ fontSize: 10, color: "rgba(0,0,0,0.5)" }}>●●●</div>
          </div>

          {/* Content area */}
          <div className="flex-1 overflow-y-auto scrollbar-none">{children}</div>
        </div>
      </div>
    </div>
  )
}
