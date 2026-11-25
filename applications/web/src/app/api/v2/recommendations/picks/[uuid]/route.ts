import { NextResponse } from "next/server"
import { z } from "zod"

import { withHasPermission } from "@/auth/auth"
import { getPick } from "@/database/recommendations"
import { getAiConfig } from "@/recommendations/ai"
import {
  disabledRecommendations,
  recommendationErrorResponse,
} from "@/recommendations/http"
import { setPickState } from "@/recommendations/state"
import { READER_PICK_STATES } from "@/recommendations/types"
import { toPickView } from "@/recommendations/views"
import { parseBody } from "@/requests/http"
import { type UUID } from "@/uuid"

export const dynamic = "force-dynamic"

type Params = Promise<{ uuid: UUID }>

/** @summary One of your recommendations */
export const GET = withHasPermission<Params>("bookRead")(async (
  request,
  context,
) => {
  if (!(await getAiConfig())) return disabledRecommendations()
  const { uuid } = await context.params
  const pick = await getPick(request.auth.user.id, uuid)
  if (!pick) {
    return NextResponse.json(
      { message: "No such recommendation", code: "not-found" },
      { status: 404 },
    )
  }
  return NextResponse.json(toPickView(pick))
})

const StateSchema = z.object({
  state: z.enum(READER_PICK_STATES),
  reason: z.string().max(200).nullable().optional(),
  rating: z.number().min(0).max(5).nullable().optional(),
})

/**
 * @summary Save, put off, turn down or mark a recommendation read
 * @desc `not_now` rests it for eight weeks, `not_for_me` for good (with an
 *       optional reason), `already_read` records the read (and `rating`),
 *       `not_found` rests it for four weeks, `new` undoes Save.
 */
export const PUT = withHasPermission<Params>("bookRead")(async (
  request,
  context,
) => {
  if (!(await getAiConfig())) return disabledRecommendations()
  const { uuid } = await context.params
  const body = await parseBody(request, StateSchema)
  if (!body.ok) return body.response
  try {
    const pick = await setPickState(
      request.auth.user.id,
      uuid,
      body.data.state,
      {
        reason: body.data.reason ?? null,
        rating: body.data.rating ?? null,
      },
    )
    return NextResponse.json(toPickView(pick))
  } catch (error) {
    return recommendationErrorResponse(error)
  }
})
