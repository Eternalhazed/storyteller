import { NextResponse } from "next/server"

import { withHasPermission } from "@/auth/auth"
import { getAiConfig } from "@/recommendations/ai"
import {
  answerHelper,
  helperRequestSchema,
  openHelper,
} from "@/recommendations/helper"
import {
  disabledRecommendations,
  recommendationErrorResponse,
} from "@/recommendations/http"
import { parseBody } from "@/requests/http"

export const dynamic = "force-dynamic"

/** @summary Open the Reading helper with suggestions based on your reading */
export const GET = withHasPermission("bookRead")(async (request) => {
  if (!(await getAiConfig())) return disabledRecommendations()
  try {
    return NextResponse.json(await openHelper(request.auth.user.id))
  } catch (error) {
    return recommendationErrorResponse(error)
  }
})

/** @summary Continue a Reading helper conversation and return its next action */
export const POST = withHasPermission("bookRead")(async (request) => {
  const ai = await getAiConfig()
  if (!ai) return disabledRecommendations()
  const body = await parseBody(request, helperRequestSchema)
  if (!body.ok) return body.response
  try {
    return NextResponse.json(
      await answerHelper(request.auth.user.id, ai, body.data.messages),
    )
  } catch (error) {
    return recommendationErrorResponse(error)
  }
})
