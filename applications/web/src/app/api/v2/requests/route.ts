import { NextResponse } from "next/server"

import { withHasPermission } from "@/auth/auth"
import { getBookRequestsForUser } from "@/database/bookRequests"
import {
  CreateRequestSchema,
  disabledResponse,
  parseBody,
  requestErrorResponse,
  toRequestView,
} from "@/requests/http"
import { advanceRequests, getRequestRuntime } from "@/requests/runtime"
import { createRequest } from "@/requests/service"

export const dynamic = "force-dynamic"

/**
 * @summary List your book requests
 * @desc Newest first. Pass `open=true` for the ones still under way, as the
 *       Home card shows them.
 */
export const GET = withHasPermission("bookRead")(async (request) => {
  if (!getRequestRuntime()) return disabledResponse()
  const open = request.nextUrl.searchParams.get("open") === "true"
  const requests = await getBookRequestsForUser(request.auth.user.id, { open })
  return NextResponse.json(await Promise.all(requests.map(toRequestView)))
})

/**
 * @summary Request a book
 * @desc Starts getting the chosen ebook and/or audiobook release. Each is
 *       checked for seeders right before it is accepted; the book goes on
 *       the shelf set for requests.
 */
export const POST = withHasPermission("bookRead")(async (request) => {
  const runtime = getRequestRuntime()
  if (!runtime) return disabledResponse()
  const body = await parseBody(request, CreateRequestSchema)
  if (!body.ok) return body.response
  try {
    const created = await createRequest(
      request.auth.user.id,
      body.data,
      runtime.adapter,
    )
    void advanceRequests()
    return NextResponse.json(await toRequestView(created), { status: 201 })
  } catch (error) {
    return requestErrorResponse(error)
  }
})
