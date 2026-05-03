import { runs } from "@trigger.dev/sdk"

const id = process.argv[2]
if (!id) throw new Error("usage: run-detail <runId>")
const r = await runs.retrieve(id)
console.log(
  JSON.stringify(
    {
      id: r.id,
      status: r.status,
      output: r.output,
      error: r.error,
      durationMs: r.durationMs,
    },
    null,
    2,
  ),
)
