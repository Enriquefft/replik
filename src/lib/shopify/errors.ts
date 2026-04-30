import "server-only";

export class ShopifyAuthError extends Error {
  constructor(message = "Token Shopify inválido") {
    super(message);
    this.name = "ShopifyAuthError";
  }
}
