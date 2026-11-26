import { NextResponse } from "next/server"

import { withHasPermission } from "@/auth/auth"
import { ensureReader, preferencesOf } from "@/database/recommendations"
import { getAiConfig } from "@/recommendations/ai"
import { disabledRecommendations } from "@/recommendations/http"
import {
  buildProfile,
  isColdStart,
  loadReaderData,
} from "@/recommendations/reader"
import { uniqueSubjects } from "@/recommendations/subjects"
import { type InterviewView } from "@/recommendations/types"

export const dynamic = "force-dynamic"

/**
 * @summary The questions for steering a round
 * @desc Preselected from your preferences; subject chips come from your own
 *       reading. The format question is asked only when you both read and
 *       listen.
 */
export const GET = withHasPermission("bookRead")(async (request) => {
  if (!(await getAiConfig())) return disabledRecommendations()
  const userId = request.auth.user.id
  const prefs = preferencesOf(await ensureReader(userId))
  const data = await loadReaderData(userId, prefs)
  const profile = buildProfile(data)
  const view: InterviewView = {
    coldStart: isColdStart(data),
    goal: null,
    seriesShape: prefs.seriesShape,
    seriesLength: prefs.seriesLength,
    subjects: uniqueSubjects(
      profile.subjects.map((subject) => subject.name),
    ).slice(0, 8),
    askFormat: profile.formats.listened > 0 && profile.formats.read > 0,
    format: prefs.format,
  }
  return NextResponse.json(view)
})
