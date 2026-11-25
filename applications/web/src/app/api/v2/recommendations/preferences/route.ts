import { NextResponse } from "next/server"
import { z } from "zod"

import { withHasPermission } from "@/auth/auth"
import {
  ensureReader,
  preferencesOf,
  savePreferences,
} from "@/database/recommendations"
import { getAiConfig } from "@/recommendations/ai"
import { disabledRecommendations } from "@/recommendations/http"
import { parseBody } from "@/requests/http"

export const dynamic = "force-dynamic"

const PreferencesSchema = z
  .object({
    seriesShape: z.enum(["series", "standalone", "either"]),
    seriesLength: z.enum(["short", "medium", "long", "any"]),
    format: z.enum(["read", "listen", "readalong", "any"]),
    favorSubjects: z.array(z.string().trim().min(1).max(80)).max(20),
    avoidSubjects: z.array(z.string().trim().min(1).max(80)).max(20),
    useHistory: z.boolean(),
    notifyNewInSeries: z.boolean(),
    notifyNewPicks: z.boolean(),
  })
  .partial()

/** @summary Your standing recommendation preferences */
export const GET = withHasPermission("bookRead")(async (request) => {
  if (!(await getAiConfig())) return disabledRecommendations()
  const reader = await ensureReader(request.auth.user.id)
  return NextResponse.json(preferencesOf(reader))
})

/** @summary Change your standing recommendation preferences */
export const PUT = withHasPermission("bookRead")(async (request) => {
  if (!(await getAiConfig())) return disabledRecommendations()
  const body = await parseBody(request, PreferencesSchema)
  if (!body.ok) return body.response
  const userId = request.auth.user.id
  const prefs = { ...preferencesOf(await ensureReader(userId)), ...body.data }
  await savePreferences(userId, prefs)
  return NextResponse.json(prefs)
})
