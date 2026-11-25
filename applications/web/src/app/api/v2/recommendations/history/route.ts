import { NextResponse } from "next/server"

import { withHasPermission } from "@/auth/auth"
import { getAiConfig } from "@/recommendations/ai"
import {
  disabledRecommendations,
  recommendationErrorResponse,
} from "@/recommendations/http"
import { buildHistoryView } from "@/recommendations/views"

export const dynamic = "force-dynamic"

/**
 * @summary Your earlier recommendation rounds
 * @desc Each round with what became of every pick (requested, finished,
 *       rated, turned down), and counts per section.
 */
export const GET = withHasPermission("bookRead")(async (request) => {
  if (!(await getAiConfig())) return disabledRecommendations()
  try {
    return NextResponse.json(await buildHistoryView(request.auth.user.id))
  } catch (error) {
    return recommendationErrorResponse(error)
  }
})
