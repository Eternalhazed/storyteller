import { sql } from "kysely"

import { db } from "@/database/connection"
import {
  getReader,
  preferencesOf,
  updateReader,
} from "@/database/recommendations"
import { getStatus } from "@/database/statuses"
import { logger } from "@/logging"
import { type UUID } from "@/uuid"

import { getAiConfig } from "./ai"
import { sqlTime } from "./clock"
import { rebuildProfile } from "./reader"
import { startRound } from "./rounds"
import { budgetSpent } from "./views"

/** How long after a book is marked read the anchored round waits. */
export const FINISH_WINDOW_MS = 30 * 60_000

/**
 * The reader's history changed: rebuild their profile, and after an import
 * run a round with it (unless the monthly budget is spent).
 */
export async function historyChanged(
  userId: UUID,
  reason: "import" | "delete" | "match",
): Promise<void> {
  const ai = await getAiConfig()
  if (!ai) return
  try {
    const reader = await getReader(userId)
    await rebuildProfile(userId, preferencesOf(reader))
    if (reason === "import" && !(await budgetSpent(ai))) {
      await startRound(userId, "import")
    }
  } catch (error) {
    logger.warn({
      msg: "Failed to refresh recommendations after a history change",
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * One book's status changed through the single-book route. A change to Read
 * opens (or extends) a short window; the anchored round starts when it
 * closes with exactly one book in it, so marking a pile of books read at
 * once starts nothing.
 */
export async function bookStatusChanged(
  userId: UUID,
  bookUuid: UUID,
  previousStatus: UUID | null,
  status: UUID | null,
  now = Date.now(),
): Promise<void> {
  if (!status || status === previousStatus) return
  const reader = await getReader(userId)
  if (!reader) return // not using recommendations
  const kind = await getStatus(status)
  if (kind.name.toLowerCase() !== "read") return
  // "What next?" may start the anchored round before the Read status syncs;
  // a second round for the same book would only repeat it.
  const asked = await db
    .selectFrom("recommendationRound")
    .select("uuid")
    .where("userId", "=", userId)
    .where("trigger", "=", "finished")
    .where("createdAt", ">=", sqlTime(now - 6 * 60 * 60_000))
    .where(sql<boolean>`json_extract(input, '$.anchorBookUuid') = ${bookUuid}`)
    .executeTakeFirst()
  if (asked) return
  const open = reader.finishDueAt && reader.finishDueAt > sqlTime(now)
  await updateReader(userId, {
    finishBookUuid: bookUuid,
    finishCount: open ? reader.finishCount + 1 : 1,
    finishDueAt: sqlTime(now + FINISH_WINDOW_MS),
  })
}

/** "What next?" started the anchored round itself: forget the window. */
export async function clearFinishWindow(userId: UUID): Promise<void> {
  await updateReader(userId, {
    finishBookUuid: null,
    finishCount: 0,
    finishDueAt: null,
  })
}

/** A book's status for one reader, before a change. */
export async function currentStatus(
  userId: UUID,
  bookUuid: UUID,
): Promise<UUID | null> {
  const row = await db
    .selectFrom("bookToStatus")
    .select("statusUuid")
    .where("userId", "=", userId)
    .where("bookUuid", "=", bookUuid)
    .executeTakeFirst()
  return row?.statusUuid ?? null
}
