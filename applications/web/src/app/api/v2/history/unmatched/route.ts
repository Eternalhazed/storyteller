import { NextResponse } from "next/server"

import { withHasPermission } from "@/auth/auth"
import { getCatalog } from "@/catalog"
import { getHistoryItems } from "@/database/readingHistory"
import { historyError } from "@/history/http"
import { type UnmatchedItemView } from "@/history/types"

export const dynamic = "force-dynamic"

export const GET = withHasPermission("bookRead")(async (request) => {
  const rows = await getHistoryItems(request.auth.user.id, {
    matchStatus: "unmatched",
  })
  const catalog = getCatalog()
  const items: UnmatchedItemView[] = []
  try {
    for (const { uuid, source, title, authors, status, rating } of rows) {
      const candidates = await catalog.search({
        title,
        author: authors[0],
        limit: 3,
      })
      items.push({
        uuid,
        source,
        title,
        authors,
        status,
        rating,
        candidates: candidates
          .slice(0, 3)
          .map(({ key, title, authors, releaseDate }) => ({
            key,
            title,
            authors,
            releaseDate,
          })),
      })
    }
  } catch {
    return historyError(
      "Could not look up matching books right now.",
      "catalog-unavailable",
      502,
    )
  }
  return NextResponse.json({ items })
})
