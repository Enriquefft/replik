import "server-only"
import { UTApi } from "uploadthing/server"

let cachedApi: UTApi | undefined

function api(): UTApi {
  cachedApi ??= new UTApi()
  return cachedApi
}

export interface UploadedVideo {
  url: string
  key: string
}

export interface UploadedSrt {
  url: string
  key: string
}

export async function uploadEditedVideo(buffer: Buffer, filename: string): Promise<UploadedVideo> {
  const file = new File([toBlob(buffer)], filename, { type: "video/mp4" })
  const result = await api().uploadFiles(file)
  if (result.error !== null) {
    throw new Error(
      `uploadEditedVideo: UploadThing error ${result.error.code}: ${result.error.message}`,
    )
  }
  return { url: result.data.ufsUrl, key: result.data.key }
}

export interface OriginalUploadResult {
  ok: true
  url: string
  key: string
  bytes: number
  mime: string
}

export interface OriginalUploadFailure {
  ok: false
  error: string
}

export type OriginalUploadOutcome = OriginalUploadResult | OriginalUploadFailure

/**
 * Rehost remote videos to UploadThing. UploadThing fetches each URL
 * server-side, so the caller never buffers the bytes. Order of the returned
 * array matches `urls`.
 */
export async function uploadOriginalsFromUrl(
  urls: readonly string[],
): Promise<OriginalUploadOutcome[]> {
  if (urls.length === 0) return []
  const results = await api().uploadFilesFromUrl(urls.slice())
  return results.map((r) => {
    if (r.error !== null) {
      return { ok: false, error: `${r.error.code}: ${r.error.message}` }
    }
    return {
      ok: true,
      url: r.data.ufsUrl,
      key: r.data.key,
      bytes: r.data.size,
      mime: r.data.type,
    }
  })
}

export async function uploadSrt(srt: string, filename: string): Promise<UploadedSrt> {
  const file = new File([srt], filename, { type: "text/plain" })
  const result = await api().uploadFiles(file)
  if (result.error !== null) {
    throw new Error(`uploadSrt: UploadThing error ${result.error.code}: ${result.error.message}`)
  }
  return { url: result.data.ufsUrl, key: result.data.key }
}

/**
 * `new File([buffer], …)` accepts BlobPart. Wrap in a Blob so TS picks the
 * correct overload regardless of @types/node Buffer-vs-Uint8Array variance.
 */
function toBlob(buffer: Buffer): Blob {
  // Copy into a fresh Uint8Array to detach from any pooled allocator backing.
  const bytes = new Uint8Array(buffer.byteLength)
  bytes.set(buffer)
  return new Blob([bytes])
}
