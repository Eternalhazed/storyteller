import { withUser } from "@/auth/auth"
import { removeUserDevice } from "@/database/userDevices"

export const dynamic = "force-dynamic"

type Params = Promise<{ installId: string }>

/** @summary Stop notifications to this app install (on sign-out) */
export const DELETE = withUser<Params>(async (request, context) => {
  const { installId } = await context.params
  await removeUserDevice(installId, request.auth.user.id)
  return new Response(null, { status: 204 })
})
