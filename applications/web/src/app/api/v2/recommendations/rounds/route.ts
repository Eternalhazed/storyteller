import { NextResponse } from "next/server"
import { z } from "zod"

import { withHasPermission } from "@/auth/auth"
import { getRunningRound } from "@/database/recommendations"
import { getAiConfig } from "@/recommendations/ai"
import {
  disabledRecommendations,
  recommendationErrorResponse,
} from "@/recommendations/http"
import {
  SeriesLengthsSchema,
  SubjectListSchema,
} from "@/recommendations/preferenceSchemas"
import { startRound } from "@/recommendations/rounds"
import { clearFinishWindow } from "@/recommendations/triggers"
import {
  MANUAL_REFRESHES_PER_DAY,
  refreshesUsedToday,
  toRoundView,
} from "@/recommendations/views"
import { UuidSchema, parseBody } from "@/requests/http"

export const dynamic = "force-dynamic"

const AnswersSchema = z.object({
  goal: z.enum(["continue", "new", "like", "surprise"]).nullable().optional(),
  likedBooks: z.array(z.string().max(200)).max(5).optional(),
  seriesShape: z.enum(["series", "standalone", "either"]).optional(),
  seriesLength: SeriesLengthsSchema.optional(),
  subjects: SubjectListSchema.optional(),
  freeText: z.string().max(500).nullable().optional(),
  format: z.enum(["read", "listen", "readalong", "any"]).optional(),
  saveAsUsual: z.boolean().optional(),
})

const StartSchema = z.object({
  answers: AnswersSchema.optional(),
  wish: z.string().trim().min(1).max(500).optional(),
  anchorBookUuid: UuidSchema.optional(),
  refresh: z.boolean().optional(),
})

/**
 * @summary Start a recommendation round
 * @desc With `answers` (the interview), `wish` (free text), `anchorBookUuid`
 *       (a book you just finished) or `refresh: true`. Returns the round,
 *       which runs in the background; if one is already running for you,
 *       that one is returned. Refresh is limited to three a day.
 */
export const POST = withHasPermission("bookRead")(async (request) => {
  if (!(await getAiConfig())) return disabledRecommendations()
  const body = await parseBody(request, StartSchema)
  if (!body.ok) return body.response
  const userId = request.auth.user.id
  const { answers, wish, anchorBookUuid, refresh } = body.data
  try {
    const running = await getRunningRound(userId)
    if (running) return NextResponse.json(toRoundView(running), { status: 202 })
    let round
    if (anchorBookUuid) {
      await clearFinishWindow(userId).catch(() => undefined)
      round = await startRound(userId, "finished", { anchorBookUuid })
    } else if (answers) {
      round = await startRound(userId, "tune", { answers })
    } else if (wish) {
      round = await startRound(userId, "wish", { wish })
    } else {
      if (!refresh) {
        return NextResponse.json(
          { message: "Say what the round is for", code: "empty" },
          { status: 400 },
        )
      }
      if ((await refreshesUsedToday(userId)) >= MANUAL_REFRESHES_PER_DAY) {
        return NextResponse.json(
          {
            message: `You can refresh ${MANUAL_REFRESHES_PER_DAY} times a day`,
            code: "refresh-limit",
          },
          { status: 429 },
        )
      }
      round = await startRound(userId, "refresh")
    }
    return NextResponse.json(toRoundView(round), { status: 202 })
  } catch (error) {
    return recommendationErrorResponse(error)
  }
})
