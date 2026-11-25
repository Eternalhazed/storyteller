import { NextResponse } from "next/server"

import { withHasPermission } from "@/auth/auth"
import { deleteSourceItems } from "@/database/readingHistory"
import {
  HistoryItemSourceSchema,
  getHistorySummaries,
  historyError,
} from "@/history/http"
import { historyChanged } from "@/recommendations/triggers"

export const dynamic = "force-dynamic"

export const GET = withHasPermission("bookRead")(async (request) => {
  return NextResponse.json({
    sources: await getHistorySummaries(request.auth.user.id),
  })
})

export const DELETE = withHasPermission("bookRead")(async (request) => {
  const source = HistoryItemSourceSchema.safeParse(
    request.nextUrl.searchParams.get("source"),
  )
  if (!source.success)
    return historyError(
      "Unknown reading history source.",
      "unknown-source",
      400,
    )
  const userId = request.auth.user.id
  await deleteSourceItems(userId, source.data)
  await historyChanged(userId, "delete")
  return new Response(null, { status: 204 })
})
