import { describe, expect, test } from "bun:test"

import { normalizeShopDomain, ShopifyOAuthError } from "@/lib/shopify/oauth"

describe("normalizeShopDomain", () => {
  test("returns canonical *.myshopify.com unchanged", () => {
    expect(normalizeShopDomain("mitienda.myshopify.com")).toBe("mitienda.myshopify.com")
  })

  test("lowercases input", () => {
    expect(normalizeShopDomain("MiTienda.myshopify.com")).toBe("mitienda.myshopify.com")
  })

  test("strips https:// protocol", () => {
    expect(normalizeShopDomain("https://mitienda.myshopify.com")).toBe("mitienda.myshopify.com")
  })

  test("strips http:// protocol", () => {
    expect(normalizeShopDomain("http://mitienda.myshopify.com")).toBe("mitienda.myshopify.com")
  })

  test("strips trailing path", () => {
    expect(normalizeShopDomain("https://mitienda.myshopify.com/admin/products")).toBe(
      "mitienda.myshopify.com",
    )
  })

  test("trims whitespace", () => {
    expect(normalizeShopDomain("   mitienda.myshopify.com   ")).toBe("mitienda.myshopify.com")
  })

  test("appends .myshopify.com to bare subdomain", () => {
    expect(normalizeShopDomain("mitienda")).toBe("mitienda.myshopify.com")
  })

  test("appends .myshopify.com to bare subdomain with hyphens", () => {
    expect(normalizeShopDomain("mi-tienda-pe")).toBe("mi-tienda-pe.myshopify.com")
  })

  test("rejects www.-prefixed input", () => {
    expect(() => normalizeShopDomain("www.mitienda.com")).toThrow(ShopifyOAuthError)
  })

  test("rejects non-myshopify domain", () => {
    expect(() => normalizeShopDomain("mitienda.com")).toThrow(ShopifyOAuthError)
  })

  test("rejects empty string", () => {
    expect(() => normalizeShopDomain("")).toThrow(ShopifyOAuthError)
  })

  test("rejects bare subdomain with leading hyphen", () => {
    expect(() => normalizeShopDomain("-mitienda")).toThrow(ShopifyOAuthError)
  })

  test("rejects bare subdomain with trailing hyphen", () => {
    expect(() => normalizeShopDomain("mitienda-")).toThrow(ShopifyOAuthError)
  })

  test("rejects bare subdomain with underscore", () => {
    expect(() => normalizeShopDomain("mi_tienda")).toThrow(ShopifyOAuthError)
  })

  test("rejects subdomain on non-myshopify domain", () => {
    expect(() => normalizeShopDomain("shop.mitienda.com")).toThrow(ShopifyOAuthError)
  })
})
