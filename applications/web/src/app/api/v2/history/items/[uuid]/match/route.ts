import { z } from "zod"

import { withHasPermission } from "@/auth/auth"
import { getCatalog } from "@/catalog"
import { getHistoryItem, setItemMatch } from "@/database/readingHistory"
import { HistoryUuidSchema, historyError, readJson } from "@/history/http"
import { historyLinkTargets, saveHistoryMatch } from "@/history/importer"
import { historyChanged } from "@/recommendations/triggers"

export const dynamic = "force-dynamic"

const MatchSchema = z.union([
  z.strictObject({ key: z.string().trim().min(1).max(100) }),
  z.strictObject({ ignore: z.literal(true) }),
])

export const PUT = withHasPermission<Promise<{ uuid: string }>>("bookRead")(
  async (request, context) => {
    const userId = request.auth.user.id
    const uuid = HistoryUuidSchema.safeParse((await context.params).uuid)
    const item = uuid.success ? await getHistoryItem(userId, uuid.data) : null
    if (!item || item.matchStatus !== "unmatched") {
      return historyError("No such unmatched item.", "not-found", 404)
    }
    const match = MatchSchema.safeParse(await readJson(request))
    if (!match.success)
      return historyError(
        "Choose a catalog match or ignore this item.",
        "invalid-match",
        400,
      )

    let updated: boolean
    if ("ignore" in match.data) {
      updated = await setItemMatch(
        userId,
        item.uuid,
        { matchStatus: "ignored" },
        "unmatched",
      )
    } else {
      const { key } = match.data
      let work
      try {
        work = (await getCatalog().getWorks([key])).get(key)
      } catch {
        return historyError(
          "Could not look up that book right now.",
          "catalog-unavailable",
          502,
        )
      }
      if (!work) return historyError("No such catalog book.", "not-found", 404)
      updated = await saveHistoryMatch(
        item,
        work,
        "reader",
        await historyLinkTargets(userId),
        "unmatched",
      )
    }
    if (!updated)
      return historyError("No such unmatched item.", "not-found", 404)
    await historyChanged(userId, "match")
    return new Response(null, { status: 204 })
  },
)
