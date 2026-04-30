import "server-only"
import { sql } from "drizzle-orm"
import { getDb } from "@/db/client"

function getKey(): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) {
    throw new Error("ENCRYPTION_KEY is not set")
  }
  return key
}

export async function encrypt(plaintext: string): Promise<Buffer> {
  const key = getKey()
  const result = await getDb().execute(
    sql`select pgp_sym_encrypt(${plaintext}, ${key}) as ciphertext`,
  )
  const row = result.rows[0] as { ciphertext: Buffer } | undefined
  if (!row) {
    throw new Error("encrypt: empty result")
  }
  return row.ciphertext
}

export async function decrypt(ciphertext: Buffer): Promise<string> {
  const key = getKey()
  const result = await getDb().execute(
    sql`select pgp_sym_decrypt(${ciphertext}, ${key}) as plaintext`,
  )
  const row = result.rows[0] as { plaintext: string } | undefined
  if (!row) {
    throw new Error("decrypt: empty result")
  }
  return row.plaintext
}
