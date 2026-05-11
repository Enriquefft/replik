"use client"

import { UserButton } from "@clerk/nextjs"
import { Sparkles } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button.tsx"
import { cn } from "@/lib/utils.ts"

const NAV_LINKS = [
  { href: "/new", label: "Nuevo producto" },
  { href: "/dashboard", label: "Dashboard" },
] as const

export function Nav() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-surface/80 glass">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 text-fg-1 transition-opacity hover:opacity-75"
        >
          <Sparkles className="size-5 text-mode-live" strokeWidth={1.8} />
          <span className="text-headline font-semibold tracking-tight">Replik AI</span>
        </Link>

        {/* Nav links */}
        <nav className="hidden items-center gap-1 sm:flex">
          {NAV_LINKS.map((link) => {
            const isActive = pathname.startsWith(link.href)
            return (
              <Button
                key={link.href}
                variant="ghost"
                size="sm"
                asChild
                className={cn("text-fg-2", isActive && "text-fg-1 bg-surface-muted")}
              >
                <Link href={link.href}>{link.label}</Link>
              </Button>
            )
          })}
        </nav>

        {/* User button */}
        <UserButton
          appearance={{
            elements: {
              avatarBox: "size-8",
            },
          }}
        />
      </div>
    </header>
  )
}
