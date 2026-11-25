import { type Insertable, type Selectable, type Updateable, sql } from "kysely"
import { jsonArrayFrom } from "kysely/helpers/sqlite"

import {
  type HistoryItemSource,
  type HistorySource,
  type HistoryWork,
  type ParsedHistoryItem,
} from "@/history/types"
import { type UUID } from "@/uuid"

import { sqlNow } from "./bookRequests"
import { db } from "./connection"
import { type DB } from "./schema"
import { STATUS_READ } from "./statusKinds"

export type HistoryItem = Selectable<DB["readingHistoryItem"]>
export type ImportJob = Selectable<DB["historyImportJob"]>

function historyTimestamp(value: string | null | undefined): string | null {
  // The DB DatePlugin coerces strings with T…Z into Date objects on read.
  return value?.slice(0, 19).replace("T", " ") ?? null
}

/** Columns stored as JSON text. */
function serializeItem(
  item: ParsedHistoryItem,
): Omit<Insertable<DB["readingHistoryItem"]>, "userId" | "source" | "jobUuid"> {
  return {
    sourceId: item.sourceId,
    title: item.title,
    authors: JSON.stringify(item.authors),
    narrators: JSON.stringify(item.narrators ?? []),
    series: item.series ? JSON.stringify(item.series) : null,
    isbn13: item.isbn13 ?? null,
    isbn10: item.isbn10 ?? null,
    asin: item.asin ?? null,
    status: item.status,
    explicit: item.explicit,
    rating: item.rating ?? null,
    startedAt: historyTimestamp(item.startedAt),
    finishedAt: historyTimestamp(item.finishedAt),
    addedAt: historyTimestamp(item.addedAt),
    progress: item.progress ?? null,
    readCount: item.readCount ?? null,
    shelves: JSON.stringify(item.shelves ?? []),
    pages: item.pages ?? null,
    publishedYear: item.publishedYear ?? null,
    readingMinutes: item.readingMinutes ?? null,
    pageFlips: item.pageFlips ?? null,
    runtimeMinutes: item.runtimeMinutes ?? null,
  }
}

export async function createImportJob(
  userId: UUID,
  source: HistorySource,
  items: ParsedHistoryItem[],
): Promise<ImportJob> {
  return await db.transaction().execute(async (tr) => {
    const seen = new Set<string>()
    const unique = items.filter(({ sourceId }) => {
      if (seen.has(sourceId)) return false
      seen.add(sourceId)
      return true
    })
    await tr
      .updateTable("historyImportJob")
      .set({
        status: "failed",
        error: "Replaced by a newer import.",
        finishedAt: sqlNow(),
      })
      .where("userId", "=", userId)
      .where("source", "=", source)
      .where("status", "=", "running")
      .execute()
    const job = await tr
      .insertInto("historyImportJob")
      .values({ userId, source, total: unique.length })
      .returningAll()
      .executeTakeFirstOrThrow()
    // A new import of a source replaces that source's rows; other sources
    // and the reader's in-app entries stay.
    await tr
      .deleteFrom("readingHistoryItem")
      .where("userId", "=", userId)
      .where("source", "=", source)
      .execute()
    // Stay below SQLite's bound-parameter limit on large exports.
    for (let start = 0; start < unique.length; start += 200) {
      await tr
        .insertInto("readingHistoryItem")
        .values(
          unique.slice(start, start + 200).map((item) => ({
            ...serializeItem(item),
            userId,
            source,
            jobUuid: job.uuid,
          })),
        )
        .execute()
    }
    return job
  })
}

export async function getImportJob(
  userId: UUID,
  uuid: UUID,
): Promise<ImportJob | null> {
  return (
    (await db
      .selectFrom("historyImportJob")
      .selectAll()
      .where("uuid", "=", uuid)
      .where("userId", "=", userId)
      .executeTakeFirst()) ?? null
  )
}

export async function getRunningImportJobs(): Promise<ImportJob[]> {
  return await db
    .selectFrom("historyImportJob")
    .selectAll()
    .where("status", "=", "running")
    .orderBy("createdAt", "asc")
    .execute()
}

export async function getImportJobsForUser(userId: UUID): Promise<ImportJob[]> {
  return await db
    .selectFrom("historyImportJob")
    .selectAll()
    .where("userId", "=", userId)
    .orderBy("createdAt", "desc")
    .orderBy(sql`history_import_job.rowid`, "desc")
    .execute()
}

export async function updateImportJob(
  userId: UUID,
  uuid: UUID,
  patch: Updateable<DB["historyImportJob"]>,
): Promise<boolean> {
  const result = await db
    .updateTable("historyImportJob")
    .set(patch)
    .where("uuid", "=", uuid)
    .where("userId", "=", userId)
    .where("status", "=", "running")
    .executeTakeFirst()
  return result.numUpdatedRows > 0n
}

export async function getPendingItems(
  userId: UUID,
  jobUuid: UUID,
  limit: number,
): Promise<HistoryItem[]> {
  return await db
    .selectFrom("readingHistoryItem")
    .selectAll()
    .where("jobUuid", "=", jobUuid)
    .where("userId", "=", userId)
    .where("matchStatus", "=", "pending")
    .orderBy("uuid")
    .limit(limit)
    .execute()
}

export async function setItemMatch(
  userId: UUID,
  uuid: UUID,
  match: {
    matchStatus: "matched" | "unmatched" | "ignored"
    work?: HistoryWork | null
    matchedBy?: HistoryItem["matchedBy"]
    bookUuid?: UUID | null
    status?: HistoryItem["status"]
  },
  expected: "pending" | "unmatched",
): Promise<boolean> {
  const result = await db
    .updateTable("readingHistoryItem")
    .set({
      matchStatus: match.matchStatus,
      work: match.work ? JSON.stringify(match.work) : null,
      matchedBy: match.matchedBy ?? null,
      bookUuid: match.bookUuid ?? null,
      ...(match.status ? { status: match.status } : {}),
    })
    .where("uuid", "=", uuid)
    .where("userId", "=", userId)
    .where("matchStatus", "=", expected)
    .executeTakeFirst()
  return result.numUpdatedRows > 0n
}

/** Every history row of a reader, optionally of some sources only. */
export async function getHistoryItems(
  userId: UUID,
  options: {
    sources?: HistoryItemSource[]
    matchStatus?: HistoryItem["matchStatus"]
  } = {},
): Promise<HistoryItem[]> {
  let query = db
    .selectFrom("readingHistoryItem")
    .selectAll()
    .where("userId", "=", userId)
  if (options.sources) query = query.where("source", "in", options.sources)
  if (options.matchStatus)
    query = query.where("matchStatus", "=", options.matchStatus)
  return await query.orderBy("importedAt", "asc").execute()
}

export async function getHistoryItem(
  userId: UUID,
  uuid: UUID,
): Promise<HistoryItem | null> {
  return (
    (await db
      .selectFrom("readingHistoryItem")
      .selectAll()
      .where("userId", "=", userId)
      .where("uuid", "=", uuid)
      .executeTakeFirst()) ?? null
  )
}

export async function deleteSourceItems(
  userId: UUID,
  source: HistoryItemSource,
): Promise<number> {
  return await db.transaction().execute(async (tr) => {
    const result = await tr
      .deleteFrom("readingHistoryItem")
      .where("userId", "=", userId)
      .where("source", "=", source)
      .executeTakeFirst()
    if (source !== "manual") {
      await tr
        .deleteFrom("historyImportJob")
        .where("userId", "=", userId)
        .where("source", "=", source)
        .execute()
    }
    return Number(result.numDeletedRows)
  })
}

export async function countJobItems(userId: UUID, jobUuid: UUID) {
  return await db
    .selectFrom("readingHistoryItem")
    .select("matchStatus")
    .select((eb) => eb.fn.countAll<number>().as("total"))
    .where("userId", "=", userId)
    .where("jobUuid", "=", jobUuid)
    .groupBy("matchStatus")
    .execute()
}

export async function countHistorySourceItems(userId: UUID) {
  return await db
    .selectFrom("readingHistoryItem")
    .select(["source", "matchStatus"])
    .select((eb) => eb.fn.countAll<number>().as("total"))
    .where("userId", "=", userId)
    .groupBy(["source", "matchStatus"])
    .execute()
}

export async function getVisibleHistoryLinkTargets(userId: UUID) {
  return await db
    .selectFrom("book")
    .innerJoin("bookAccess", "bookAccess.bookUuid", "book.uuid")
    .select(["book.uuid", "book.title"])
    .select((eb) =>
      jsonArrayFrom(
        eb
          .selectFrom("bookToCreator")
          .innerJoin("creator", "creator.uuid", "bookToCreator.creatorUuid")
          .select("creator.name")
          .whereRef("bookToCreator.bookUuid", "=", "book.uuid")
          .where("bookToCreator.role", "=", "aut"),
      ).as("authors"),
    )
    .where("bookAccess.userId", "=", userId)
    .distinct()
    .orderBy("book.uuid")
    .execute()
}

export async function getUnmarkedImportedLibraryReads(userId: UUID) {
  return await db
    .selectFrom("readingHistoryItem as item")
    .innerJoin("book", "book.uuid", "item.bookUuid")
    .innerJoin("bookAccess", "bookAccess.bookUuid", "book.uuid")
    .select(["book.uuid as bookUuid", "book.title"])
    .where("item.userId", "=", userId)
    .where("bookAccess.userId", "=", userId)
    .where("item.source", "!=", "manual")
    .where("item.matchStatus", "=", "matched")
    .where("item.status", "=", "read")
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("bookToStatus")
            .innerJoin("status", "status.uuid", "bookToStatus.statusUuid")
            .whereRef("bookToStatus.bookUuid", "=", "book.uuid")
            .where("bookToStatus.userId", "=", userId)
            .where("status.name", "=", STATUS_READ)
            .select(sql.lit(1).as("one")),
        ),
      ),
    )
    .distinct()
    .orderBy("book.title")
    .execute()
}

/**
 * Record that the reader read a book that is not in the library, from the
 * app. Kept apart from imports, so no re-import removes it.
 */
export async function upsertManualItem(
  userId: UUID,
  work: HistoryWork,
  rating: number | null,
): Promise<void> {
  const values = {
    ...serializeItem({
      sourceId: work.key,
      title: work.title,
      authors: work.authors,
      narrators: work.narrators ?? [],
      series: work.series[0]
        ? { name: work.series[0].name, position: work.series[0].position }
        : null,
      status: "read",
      explicit: true,
      rating,
      finishedAt: sqlNow(),
    }),
    userId,
    source: "manual" as const,
    matchStatus: "matched" as const,
    matchedBy: "reader" as const,
    work: JSON.stringify(work),
  }
  await db
    .insertInto("readingHistoryItem")
    .values(values)
    .onConflict((oc) =>
      oc.columns(["userId", "source", "sourceId"]).doUpdateSet({
        rating: values.rating,
        status: "read",
        finishedAt: values.finishedAt,
      }),
    )
    .execute()
}
