import { NextResponse } from "next/server"

import { withHasPermission } from "@/auth/auth"
import { getAiConfig } from "@/recommendations/ai"
import { type RecommendationsConfig } from "@/recommendations/types"
import { getRequestRuntime } from "@/requests/runtime"

export const dynamic = "force-dynamic"

/**
 * @summary Whether recommendations and Ask work here
 * @desc `enabled` is false when no Anthropic API key is set; every
 *       recommendation control should then be hidden. `requestsEnabled`
 *       says whether Get can open the request picker.
 */
export const GET = withHasPermission("bookRead")(async () => {
  const config: RecommendationsConfig = {
    enabled: !!(await getAiConfig()),
    requestsEnabled: !!getRequestRuntime(),
  }
  return NextResponse.json(config)
})
