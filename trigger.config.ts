import { aptGet, ffmpeg } from "@trigger.dev/build/extensions/core"
import { defineConfig } from "@trigger.dev/sdk"

import { parseTaskErrorPayload } from "@/lib/errors/task-error.ts"
import { recordTaskFinish } from "@/server/telemetry/task-runs.ts"

export default defineConfig({
  project: "proj_ogygdrycynllnhadsrwq",
  dirs: ["./src/server/trigger"],
  runtime: "bun",
  maxDuration: 600,
  // Global lifecycle hooks. We write the terminal `task_runs` row
  // (`completed` / `failed`) from here instead of from every task body
  // because (a) the trigger run id is the only identifier the global
  // hook carries and (b) `recordTaskFinish` resolves `userId` from the
  // existing `task_runs` row (inserted at the server-action site by
  // `recordTaskStart`) so the tenant scoping contract is preserved.
  // Both helpers are fail-open — telemetry failures never block the task.
  onSuccess: async ({ ctx }) => {
    await recordTaskFinish({
      triggerRunId: ctx.run.id,
      status: "completed",
      errorCode: null,
    })
  },
  onFailure: async ({ ctx, error }) => {
    const rawMessage = error instanceof Error ? error.message : String(error)
    const payload = parseTaskErrorPayload(rawMessage)
    await recordTaskFinish({
      triggerRunId: ctx.run.id,
      status: "failed",
      errorCode: payload?.code ?? null,
    })
  },
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
