import { NextResponse } from "next/server"

import { withHasPermission } from "@/auth/auth"
import {
  ensureReader,
  getRounds,
  preferencesOf,
} from "@/database/recommendations"
import { getAiConfig } from "@/recommendations/ai"
import {
  disabledRecommendations,
  recommendationErrorResponse,
} from "@/recommendations/http"
import { isColdStart, loadReaderData } from "@/recommendations/reader"
import { startRound } from "@/recommendations/rounds"
import { budgetSpent, buildRecommendationsView } from "@/recommendations/views"

export const dynamic = "force-dynamic"

/**
 * @summary Your current book recommendations
 * @desc Picks by section, the Home row, saved picks and the state of any
 *       round still running. The first visit starts your first round, unless
 *       there is too little reading history to go on (`coldStart`): then the
 *       app asks a few questions first.
 */
export const GET = withHasPermission("bookRead")(async (request) => {
  const ai = await getAiConfig()
  if (!ai) return disabledRecommendations()
  const userId = request.auth.user.id
  try {
    const reader = await ensureReader(userId)
    const data = await loadReaderData(userId, preferencesOf(reader))
    const rounds = await getRounds(userId, { limit: 1 })
    if (!rounds.length && !isColdStart(data) && !(await budgetSpent(ai))) {
      await startRound(userId, "first")
    }
    return NextResponse.json(await buildRecommendationsView(userId, data, ai))
  } catch (error) {
    return recommendationErrorResponse(error)
  }
})
