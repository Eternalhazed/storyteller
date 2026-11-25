import { NextResponse } from "next/server"

import { withHasPermission } from "@/auth/auth"
import { getPicksOfRounds, getRound } from "@/database/recommendations"
import { getAiConfig } from "@/recommendations/ai"
import { disabledRecommendations } from "@/recommendations/http"
import { toPickView, toRoundView } from "@/recommendations/views"
import { type UUID } from "@/uuid"

export const dynamic = "force-dynamic"

type Params = Promise<{ uuid: UUID }>

/** @summary One of your recommendation rounds, with its picks */
export const GET = withHasPermission<Params>("bookRead")(async (
  request,
  context,
) => {
  if (!(await getAiConfig())) return disabledRecommendations()
  const { uuid } = await context.params
  const round = await getRound(uuid)
  if (!round || round.userId !== request.auth.user.id) {
    return NextResponse.json(
      { message: "No such round", code: "not-found" },
      { status: 404 },
    )
  }
  const picks = await getPicksOfRounds([uuid])
  return NextResponse.json({
    ...toRoundView(round),
    picks: picks.map(toPickView),
  })
})
