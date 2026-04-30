import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import {
  IntegrationMissingError,
  getIntegration,
  requireIntegration,
  saveIntegration,
} from "@/server/integrations";

const hasLiveDb = Boolean(
  process.env.DATABASE_URL && process.env.ENCRYPTION_KEY,
);

const describeLive = hasLiveDb ? describe : describe.skip;

describeLive("P1 round-trip (live DB + ENCRYPTION_KEY)", () => {
  let testUserId: string;
  const clerkUserId = `test_clerk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    const inserted = await getDb()
      .insert(users)
      .values({ clerkUserId, email: `${clerkUserId}@test.local` })
      .returning({ id: users.id });
    const row = inserted[0];
    if (!row) throw new Error("failed to insert test user");
    testUserId = row.id;
  });

  afterAll(async () => {
    if (testUserId) {
      await getDb().delete(users).where(eq(users.id, testUserId));
    }
  });

  test("encrypt/decrypt round-trip", async () => {
    const plaintext = "shpat_test_token_xyz";
    const ciphertext = await encrypt(plaintext);
    expect(Buffer.isBuffer(ciphertext)).toBe(true);
    const decrypted = await decrypt(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  test("saveIntegration + getIntegration round-trip (shopify)", async () => {
    await saveIntegration(testUserId, {
      provider: "shopify",
      token: "shpat_round_trip_test",
      extra: { provider: "shopify", shop_domain: "test.myshopify.com" },
    });
    const result = await getIntegration(testUserId, "shopify");
    expect(result).not.toBeNull();
    expect(result?.token).toBe("shpat_round_trip_test");
    expect(result?.extra).toEqual({
      provider: "shopify",
      shop_domain: "test.myshopify.com",
    });
  });

  test("saveIntegration upsert overwrites (shopify)", async () => {
    await saveIntegration(testUserId, {
      provider: "shopify",
      token: "shpat_first",
      extra: { provider: "shopify", shop_domain: "first.myshopify.com" },
    });
    await saveIntegration(testUserId, {
      provider: "shopify",
      token: "shpat_second",
      extra: { provider: "shopify", shop_domain: "second.myshopify.com" },
    });
    const result = await getIntegration(testUserId, "shopify");
    expect(result?.token).toBe("shpat_second");
    expect(result?.extra).toEqual({
      provider: "shopify",
      shop_domain: "second.myshopify.com",
    });
  });

  test("requireIntegration throws IntegrationMissingError when absent", async () => {
    let caught: unknown;
    try {
      await requireIntegration(testUserId, "meta");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(IntegrationMissingError);
    expect((caught as IntegrationMissingError).provider).toBe("meta");
  });
});

if (!hasLiveDb) {
  describe("P1 round-trip", () => {
    test.skip("requires DATABASE_URL + ENCRYPTION_KEY env to run", () => {
      // intentionally empty: skipped placeholder
    });
  });
}
