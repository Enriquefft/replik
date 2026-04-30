import "server-only";

import { ShopifyAuthError } from "./errors";

export { ShopifyAuthError } from "./errors";
export {
  ShopifyApiError,
  publishProduct,
  applyTemplate,
  getActiveThemeId,
} from "./client";
export type {
  ShopifyCreds,
  ShopifyProductInput,
  PublishProductResult,
} from "./client";
export { renderTemplate } from "./render";
export type { TemplateVars } from "./render";
export { pickTemplate } from "./templatePicker";
export { loadTemplate } from "./templates";

export interface ShopifyValidateInput {
  token: string;
  shop_domain: string;
}

export interface ShopInfo {
  myshopify_domain: string;
  name?: string;
}

/**
 * Live token validation. Calls Shopify Admin API `/shop.json` and returns
 * the canonical `myshopify_domain`. Throws `ShopifyAuthError` on any failure.
 */
export async function validateToken(
  input: ShopifyValidateInput,
): Promise<ShopInfo> {
  const domain = input.shop_domain.trim().toLowerCase();
  const url = `https://${domain}/admin/api/2024-10/shop.json`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": input.token,
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch {
    throw new ShopifyAuthError(
      "No se pudo conectar con Shopify. Verifica el dominio.",
    );
  }
  if (!response.ok) {
    throw new ShopifyAuthError();
  }
  const body = (await response.json()) as {
    shop?: { myshopify_domain?: string; name?: string };
  };
  const shop = body.shop;
  if (!shop?.myshopify_domain) {
    throw new ShopifyAuthError();
  }
  const result: ShopInfo = { myshopify_domain: shop.myshopify_domain };
  if (shop.name !== undefined) result.name = shop.name;
  return result;
}
