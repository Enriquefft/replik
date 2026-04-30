import { defineConfig } from "@trigger.dev/sdk";
import { ffmpeg, aptGet } from "@trigger.dev/build/extensions/core";

const projectId = process.env.TRIGGER_PROJECT_ID;

if (!projectId) {
  throw new Error("TRIGGER_PROJECT_ID is not set");
}

export default defineConfig({
  project: projectId,
  dirs: ["./src/server/trigger"],
  maxDuration: 600,
  build: {
    extensions: [
      ffmpeg(),
      aptGet({
        packages: ["fonts-dejavu", "fonts-liberation"],
      }),
    ],
  },
});
