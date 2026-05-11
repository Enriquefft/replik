import { aptGet, ffmpeg } from "@trigger.dev/build/extensions/core"
import { defineConfig } from "@trigger.dev/sdk"

export default defineConfig({
  project: "proj_ogygdrycynllnhadsrwq",
  dirs: ["./src/server/trigger"],
  runtime: "bun",
  maxDuration: 600,
  build: {
    external: ["onnxruntime-node"],
    extensions: [
      ffmpeg(),
      aptGet({
        packages: ["fonts-dejavu", "fonts-liberation"],
      }),
    ],
  },
})
