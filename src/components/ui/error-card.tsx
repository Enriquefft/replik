import { AlertCircle, type LucideIcon } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button.tsx"

interface ActionLink {
  label: string
  href: string
}

interface ActionButton {
  label: string
  onClick: () => void
  disabled?: boolean
  icon?: ReactNode
}

interface ErrorCardProps {
  title: string
  detail: string
  icon?: LucideIcon
  primary: ActionLink | ActionButton
  secondary?: ActionLink | ActionButton
}

function isLink(action: ActionLink | ActionButton): action is ActionLink {
  return "href" in action
}

export function ErrorCard({ title, detail, icon, primary, secondary }: ErrorCardProps) {
  const Icon = icon ?? AlertCircle
  return (
    <div className="min-h-[calc(100vh-56px)] bg-page flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg rounded-card bg-surface glass shadow-card border border-border p-8 text-center">
        <div className="size-14 rounded-card bg-mode-traffic-badge-bg flex items-center justify-center mx-auto mb-4">
          <Icon className="size-7 text-mode-traffic" strokeWidth={1.5} />
        </div>
        <h2 className="text-title mb-2">{title}</h2>
        <p className="text-body text-fg-2 mb-5">{detail}</p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          {isLink(primary) ? (
            <Button asChild size="lg">
              <Link href={primary.href}>{primary.label}</Link>
            </Button>
          ) : (
            <Button size="lg" onClick={primary.onClick} disabled={primary.disabled}>
              {primary.icon}
              {primary.label}
            </Button>
          )}
          {secondary !== undefined &&
            (isLink(secondary) ? (
              <Button asChild variant="outline" size="lg">
                <Link href={secondary.href}>{secondary.label}</Link>
              </Button>
            ) : (
              <Button
                variant="outline"
                size="lg"
                onClick={secondary.onClick}
                disabled={secondary.disabled}
              >
                {secondary.icon}
                {secondary.label}
              </Button>
            ))}
        </div>
      </div>
    </div>
  )
}
