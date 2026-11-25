import { NextResponse } from "next/server"
import { z } from "zod"

import { withHasPermission } from "@/auth/auth"
import { getUnmarkedImportedLibraryReads } from "@/database/readingHistory"
import { STATUS_READ } from "@/database/statusKinds"
import { getStatuses, updateStatusForBooks } from "@/database/statuses"
import { HistoryUuidSchema, historyError, readJson } from "@/history/http"

export const dynamic = "force-dynamic"

const LibraryReadsSchema = z.strictObject({
  bookUuids: z.array(HistoryUuidSchema).min(1),
})

export const GET = withHasPermission("bookRead")(async (request) => {
  return NextResponse.json({
    books: await getUnmarkedImportedLibraryReads(request.auth.user.id),
  })
})

export const POST = withHasPermission("bookRead")(async (request) => {
  const body = LibraryReadsSchema.safeParse(await readJson(request))
  if (!body.success)
    return historyError(
      "Choose imported books to mark as Read.",
      "invalid-books",
      400,
    )
  const userId = request.auth.user.id
  const eligible = new Set(
    (await getUnmarkedImportedLibraryReads(userId)).map(
      ({ bookUuid }) => bookUuid,
    ),
  )
  const selected = [...new Set(body.data.bookUuids)]
  if (selected.some((uuid) => !eligible.has(uuid))) {
    return historyError(
      "A selected book is no longer available to mark as Read. Refresh the list and try again.",
      "not-found",
      404,
    )
  }
  const read = (await getStatuses()).find(({ name }) => name === STATUS_READ)
  if (!read)
    return historyError(
      "Storyteller has no Read status.",
      "status-unavailable",
      500,
    )
  // This is an explicit bulk update, not a finish event or a recommendation trigger.
  for (let index = 0; index < selected.length; index += 500) {
    await updateStatusForBooks(
      read.uuid,
      selected.slice(index, index + 500),
      userId,
    )
  }
  return new Response(null, { status: 204 })
})
