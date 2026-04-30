import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { withUser } from "@/db/client";
import { integrations } from "@/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { EncryptedExtraJson } from "@/db/zod";

export class IntegrationMissingError extends Error {
  constructor(public readonly provider: "meta" | "shopify") {
    super(`Integration missing: ${provider}`);
    this.name = "IntegrationMissingError";
  }
}

export interface IntegrationCreds {
  token: string;
  extra: EncryptedExtraJson;
}

export async function getIntegration(
  userId: string,
  provider: "meta" | "shopify",
): Promise<IntegrationCreds | null> {
  return await withUser(userId, async (db) => {
    const rows = await db
      .select({
        encryptedToken: integrations.encryptedToken,
        encryptedExtraJson: integrations.encryptedExtraJson,
      })
      .from(integrations)
      .where(
        and(
          eq(integrations.userId, userId),
          eq(integrations.provider, provider),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const [token, extraRaw] = await Promise.all([
      decrypt(row.encryptedToken),
      decrypt(row.encryptedExtraJson),
    ]);
    const extra = EncryptedExtraJson.parse(JSON.parse(extraRaw));
    return { token, extra };
  });
}

export async function requireIntegration(
  userId: string,
  provider: "meta" | "shopify",
): Promise<IntegrationCreds> {
  const result = await getIntegration(userId, provider);
  if (!result) {
    throw new IntegrationMissingError(provider);
  }
  return result;
}

export async function saveIntegration(
  userId: string,
  input: {
    provider: "meta" | "shopify";
    token: string;
    extra: EncryptedExtraJson;
  },
): Promise<void> {
  const [encryptedToken, encryptedExtraJson] = await Promise.all([
    encrypt(input.token),
    encrypt(JSON.stringify(input.extra)),
  ]);
  await withUser(userId, async (db) => {
    await db
      .insert(integrations)
      .values({
        userId,
        provider: input.provider,
        encryptedToken,
        encryptedExtraJson,
        validatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [integrations.userId, integrations.provider],
        set: {
          encryptedToken,
          encryptedExtraJson,
          validatedAt: sql`now()`,
          expiresAt: null,
        },
      });
  });
}
