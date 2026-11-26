import { NextResponse } from "next/server"

import { withHasPermission } from "@/auth/auth"
import { getAiConfig } from "@/recommendations/ai"
import { type HelperConfig } from "@/recommendations/helper"
import { getSpeechConfig } from "@/recommendations/helperSpeech"
import { getRequestRuntime } from "@/requests/runtime"

export const dynamic = "force-dynamic"

/**
 * @summary Whether recommendations, Reading helper and dictation work here
 * @desc Recommendations and Reading helper require an Anthropic API key;
 *       dictation requires an OpenRouter API key. `requestsEnabled` says
 *       whether Get can open the request picker.
 */
export const GET = withHasPermission("bookRead")(async () => {
  const [ai, speech] = await Promise.all([getAiConfig(), getSpeechConfig()])
  const config: HelperConfig = {
    enabled: !!ai,
    helperEnabled: !!ai,
    speechEnabled: !!speech,
    requestsEnabled: !!getRequestRuntime(),
  }
  return NextResponse.json(config)
})
