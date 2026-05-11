import { defineConfig } from "@trigger.dev/sdk";
import { ffmpeg, aptGet } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: "proj_ogygdrycynllnhadsrwq",
  dirs: ["./src/server/trigger"],
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
});
