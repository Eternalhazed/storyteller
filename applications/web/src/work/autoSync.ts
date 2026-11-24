import { sql } from "kysely"

import { setBooksScannedHandler } from "@/assets/library/scanner/books-scanned"
import { db } from "@/database/connection"
import { getSetting } from "@/database/settings"
import { logger } from "@/logging"
import { type UUID } from "@/uuid"

import { enqueueBookAlign } from "./distributor"

/** Keeps each `in (…)` list well under SQLite's bound-parameter limit. */
const CHUNK = 500

/**
 * Of the given books (or the whole library), the ones a sync should be
 * queued for: an ebook and an audiobook, neither missing, no read-along, and
 * no sync job ever. A book that was synced before, or whose sync failed, was
 * cancelled or is paused, is left alone; retrying stays manual, so automatic
 * sync can never loop on a book.
 */
export async function getBooksToSync(bookUuids?: UUID[]): Promise<UUID[]> {
  if (bookUuids && !bookUuids.length) return []
  if (bookUuids && bookUuids.length > CHUNK) {
    const found: UUID[] = []
    for (let i = 0; i < bookUuids.length; i += CHUNK) {
      found.push(...(await getBooksToSync(bookUuids.slice(i, i + CHUNK))))
    }
    return found
  }

  const rows = await db
    .selectFrom("book")
    .innerJoin("ebook", "ebook.bookUuid", "book.uuid")
    .innerJoin("audiobook", "audiobook.bookUuid", "book.uuid")
    .leftJoin("readaloud", "readaloud.bookUuid", "book.uuid")
    .select("book.uuid")
    .where("ebook.filepath", "is not", null)
    .where("ebook.missing", "=", false)
    .where("audiobook.filepath", "is not", null)
    .where("audiobook.missing", "=", false)
    .where((eb) =>
      eb.or([
        eb("readaloud.uuid", "is", null),
        eb.and([
          eb("readaloud.filepath", "is", null),
          eb("readaloud.status", "=", "CREATED"),
        ]),
      ]),
    )
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("job")
            .select(sql.lit(1).as("one"))
            .whereRef("job.bookUuid", "=", "book.uuid")
            .where("job.type", "=", "book_align"),
        ),
      ),
    )
    .$if(!!bookUuids, (qb) =>
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      qb.where("book.uuid", "in", bookUuids!),
    )
    .execute()

  return rows.map((row) => row.uuid)
}

/**
 * Queue a sync for each of the given books (or the whole library) that has
 * both formats and has never been synced, when "Sync narration
 * automatically" is on. Runs after a scan creates or changes books and at
 * server start. Never throws: a scan or start-up must not fail because of it.
 */
export async function syncNarrationAutomatically(
  bookUuids?: UUID[],
): Promise<void> {
  try {
    if (!(await getSetting("syncNarrationAutomatically"))) return

    const due = await getBooksToSync(bookUuids)
    for (const bookUuid of due) {
      const job = await enqueueBookAlign(bookUuid, false)
      logger.info({
        msg: "Queued narration sync automatically",
        bookUuid,
        jobUuid: job.uuid,
      })
    }
  } catch (error) {
    logger.warn({
      msg: "Failed to queue automatic narration sync",
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// A scan that creates a book or attaches a format can complete a pair.
setBooksScannedHandler(syncNarrationAutomatically)
