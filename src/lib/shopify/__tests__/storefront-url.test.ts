import { describe, expect, test } from "bun:test"

import { buildStorefrontUrl, InvalidStorefrontUrlError } from "@/lib/shopify/storefront-url.ts"

describe("buildStorefrontUrl", () => {
  test("builds /pages/<handle> URL for *.myshopify.com host", () => {
    const url = buildStorefrontUrl("mitienda.myshopify.com", "mi-producto")
    expect(String(url)).toBe("https://mitienda.myshopify.com/pages/mi-producto")
  })

  test("builds URL for custom primary domain", () => {
    const url = buildStorefrontUrl("mitienda.com", "producto-x")
    expect(String(url)).toBe("https://mitienda.com/pages/producto-x")
  })

  test("supports deep subdomains", () => {
    const url = buildStorefrontUrl("shop.mitienda.com", "abc-123")
    expect(String(url)).toBe("https://shop.mitienda.com/pages/abc-123")
  })

  test("rejects protocol-prefixed host", () => {
    expect(() => buildStorefrontUrl("https://mitienda.com", "h")).toThrow(InvalidStorefrontUrlError)
  })

  test("rejects host with path", () => {
    expect(() => buildStorefrontUrl("mitienda.com/admin", "h")).toThrow(InvalidStorefrontUrlError)
  })

  test("rejects uppercase host", () => {
    expect(() => buildStorefrontUrl("MiTienda.com", "h")).toThrow(InvalidStorefrontUrlError)
  })

  test("rejects host with no dot", () => {
    expect(() => buildStorefrontUrl("localhost", "h")).toThrow(InvalidStorefrontUrlError)
  })

  test("rejects empty handle", () => {
    expect(() => buildStorefrontUrl("mitienda.myshopify.com", "")).toThrow(
      InvalidStorefrontUrlError,
    )
  })

  test("rejects handle with uppercase", () => {
    expect(() => buildStorefrontUrl("mitienda.myshopify.com", "Mi-Producto")).toThrow(
      InvalidStorefrontUrlError,
    )
  })

  test("rejects handle starting with hyphen", () => {
    expect(() => buildStorefrontUrl("mitienda.myshopify.com", "-abc")).toThrow(
      InvalidStorefrontUrlError,
    )
  })

  test("rejects handle ending with hyphen", () => {
    expect(() => buildStorefrontUrl("mitienda.myshopify.com", "abc-")).toThrow(
      InvalidStorefrontUrlError,
    )
  })

  test("rejects handle with underscore", () => {
    expect(() => buildStorefrontUrl("mitienda.myshopify.com", "mi_producto")).toThrow(
      InvalidStorefrontUrlError,
    )
  })
})
