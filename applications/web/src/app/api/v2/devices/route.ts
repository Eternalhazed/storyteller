import { z } from "zod"

import { withUser } from "@/auth/auth"
import { registerUserDevice } from "@/database/userDevices"
import { parseBody } from "@/requests/http"

export const dynamic = "force-dynamic"

/**
 * @summary Register this app install for notifications
 * @desc Call after signing in and after switching accounts. An install
 *       belongs to one account at a time; registering it for another account
 *       moves it there.
 */
export const PUT = withUser(async (request) => {
  const body = await parseBody(
    request,
    z.object({
      installId: z.string().min(8).max(200),
      platform: z.enum(["android", "ios"]),
      pushToken: z.string().min(1).max(4096).nullable(),
    }),
  )
  if (!body.ok) return body.response
  await registerUserDevice({ ...body.data, userId: request.auth.user.id })
  return new Response(null, { status: 204 })
})
