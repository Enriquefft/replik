/**
 * Throwaway smoke test: run ppu-paddle-ocr against a single frame to
 * confirm the library works end-to-end inside our Bun environment.
 *
 * Passes the image as an ArrayBuffer (read via fs) because file-path inputs
 * hit a getContext crash inside ppu-ocv's loadImage in this environment.
 */

import { readFile } from "node:fs/promises"
import { PaddleOcrService } from "ppu-paddle-ocr"

async function main(): Promise<void> {
  const imagePath = process.argv[2] ?? "/tmp/ocr-test-frame.png"
  console.log(`OCR target: ${imagePath}`)

  const buf = await readFile(imagePath)
  const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  console.log(`image bytes: ${arrayBuf.byteLength.toString()}`)

  const service = new PaddleOcrService({ debugging: { debug: false, verbose: true } })
  console.log("initialize…")
  await service.initialize()

  const t0 = Date.now()
  const result = await service.recognize(arrayBuf)
  const ms = Date.now() - t0
  console.log(`recognize took ${ms.toString()}ms`)
  if (!("lines" in result)) throw new Error("expected grouped result")
  console.log(`#lines: ${result.lines.length.toString()}`)
  console.log("text:", result.text)
  console.log("--- lines ---")
  for (const line of result.lines) {
    console.log(JSON.stringify(line))
  }

  await service.destroy()
}

void main()
