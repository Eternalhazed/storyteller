import { sql } from "kysely"

import { type UUID } from "@/uuid"

import { type BookWithRelations, getBooks } from "./books"
import { db } from "./connection"
import { STATUS_READ, STATUS_READING } from "./statusKinds"

export async function getNextUpInSeries(
  userId: UUID,
  limit = 20,
): Promise<BookWithRelations[]> {
  const r = await db
    // series where the user is reading or has read at least one book, with
    // the most recent activity in each
    .with("readingSeries", (db) =>
      db
        .selectFrom("bookToSeries")
        .innerJoin(
          "bookToStatus",
          "bookToStatus.bookUuid",
          "bookToSeries.bookUuid",
        )
        .innerJoin("status", "status.uuid", "bookToStatus.statusUuid")
        .leftJoin("position", (join) =>
          join
            .onRef("position.bookUuid", "=", "bookToSeries.bookUuid")
            .on("position.userId", "=", userId),
        )
        .where("bookToStatus.userId", "=", userId)
        .where("status.name", "in", [STATUS_READ, STATUS_READING])
        .select((eb) => [
          "bookToSeries.seriesUuid",
          eb.fn.max("position.timestamp").as("lastReadAt"),
          eb.fn.max("bookToStatus.updatedAt").as("lastStatusAt"),
          eb.fn
            .max(
              eb
                .case()
                .when("status.name", "=", STATUS_READ)
                .then(eb.ref("bookToSeries.position"))
                .else(null)
                .end(),
            )
            .as("furthestRead"),
        ])
        .groupBy("bookToSeries.seriesUuid"),
    )
    .with("candidates", (db) =>
      db
        .selectFrom("bookToSeries")
        .innerJoin(
          "readingSeries",
          "readingSeries.seriesUuid",
          "bookToSeries.seriesUuid",
        )
        .leftJoin("bookToStatus", (join) =>
          join
            .onRef("bookToStatus.bookUuid", "=", "bookToSeries.bookUuid")
            .on("bookToStatus.userId", "=", userId),
        )
        .leftJoin("status", "status.uuid", "bookToStatus.statusUuid")
        .innerJoin("book", "book.uuid", "bookToSeries.bookUuid")
        .where((eb) =>
          eb.or([
            eb("status.name", "is", null),
            eb("status.name", "!=", STATUS_READ),
          ]),
        )
        .where("bookToSeries.position", "is not", null)
        .where((eb) =>
          eb.or([
            eb("readingSeries.furthestRead", "is", null),
            eb(
              "bookToSeries.position",
              ">",
              eb.ref("readingSeries.furthestRead"),
            ),
          ]),
        )
        .select((eb) => [
          "bookToSeries.bookUuid",
          "readingSeries.lastReadAt",
          "readingSeries.lastStatusAt",
          eb.fn
            .agg("row_number")
            .over((ob) =>
              ob
                .partitionBy("bookToSeries.seriesUuid")
                .orderBy("bookToSeries.position", (ob) => ob.asc().nullsLast())
                // Books sharing a number (e.g. editions) would otherwise be
                // picked arbitrarily; match the series view's order
                .orderBy(sql`book.created_at`)
                .orderBy(sql`book.title collate nocase`),
            )
            .as("rn"),
        ]),
    )
    .selectFrom("candidates")
    .select(["candidates.bookUuid"])
    .where("candidates.rn", "=", 1)
    .orderBy("candidates.lastReadAt", "desc")
    .orderBy("candidates.lastStatusAt", "desc")
    .limit(limit)
    .execute()

  const uuids = [...new Set(r.map((r) => r.bookUuid))]
  if (uuids.length === 0) return []

  // hydrate through getBooks so visibility rules and relations apply, then
  // restore the activity order (getBooks does not preserve input order)
  const books = await getBooks(uuids, userId)
  const byUuid = new Map(books.map((b) => [b.uuid, b]))
  return uuids
    .map((uuid) => byUuid.get(uuid))
    .filter((b): b is BookWithRelations => b !== undefined)
}
