"use server"

import { requireUser } from "@/db/client"
import type { DashboardData } from "@/server/dashboard"
import { getDashboardData } from "@/server/dashboard"
import type { ActionResult } from "./types.ts"

export async function getDashboard(): Promise<ActionResult<DashboardData>> {
  const { userId } = await requireUser()
  const data = await getDashboardData(userId)
  return { ok: true, data }
}
