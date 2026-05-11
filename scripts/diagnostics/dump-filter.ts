import { buildFilterChain } from "@/lib/video/burnSubs.ts"

const out = buildFilterChain({
  assPath: "/tmp/x.ass",
  bands: [
    {
      topFraction: 0.755,
      heightFraction: 0.245,
      confidence: 0.95,
      activeStartSec: 0,
      activeEndSec: 10,
      kind: "dialog",
    },
  ],
  dimensions: { width: 360, height: 640 },
  fontsDir: "/home/hybridz/Projects/replik/assets/fonts",
})
console.log(out)
