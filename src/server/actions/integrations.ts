"use server";

import { z } from "zod";
import { requireUser } from "@/db/client";
import { saveIntegration as persistIntegration } from "@/server/integrations";
import {
  MetaAuthError,
  accountsList,
  pixelsList,
} from "@/lib/meta";
import { ShopifyAuthError, validateToken } from "@/lib/shopify";

const ShopifyFormInput = z.object({
  provider: z.literal("shopify"),
  token: z.string().min(10),
  shop_domain: z.string().min(3),
});

const MetaFormInput = z.object({
  provider: z.literal("meta"),
  token: z.string().min(10),
  ad_account_id: z.string().min(1),
  page_id: z.string().min(1),
});

const Input = z.discriminatedUnion("provider", [
  ShopifyFormInput,
  MetaFormInput,
]);

export type SaveIntegrationInput = z.infer<typeof Input>;

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; needs: "meta" | "shopify"; error?: string };

function inferProvider(raw: unknown): "meta" | "shopify" {
  if (typeof raw === "object" && raw !== null && "provider" in raw) {
    const p: unknown = raw.provider;
    if (p === "meta" || p === "shopify") return p;
  }
  return "shopify";
}

export async function saveIntegration(
  rawInput: unknown,
): Promise<ActionResult<{ ok: true }>> {
  const parsed = Input.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      needs: inferProvider(rawInput),
      error: "Datos inválidos en el formulario.",
    };
  }
  const data = parsed.data;
  const { userId } = await requireUser();

  if (data.provider === "shopify") {
    try {
      const shop = await validateToken({
        token: data.token,
        shop_domain: data.shop_domain,
      });
      await persistIntegration(userId, {
        provider: "shopify",
        token: data.token,
        extra: {
          provider: "shopify",
          shop_domain: shop.myshopify_domain,
        },
      });
      return { ok: true, data: { ok: true } };
    } catch (err) {
      const friendly =
        err instanceof ShopifyAuthError
          ? err.message
          : "Token Shopify inválido";
      return { ok: false, needs: "shopify", error: friendly };
    }
  }

  try {
    const accounts = await accountsList({ token: data.token });
    const targetId = data.ad_account_id.replace(/^act_/, "");
    const matched = accounts.find((a) => a.account_id === targetId);
    if (!matched) {
      return {
        ok: false,
        needs: "meta",
        error: "El ad_account_id no pertenece a este token.",
      };
    }
    const pixels = await pixelsList({
      token: data.token,
      ad_account_id: targetId,
    });
    const pixel = pixels[0];
    if (!pixel) {
      return {
        ok: false,
        needs: "meta",
        error: "La cuenta no tiene pixels disponibles.",
      };
    }
    await persistIntegration(userId, {
      provider: "meta",
      token: data.token,
      extra: {
        provider: "meta",
        ad_account_id: targetId,
        page_id: data.page_id,
        pixel_id: pixel.id,
      },
    });
    return { ok: true, data: { ok: true } };
  } catch (err) {
    const friendly =
      err instanceof MetaAuthError
        ? err.message
        : "Token Meta inválido o sin permisos";
    return { ok: false, needs: "meta", error: friendly };
  }
}
