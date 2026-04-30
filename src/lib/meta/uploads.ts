import "server-only"

/**
 * Owner: Lane L4a (Meta wrapper).
 *
 * Asset uploads:
 *   - `videoUploadResumable` — Marketing API 3-call resumable upload
 *     (`upload_phase=start | transfer | finish`). The video is streamed
 *     from UploadThing (`file.url`) and chunked according to the byte
 *     window Meta hands back on each `transfer` response.
 *   - `imageUpload` — `/act_{id}/adimages` multipart with the raw bytes,
 *     keyed by filename. Returns the resulting image hash.
 *
 * Both flows go through `metaFetch` so they inherit retry + Meta error
 * mapping. We override `maxAttempts` for `transfer` to 1 — Meta's resumable
 * protocol assumes the *caller* re-issues the transfer for the next chunk
 * window, retrying inside a chunk would corrupt offsets.
 */

import { META_GRAPH_BASE } from "./accounts"
import { metaFetch } from "./http"
import {
  type ImageUploadResult,
  ImageUploadResultSchema,
  type MetaCreds,
  MetaError,
  type VideoUploadResult,
  VideoUploadResultSchema,
} from "./types"

function adAccountPath(creds: MetaCreds): string {
  const id = creds.ad_account_id.replace(/^act_/, "")
  return `${META_GRAPH_BASE}/act_${encodeURIComponent(id)}`
}

interface VideoStartResponse {
  upload_session_id: string
  video_id?: string
  start_offset: string
  end_offset: string
}

interface VideoTransferResponse {
  start_offset: string
  end_offset: string
}

interface VideoFinishResponse {
  success: boolean
  video_id?: string
}

async function downloadFile(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { cache: "no-store" })
  if (!response.ok) {
    throw new MetaError({
      code: 0,
      friendly: "No se pudo descargar el archivo desde el almacenamiento.",
      message: `download ${url} → ${String(response.status)}`,
    })
  }
  return await response.arrayBuffer()
}

export async function videoUploadResumable(
  creds: MetaCreds,
  file: { url: string; sizeBytes: number; filename: string },
): Promise<VideoUploadResult> {
  const buffer = await downloadFile(file.url)
  const fileSize = buffer.byteLength > 0 ? buffer.byteLength : file.sizeBytes
  if (fileSize <= 0) {
    throw new MetaError({
      code: 0,
      friendly: "El archivo de video está vacío.",
      message: "videoUploadResumable: empty file",
    })
  }

  const advideosUrl = `${adAccountPath(creds)}/advideos`

  // Phase 1: start
  const startForm: Record<string, string> = {
    access_token: creds.token,
    upload_phase: "start",
    file_size: String(fileSize),
  }
  const startRes = await metaFetch(advideosUrl, {
    method: "POST",
    form: startForm,
    creds,
  })
  const startBody = (await startRes.json()) as VideoStartResponse

  const sessionId = startBody.upload_session_id
  let startOffset = Number(startBody.start_offset)
  let endOffset = Number(startBody.end_offset)
  let videoId = startBody.video_id

  // Phase 2: transfer (loop until start === end, signaling completion)
  while (startOffset < endOffset) {
    const chunk = buffer.slice(startOffset, endOffset)
    const formData = new FormData()
    formData.set("access_token", creds.token)
    formData.set("upload_phase", "transfer")
    formData.set("upload_session_id", sessionId)
    formData.set("start_offset", String(startOffset))
    formData.set(
      "video_file_chunk",
      new Blob([chunk], { type: "application/octet-stream" }),
      file.filename,
    )

    const transferRes = await metaFetch(advideosUrl, {
      method: "POST",
      body: formData,
      creds,
      maxAttempts: 1,
    })
    const transferBody = (await transferRes.json()) as VideoTransferResponse
    const nextStart = Number(transferBody.start_offset)
    const nextEnd = Number(transferBody.end_offset)
    if (Number.isNaN(nextStart) || Number.isNaN(nextEnd) || nextStart < startOffset) {
      throw new MetaError({
        code: 0,
        friendly: "Meta devolvió offsets inválidos durante la subida.",
        message: `bad transfer offsets ${transferBody.start_offset}/${transferBody.end_offset}`,
      })
    }
    startOffset = nextStart
    endOffset = nextEnd
  }

  // Phase 3: finish
  const finishForm: Record<string, string> = {
    access_token: creds.token,
    upload_phase: "finish",
    upload_session_id: sessionId,
  }
  const finishRes = await metaFetch(advideosUrl, {
    method: "POST",
    form: finishForm,
    creds,
  })
  const finishBody = (await finishRes.json()) as VideoFinishResponse
  if (!finishBody.success) {
    throw new MetaError({
      code: 0,
      friendly: "La subida del video no se pudo finalizar.",
      message: "videoUploadResumable: finish returned success=false",
    })
  }
  if (finishBody.video_id) videoId = finishBody.video_id
  if (!videoId) {
    throw new MetaError({
      code: 0,
      friendly: "Meta no devolvió un video_id.",
      message: "videoUploadResumable: missing video_id",
    })
  }

  return VideoUploadResultSchema.parse({ video_id: videoId })
}

interface AdImagesResponse {
  images?: Record<string, { hash?: string; url?: string }>
}

export async function imageUpload(
  creds: MetaCreds,
  file: { url: string; filename: string },
): Promise<ImageUploadResult> {
  const buffer = await downloadFile(file.url)
  const formData = new FormData()
  formData.set("access_token", creds.token)
  formData.set(
    file.filename,
    new Blob([buffer], { type: "application/octet-stream" }),
    file.filename,
  )

  const url = `${adAccountPath(creds)}/adimages`
  const response = await metaFetch(url, {
    method: "POST",
    body: formData,
    creds,
  })
  const body = (await response.json()) as AdImagesResponse

  const entries = Object.values(body.images ?? {})
  const first = entries[0]
  if (!first?.hash || !first.url) {
    throw new MetaError({
      code: 0,
      friendly: "Meta no devolvió un hash de imagen.",
      message: "imageUpload: missing hash/url",
    })
  }
  return ImageUploadResultSchema.parse({
    image_hash: first.hash,
    url: first.url,
  })
}
