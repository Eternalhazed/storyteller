import { NextResponse } from "next/server"

import { withHasPermission } from "@/auth/auth"
import {
  disabledResponse,
  requestErrorResponse,
  toRequestView,
} from "@/requests/http"
import { getRequestRuntime } from "@/requests/runtime"
import { retrySync } from "@/requests/service"
import { type UUID } from "@/uuid"

export const dynamic = "force-dynamic"

type Params = Promise<{ uuid: UUID }>

/** @summary Queue the narration sync again after it failed */
export const POST = withHasPermission<Params>("bookRead")(async (
  request,
  context,
) => {
  if (!getRequestRuntime()) return disabledResponse()
  const { uuid } = await context.params
  try {
    const updated = await retrySync(request.auth.user.id, uuid)
    return NextResponse.json(await toRequestView(updated))
  } catch (error) {
    return requestErrorResponse(error)
  }
})
