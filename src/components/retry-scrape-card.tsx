"use client"

import { Loader2, RotateCw } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useTransition } from "react"
import { toast } from "sonner"
import { ErrorCard } from "@/components/ui/error-card.tsx"
import type { ProductId } from "@/lib/types/ids.ts"
import { retryScrape } from "@/server/actions/products.ts"

interface RetryScrapeCardProps {
  productId: ProductId
  title: string
  detail: string
}

export function RetryScrapeCard({ productId, title, detail }: RetryScrapeCardProps) {
  const router = useRouter()
  const [isRetrying, startRetry] = useTransition()

  const onRetry = useCallback(() => {
    startRetry(async () => {
      const result = await retryScrape(productId)
      if (!result.ok) {
        toast.error(result.error ?? "No se pudo reintentar el análisis.")
        return
      }
      router.refresh()
    })
  }, [productId, router])

  return (
    <ErrorCard
      title={title}
      detail={detail}
      primary={{
        label: "Reintentar",
        onClick: onRetry,
        disabled: isRetrying,
        icon: isRetrying ? (
          <Loader2 className="size-4 animate-spin mr-2" />
        ) : (
          <RotateCw className="size-4 mr-2" />
        ),
      }}
      secondary={{ label: "Cambiar URL", href: "/new" }}
    />
  )
}
