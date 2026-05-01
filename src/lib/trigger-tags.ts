import type { ProductId } from "@/lib/types/ids.ts"

export function productTag(id: ProductId): string {
  return `product:${id}`
}
