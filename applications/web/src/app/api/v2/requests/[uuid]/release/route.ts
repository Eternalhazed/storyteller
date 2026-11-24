import { NextResponse } from "next/server"
import { z } from "zod"

import { withHasPermission } from "@/auth/auth"
import {
  ReleaseRefSchema,
  disabledResponse,
  parseBody,
  requestErrorResponse,
  toRequestView,
} from "@/requests/http"
import { advanceRequests, getRequestRuntime } from "@/requests/runtime"
import { chooseRelease } from "@/requests/service"
import { REQUEST_FORMATS } from "@/requests/types"
import { type UUID } from "@/uuid"

export const dynamic = "force-dynamic"

type Params = Promise<{ uuid: UUID }>

/**
 * @summary Pick another version of the ebook or audiobook
 * @desc For a format whose release lost its seeders, stalled or failed. A
 *       stalled download is left to finish if a seeder returns.
 */
export const POST = withHasPermission<Params>("bookRead")(async (
  request,
  context,
) => {
  const runtime = getRequestRuntime()
  if (!runtime) return disabledResponse()
  const { uuid } = await context.params
  const body = await parseBody(
    request,
    z.object({ format: z.enum(REQUEST_FORMATS), release: ReleaseRefSchema }),
  )
  if (!body.ok) return body.response
  try {
    const updated = await chooseRelease(
      request.auth.user.id,
      uuid,
      body.data.format,
      body.data.release,
      runtime.adapter,
    )
    void advanceRequests()
    return NextResponse.json(await toRequestView(updated))
  } catch (error) {
    return requestErrorResponse(error)
  }
})
