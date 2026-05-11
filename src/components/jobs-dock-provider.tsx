"use client"

import { usePathname } from "next/navigation"
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react"
import { useRunCompletionToast } from "@/hooks/use-run-completion-toast.ts"
import { type ActiveRunsResponse, listActiveRuns } from "@/server/actions/active-runs.ts"

const EMPTY: ActiveRunsResponse = { runs: [], accessToken: "" }
const REFETCH_INTERVAL_MS = 30_000

interface JobsDockContextValue {
  data: ActiveRunsResponse
  loading: boolean
  refetch: () => void
}

const JobsDockContext = createContext<JobsDockContextValue | null>(null)

/**
 * Mounts once in the root layout. Owns the single `listActiveRuns` feed
 * shared by both `<JobsDock>` (visual pill) and `useRunCompletionToast`
 * (toast + title flash). A single source means the toast hook never
 * disagrees with the dock about what's in flight.
 *
 * Refetch triggers:
 *   - Initial mount
 *   - Every 30s while mounted
 *   - On Next.js route change (`usePathname` flip) — covers the case
 *     where a user navigates away from a flow page and the dock would
 *     otherwise show a stale row until the next interval tick.
 */
export function JobsDockProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [data, setData] = useState<ActiveRunsResponse>(EMPTY)
  const [loading, setLoading] = useState(true)
  const pathname = usePathname()

  const refetch = useCallback((): void => {
    const run = async (): Promise<void> => {
      try {
        const next = await listActiveRuns()
        setData(next)
      } finally {
        setLoading(false)
      }
    }
    void run()
  }, [])

  // Initial + interval refetch.
  useEffect(() => {
    refetch()
    const id = setInterval(refetch, REFETCH_INTERVAL_MS)
    return () => {
      clearInterval(id)
    }
  }, [refetch])

  // Refetch on route change. The effect reads `pathname` so biome sees
  // it as a real dep — without that the rule flags it as unused, but the
  // semantic intent IS "fire whenever the route changes". A `void` read
  // expresses that without false-firing on identical paths.
  useEffect(() => {
    void pathname
    refetch()
  }, [pathname, refetch])

  return (
    <JobsDockContext.Provider value={{ data, loading, refetch }}>
      <ChildrenWithToast>{children}</ChildrenWithToast>
    </JobsDockContext.Provider>
  )
}

/**
 * The completion-toast hook must be called inside the provider tree so
 * it can read the active-runs feed. Splitting it into a child component
 * keeps `JobsDockProvider` itself a pure container.
 */
function ChildrenWithToast({ children }: { children: ReactNode }): React.JSX.Element {
  useRunCompletionToast()
  return <>{children}</>
}

export function useJobsDockContext(): JobsDockContextValue {
  const ctx = useContext(JobsDockContext)
  if (ctx === null) {
    throw new Error("useJobsDockContext must be used inside <JobsDockProvider>")
  }
  return ctx
}
