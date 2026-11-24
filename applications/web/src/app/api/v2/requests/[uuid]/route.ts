import { NextResponse } from "next/server"

import { withHasPermission } from "@/auth/auth"
import { getBookRequestEvents } from "@/database/bookRequests"
import {
  disabledResponse,
  requestErrorResponse,
  toRequestView,
} from "@/requests/http"
import { getRequestRuntime } from "@/requests/runtime"
import { getOwnRequest } from "@/requests/service"
import { type UUID } from "@/uuid"

export const dynamic = "force-dynamic"

type Params = Promise<{ uuid: UUID }>

/**
 * @summary One of your book requests, with its history
 * @desc Answers 403 for a request that belongs to another account, without
 *       anything about it.
 */
export const GET = withHasPermission<Params>("bookRead")(async (
  request,
  context,
) => {
  if (!getRequestRuntime()) return disabledResponse()
  const { uuid } = await context.params
  try {
    const own = await getOwnRequest(request.auth.user.id, uuid)
    const events = await getBookRequestEvents(uuid)
    return NextResponse.json({
      ...(await toRequestView(own)),
      events: events.map(({ kind, message, createdAt }) => ({
        kind,
        message,
        createdAt,
      })),
    })
  } catch (error) {
    return requestErrorResponse(error)
  }
})
