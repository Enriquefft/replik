import { runs } from "@trigger.dev/sdk"

const list = runs.list({
  taskIdentifier: ["scrape-product", "rehostCreatives", "translateAndBurnSubs"],
  limit: 10,
})
const out: Array<Record<string, unknown>> = []
for await (const r of list) {
  out.push({
    id: r.id,
    task: r.taskIdentifier,
    status: r.status,
    isExecuting: r.isExecuting,
    isCompleted: r.isCompleted,
    isFailed: r.isFailed,
    createdAt: r.createdAt,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    durationMs: r.durationMs,
  })
}
console.log(JSON.stringify(out, null, 2))
