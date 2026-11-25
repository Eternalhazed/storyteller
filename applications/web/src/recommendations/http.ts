import { NextResponse } from "next/server"

import { logger } from "@/logging"

import { PickError } from "./state"

export const disabledRecommendations = () =>
  NextResponse.json(
    {
      message: "Recommendations are not set up on this server",
      code: "disabled",
    },
    { status: 404 },
  )

/** Turn a refusal into its answer; anything else is a logged 500. */
export function recommendationErrorResponse(error: unknown): Response {
  if (error instanceof PickError) {
    return NextResponse.json(
      { message: error.message, code: error.code },
      { status: error.status },
    )
  }
  logger.error({
    msg: "Recommendation request failed",
    error: error instanceof Error ? error.message : String(error),
  })
  return NextResponse.json(
    { message: "Something went wrong", code: "internal" },
    { status: 500 },
  )
}
