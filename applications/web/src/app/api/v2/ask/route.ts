import { NextResponse } from "next/server"
import { z } from "zod"

import { withHasPermission } from "@/auth/auth"
import { ensureReader } from "@/database/recommendations"
import { getAiConfig } from "@/recommendations/ai"
import { ask } from "@/recommendations/ask"
import {
  disabledRecommendations,
  recommendationErrorResponse,
} from "@/recommendations/http"
import { parseBody } from "@/requests/http"

export const dynamic = "force-dynamic"

/**
 * @summary Ask for books in your own words
 * @desc "The Gates of Rome and Killer of Men" returns a card per book (with
 *       what is already true: on your shelf, in the library, or Get); an
 *       ambiguous title returns a question with choices; a title the catalog
 *       does not know is listed as not found. "I just finished X" and
 *       "something like Y" start a recommendation round. Nothing is
 *       requested from here.
 */
export const POST = withHasPermission("bookRead")(async (request) => {
  const ai = await getAiConfig()
  if (!ai) return disabledRecommendations()
  const body = await parseBody(
    request,
    z.object({ text: z.string().trim().min(1).max(1000) }),
  )
  if (!body.ok) return body.response
  const userId = request.auth.user.id
  try {
    await ensureReader(userId)
    return NextResponse.json(await ask(userId, ai, body.data.text))
  } catch (error) {
    return recommendationErrorResponse(error)
  }
})
