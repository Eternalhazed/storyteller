import { createSign } from "node:crypto"
import { readFileSync } from "node:fs"

import { z } from "zod"

import { getAlignmentReportForBook } from "@/database/alignmentReports"
import { type BookRequest } from "@/database/bookRequests"
import { getBook } from "@/database/books"
import { clearPushToken, getPushTokens } from "@/database/userDevices"
import { env } from "@/env"
import { logger } from "@/logging"
import { type UUID } from "@/uuid"

import { type Milestone } from "./types"

const ServiceAccountSchema = z.object({
  project_id: z.string(),
  client_email: z.string(),
  private_key: z.string(),
  token_uri: z.url().default("https://oauth2.googleapis.com/token"),
})
type ServiceAccount = z.infer<typeof ServiceAccountSchema>

export type PushMessage = {
  title: string
  body: string
  /** Opened when the notification is tapped; the app re-checks the account. */
  data: Record<string, string>
  /** The Android channel, so a reader can mute one kind without the other. */
  channel?: "requests" | "recommendations"
}

/** Sends one message to one device; resolves false when the token is gone. */
export type PushTransport = (
  token: string,
  message: PushMessage,
) => Promise<boolean>

/** Grades at which the match report is worth a look. */
const POOR_GRADES: Record<string, true> = { D: true, F: true }

async function bookTitle(request: BookRequest): Promise<string> {
  const book = await getBook(request.bookUuid, request.userId)
  return book?.title ?? request.chosenWork.title
}

/** The words for one milestone. Titles only; never anything else. */
export async function describeMilestone(
  request: BookRequest,
  milestone: Milestone,
): Promise<PushMessage> {
  const title = await bookTitle(request)
  const data = { requestUuid: request.uuid, milestone }
  switch (milestone) {
    case "readable":
      return {
        title:
          request.ebookStatus === "ready"
            ? `${title} is ready to read`
            : `${title} is ready to listen`,
        body: "Tap to open it.",
        data,
      }
    case "synced": {
      const report = await getAlignmentReportForBook(request.bookUuid)
      return {
        title: `${title} is synced and ready to listen`,
        body:
          report?.grade && POOR_GRADES[report.grade]
            ? "The narration matched poorly in places; the match report has details."
            : "Open the read-along.",
        data,
      }
    }
    case "sync-failed":
      return {
        title: `Narration sync failed for ${title}`,
        body: "The ebook is still ready to read. You can retry the sync.",
        data,
      }
    case "ebook-stalled":
    case "audio-stalled":
      return {
        title: `${title}: ${milestone === "ebook-stalled" ? "ebook" : "audiobook"} download stalled`,
        body: "Nobody is sharing it right now. You can pick another version.",
        data,
      }
    case "ebook-choosing":
    case "audio-choosing":
      return {
        title: `${title} needs your pick`,
        body: `The chosen ${milestone === "ebook-choosing" ? "ebook" : "audiobook"} has no seeders any more.`,
        data,
      }
    case "ebook-failed":
    case "audio-failed":
      return {
        title: `${title}: the ${milestone === "ebook-failed" ? "ebook" : "audiobook"} could not be added`,
        body: "Open the request for details.",
        data,
      }
  }
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url")
}

/**
 * Google push (FCM HTTP v1), signed in with a service account.
 */
export function fcmTransport(
  account: ServiceAccount,
  fetchImpl: typeof fetch = fetch,
): PushTransport {
  let cached: { token: string; expiresAt: number } | null = null

  async function accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    if (cached && cached.expiresAt - 60 > now) return cached.token

    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
    const claims = base64url(
      JSON.stringify({
        iss: account.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: account.token_uri,
        iat: now,
        exp: now + 3600,
      }),
    )
    const signature = createSign("RSA-SHA256")
      .update(`${header}.${claims}`)
      .sign(account.private_key, "base64url")

    const response = await fetchImpl(account.token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${header}.${claims}.${signature}`,
      }),
    })
    if (!response.ok) {
      throw new Error(`Push sign-in failed with ${response.status}`)
    }
    const body = z
      .object({ access_token: z.string(), expires_in: z.number() })
      .parse(await response.json())
    cached = { token: body.access_token, expiresAt: now + body.expires_in }
    return body.access_token
  }

  return async (token, message) => {
    const response = await fetchImpl(
      `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await accessToken()}`,
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: message.title, body: message.body },
            data: message.data,
            android: {
              priority: "HIGH",
              // the lock screen shows that something arrived, not what
              notification: {
                visibility: "PRIVATE",
                channel_id: message.channel ?? "requests",
              },
            },
          },
        }),
      },
    )
    if (response.status === 404) return false
    if (!response.ok) {
      throw new Error(`Push failed with ${response.status}`)
    }
    return true
  }
}

declare global {
  // eslint-disable-next-line no-var
  var bookRequestPush: PushTransport | null | undefined
}
/** The push transport set up on this server, or null when push is off. */
export function configuredTransport(): PushTransport | null {
  if (globalThis.bookRequestPush !== undefined)
    return globalThis.bookRequestPush
  const file = env.STORYTELLER_PUSH_SERVICE_ACCOUNT_FILE
  globalThis.bookRequestPush = file
    ? fcmTransport(
        ServiceAccountSchema.parse(JSON.parse(readFileSync(file, "utf-8"))),
      )
    : null
  return globalThis.bookRequestPush
}
/**
 * Send a message to every device signed in to one reader's account, and to
 * no one else. Devices whose token is gone are forgotten.
 */
export async function sendToReader(
  userId: UUID,
  message: PushMessage,
  transport: PushTransport | null = configuredTransport(),
): Promise<void> {
  if (!transport) return
  const devices = await getPushTokens(userId)
  for (const { installId, pushToken } of devices) {
    try {
      if (!(await transport(pushToken, message))) {
        await clearPushToken(installId)
      }
    } catch (error) {
      logger.warn({
        msg: "Failed to send a push notification",
        data: message.data,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/** Send a request milestone to the requester's devices. */
export async function sendRequestNotification(
  request: BookRequest,
  milestone: Milestone,
  transport: PushTransport | null = configuredTransport(),
): Promise<void> {
  if (!transport) return
  if (!(await getPushTokens(request.userId)).length) return
  await sendToReader(
    request.userId,
    await describeMilestone(request, milestone),
    transport,
  )
}
