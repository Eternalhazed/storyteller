import { type Selectable } from "kysely"

import { type UUID } from "@/uuid"

import { db } from "./connection"
import { type DB } from "./schema"

export type UserDevice = Selectable<DB["userDevice"]>

/**
 * Bind an app install to the account it is signed in to. An install belongs
 * to one account at a time: registering it for another account moves it, so
 * a switched account never receives the previous one's notifications.
 */
export async function registerUserDevice(device: {
  installId: string
  userId: UUID
  platform: string
  pushToken: string | null
}): Promise<void> {
  await db
    .insertInto("userDevice")
    .values(device)
    .onConflict((oc) =>
      oc.column("installId").doUpdateSet({
        userId: device.userId,
        platform: device.platform,
        pushToken: device.pushToken,
      }),
    )
    .execute()
}

/** Signing out forgets the install, but only for the account it belongs to. */
export async function removeUserDevice(
  installId: string,
  userId: UUID,
): Promise<void> {
  await db
    .deleteFrom("userDevice")
    .where("installId", "=", installId)
    .where("userId", "=", userId)
    .execute()
}

export async function getPushTokens(
  userId: UUID,
): Promise<{ installId: string; pushToken: string }[]> {
  const rows = await db
    .selectFrom("userDevice")
    .select(["installId", "pushToken"])
    .where("userId", "=", userId)
    .where("pushToken", "is not", null)
    .execute()
  return rows.flatMap(({ installId, pushToken }) =>
    pushToken ? [{ installId, pushToken }] : [],
  )
}

/** The push service no longer knows this token; stop sending to it. */
export async function clearPushToken(installId: string): Promise<void> {
  await db
    .updateTable("userDevice")
    .set({ pushToken: null })
    .where("installId", "=", installId)
    .execute()
}
