import { addMinutes, isPast } from "date-fns"
import { type JwtPayload, sign, verify } from "jsonwebtoken"
import { type NextRequest } from "next/server"

import {
  createSessionTokenForUserId,
  nextAuth,
  readSecretKey,
} from "@/auth/auth"
import { getUserByUsernameOrEmail } from "@/database/users"
import { logger } from "@/logging"

const JWT_ALGORITHM = "HS256"

// 35 years — Leave mobile app logged in basically
// indefinitely
export const maxAge = 35 * 365 * 24 * 60 * 60

export async function createAccessToken(
  data: Record<string, string>,
  expires: Date,
) {
  const payload = {
    ...data,
    exp: expires.valueOf(),
  }

  return sign(payload, await readSecretKey(), { algorithm: JWT_ALGORITHM })
}

const callbackUrl = "storyteller://settings"
const tokenPath = "/api/v2/token/app"

const issueToken: ReturnType<typeof nextAuth.auth> = await (nextAuth.auth(
  async (request) => {
    if (request.auth) {
      const token = await createAccessToken(
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        { sub: request.auth.user.username! },
        addMinutes(new Date(), 5),
      )

      return new Response(null, {
        status: 302,
        headers: { Location: `${callbackUrl}?token=${token}` },
      })
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: `/login?callbackUrl=${encodeURIComponent(tokenPath)}`,
      },
    })
    // We have to do a cast here because NextAuthResult is
    // typed incorrectly: the `auth` function becmomes async
    // when passed a lazy init function
  },
) as unknown as Promise<ReturnType<typeof nextAuth.auth>>)

type RouteHandler = (
  request: NextRequest,
  context: unknown,
) => Promise<Response>

/**
 * Starts the app's browser sign-in. With `?prompt=login` the browser's
 * existing web session is signed out first, so the app can switch to a
 * different account instead of silently reusing the current one.
 */
export async function GET(request: NextRequest, context: unknown) {
  if (request.nextUrl.searchParams.get("prompt") === "login") {
    await nextAuth.signOut({
      redirectTo: `/login?callbackUrl=${encodeURIComponent(tokenPath)}`,
    })
  }
  return (issueToken as unknown as RouteHandler)(request, context)
}

export async function POST(request: NextRequest) {
  const unauthorized = new Response(null, { status: 401 })

  const { token } = (await request.json()) as { token: string }

  const payload = verify(token, await readSecretKey(), {
    algorithms: [JWT_ALGORITHM],
    complete: false,
  }) as JwtPayload

  const expiration = payload.exp
  if (!expiration || isPast(expiration)) {
    logger.debug(`Short-lived token exired: ${expiration}`)
    return unauthorized
  }

  const username = payload.sub
  if (!username) {
    logger.debug(`Short-lived token missing username`)
    return unauthorized
  }

  const user = await getUserByUsernameOrEmail(username)
  if (!user) {
    logger.debug(`Failed to get user for username: ${username}`)
    return unauthorized
  }

  try {
    const session = await createSessionTokenForUserId(user.id, maxAge)
    return Response.json(session)
  } catch (e) {
    logger.error({ msg: "Failed to create session for user", err: e })
    return unauthorized
  }
}
