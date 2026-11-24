import { z } from "zod"

import { withHasPermission } from "@/auth/auth"
import {
  UuidSchema,
  WorkSchema,
  disabledResponse,
  parseBody,
  requestErrorResponse,
} from "@/requests/http"
import { addCopyToShelf } from "@/requests/library"
import { getRequestRuntime } from "@/requests/runtime"

export const dynamic = "force-dynamic"

/**
 * @summary Add a copy of a book from another shelf to yours
 * @desc Only a copy the picker found for this book can be added. The files
 *       are shared; reading progress and everything else stays your own.
 */
export const POST = withHasPermission("bookRead")(async (request) => {
  if (!getRequestRuntime()) return disabledResponse()
  const body = await parseBody(
    request,
    z.object({ work: WorkSchema, bookUuid: UuidSchema }),
  )
  if (!body.ok) return body.response
  try {
    await addCopyToShelf(
      request.auth.user.id,
      body.data.work,
      body.data.bookUuid,
    )
    return new Response(null, { status: 204 })
  } catch (error) {
    return requestErrorResponse(error)
  }
})
