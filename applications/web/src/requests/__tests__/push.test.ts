import assert from "node:assert"
import { generateKeyPairSync, randomUUID } from "node:crypto"

import { describe, it } from "vitest"

import { type TestDbContext, setupTestDb } from "@/__tests__/harness/testDb"
import { type BookRequest, createBookRequest } from "@/database/bookRequests"
import {
  getPushTokens,
  registerUserDevice,
  removeUserDevice,
} from "@/database/userDevices"
import {
  type PushMessage,
  fcmTransport,
  sendRequestNotification,
} from "@/requests/push"
import { type UUID } from "@/uuid"

function user(ctx: TestDbContext): UUID {
  const id = randomUUID()
  const permission = randomUUID()
  ctx.sqlite
    .prepare(`INSERT INTO user_permission (uuid, book_read) VALUES (?, 1)`)
    .run(permission)
  ctx.sqlite
    .prepare(
      `INSERT INTO "user" (id, user_permission_uuid, email) VALUES (?, ?, ?)`,
    )
    .run(id, permission, `${id}@example.com`)
  return id
}

async function requestFor(
  ctx: TestDbContext,
  userId: UUID,
): Promise<BookRequest> {
  const shelf = randomUUID()
  ctx.sqlite
    .prepare(`INSERT INTO collection (uuid, name) VALUES (?, ?)`)
    .run(shelf, shelf)
  return await createBookRequest(
    {
      userId,
      kind: "title",
      input: {},
      chosenWork: { title: "Sharpe's Storm", authors: [] },
      bookUuid: randomUUID(),
      collectionUuid: shelf,
      ebookStatus: "ready",
    },
    { kind: "requested", message: "Requested" },
  )
}

describe("request notifications", () => {
  it("go only to installs signed in to the requester's account", async () => {
    using ctx = setupTestDb()
    const david = user(ctx)
    const ashley = user(ctx)
    await registerUserDevice({
      installId: "tablet-install",
      userId: david,
      platform: "android",
      pushToken: "tablet-token",
    })
    await registerUserDevice({
      installId: "phone-install",
      userId: david,
      platform: "android",
      pushToken: "phone-token",
    })
    // the tablet switches to Ashley's account
    await registerUserDevice({
      installId: "tablet-install",
      userId: ashley,
      platform: "android",
      pushToken: "tablet-token",
    })

    const sent: [string, PushMessage][] = []
    await sendRequestNotification(
      await requestFor(ctx, david),
      "readable",
      (token, message) => {
        sent.push([token, message])
        return Promise.resolve(true)
      },
    )
    assert.deepStrictEqual(
      sent.map(([token]) => token),
      ["phone-token"],
    )
    assert.strictEqual(sent[0]?.[1].title, "Sharpe's Storm is ready to read")
  })

  it("stop going to a token the push service no longer knows", async () => {
    using ctx = setupTestDb()
    const david = user(ctx)
    await registerUserDevice({
      installId: "old-install",
      userId: david,
      platform: "android",
      pushToken: "stale-token",
    })
    await sendRequestNotification(await requestFor(ctx, david), "synced", () =>
      Promise.resolve(false),
    )
    assert.deepStrictEqual(await getPushTokens(david), [])
  })

  it("forget an install on sign-out, only for its own account", async () => {
    using ctx = setupTestDb()
    const david = user(ctx)
    const ashley = user(ctx)
    await registerUserDevice({
      installId: "phone",
      userId: david,
      platform: "android",
      pushToken: "token",
    })
    await removeUserDevice("phone", ashley)
    assert.strictEqual((await getPushTokens(david)).length, 1)
    await removeUserDevice("phone", david)
    assert.strictEqual((await getPushTokens(david)).length, 0)
  })
})

describe("Google push transport", () => {
  it("signs in with the service account and sends a private, high-priority message", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
    const calls: { url: string; init: RequestInit }[] = []
    const fetchImpl = ((url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      const body = String(url).includes("oauth2")
        ? { access_token: "access", expires_in: 3600 }
        : { name: "projects/p/messages/1" }
      return Promise.resolve(Response.json(body))
    }) as typeof fetch

    const send = fcmTransport(
      {
        project_id: "p",
        client_email: "push@p.iam.gserviceaccount.com",
        private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
        token_uri: "https://oauth2.googleapis.com/token",
      },
      fetchImpl,
    )
    const message = { title: "T", body: "B", data: { requestUuid: "r" } }
    assert.strictEqual(await send("device-token", message), true)
    assert.strictEqual(await send("device-token", message), true)

    // one sign-in, reused for the second message
    assert.deepStrictEqual(
      calls.map((call) => call.url),
      [
        "https://oauth2.googleapis.com/token",
        "https://fcm.googleapis.com/v1/projects/p/messages:send",
        "https://fcm.googleapis.com/v1/projects/p/messages:send",
      ],
    )
    const sent = JSON.parse(calls[1]?.init.body as string) as {
      message: {
        token: string
        android: { priority: string; notification: { visibility: string } }
        data: Record<string, string>
      }
    }
    assert.strictEqual(sent.message.token, "device-token")
    assert.strictEqual(sent.message.android.priority, "HIGH")
    assert.strictEqual(sent.message.android.notification.visibility, "PRIVATE")
    assert.deepStrictEqual(sent.message.data, { requestUuid: "r" })
  })
})
