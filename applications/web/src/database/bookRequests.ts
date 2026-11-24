import { type Insertable, type Selectable, type Updateable, sql } from "kysely"

import { type UUID } from "@/uuid"

import { db } from "./connection"
import { type DB } from "./schema"

export type BookRequest = Selectable<DB["bookRequest"]>
export type BookRequestEvent = Selectable<DB["bookRequestEvent"]>

/** Columns stored as JSON text; callers pass and get the parsed values. */
type JsonColumn =
  | "input"
  | "chosenWork"
  | "ebookRelease"
  | "audioRelease"
  | "notified"

export type NewBookRequest = Omit<
  Insertable<DB["bookRequest"]>,
  JsonColumn | "uuid" | "createdAt" | "updatedAt"
> &
  Pick<BookRequest, "input" | "chosenWork"> &
  Partial<Pick<BookRequest, "ebookRelease" | "audioRelease">>

export type BookRequestUpdate = Omit<
  Updateable<DB["bookRequest"]>,
  JsonColumn | "uuid" | "userId" | "createdAt" | "updatedAt"
> &
  Partial<Pick<BookRequest, JsonColumn>>

/** A plain-language line in a request's history. */
export type RequestEventInput = { kind: string; message: string }

/** Now, in the same text format as SQLite's CURRENT_TIMESTAMP. */
export function sqlNow(): string {
  return new Date()
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "")
}

function serialize(
  values: BookRequestUpdate | NewBookRequest,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...values }
  for (const key of [
    "input",
    "chosenWork",
    "ebookRelease",
    "audioRelease",
    "notified",
  ] as const) {
    const value = (values as Partial<Pick<BookRequest, JsonColumn>>)[key]
    if (value !== undefined && value !== null) {
      out[key] = JSON.stringify(value)
    }
  }
  return out
}

export async function createBookRequest(
  request: NewBookRequest,
  event: RequestEventInput,
): Promise<BookRequest> {
  return await db.transaction().execute(async (tr) => {
    const row = await tr
      .insertInto("bookRequest")
      .values(serialize(request) as Insertable<DB["bookRequest"]>)
      .returningAll()
      .executeTakeFirstOrThrow()
    await tr
      .insertInto("bookRequestEvent")
      .values({ requestUuid: row.uuid, ...event })
      .execute()
    return row
  })
}

export async function getBookRequest(uuid: UUID): Promise<BookRequest | null> {
  return (
    (await db
      .selectFrom("bookRequest")
      .selectAll()
      .where("uuid", "=", uuid)
      .executeTakeFirst()) ?? null
  )
}

/** Requests are private: every read for a reader filters on their id. */
export async function getBookRequestsForUser(
  userId: UUID,
  options: { open?: boolean } = {},
): Promise<BookRequest[]> {
  return await db
    .selectFrom("bookRequest")
    .selectAll()
    .where("userId", "=", userId)
    .$if(!!options.open, (qb) => qb.where("closedAt", "is", null))
    .orderBy("createdAt", "desc")
    .orderBy("uuid", "desc")
    .execute()
}

export async function getOpenBookRequests(): Promise<BookRequest[]> {
  return await db
    .selectFrom("bookRequest")
    .selectAll()
    .where("closedAt", "is", null)
    .orderBy("createdAt", "asc")
    .execute()
}

/** Apply a change and record why, in one transaction. */
export async function updateBookRequest(
  uuid: UUID,
  patch: BookRequestUpdate,
  event?: RequestEventInput,
): Promise<BookRequest> {
  return await db.transaction().execute(async (tr) => {
    const row = await tr
      .updateTable("bookRequest")
      .set(serialize(patch) as Updateable<DB["bookRequest"]>)
      .where("uuid", "=", uuid)
      .returningAll()
      .executeTakeFirstOrThrow()
    if (event) {
      await tr
        .insertInto("bookRequestEvent")
        .values({ requestUuid: uuid, ...event })
        .execute()
    }
    return row
  })
}

export async function getBookRequestEvents(
  requestUuid: UUID,
): Promise<BookRequestEvent[]> {
  return await db
    .selectFrom("bookRequestEvent")
    .selectAll()
    .where("requestUuid", "=", requestUuid)
    .orderBy(sql`rowid`, "asc")
    .execute()
}

/**
 * New torrents added for requests since `sinceMs`, plus formats waiting to be
 * added, across the household. Reused torrents cost nothing.
 */
export async function countRequestDownloads(sinceMs: number): Promise<number> {
  const row = await db
    .selectFrom("bookRequest")
    .select((eb) => [
      eb.fn
        .sum<number>(
          eb
            .case()
            .when(
              eb.or([
                eb.and([
                  eb("ebookAddedAt", ">=", sinceMs),
                  eb("ebookReused", "=", false),
                ]),
                eb.and([
                  eb("ebookAddedAt", "is", null),
                  eb("ebookStatus", "=", "downloading"),
                ]),
              ]),
            )
            .then(1)
            .else(0)
            .end(),
        )
        .as("ebook"),
      eb.fn
        .sum<number>(
          eb
            .case()
            .when(
              eb.or([
                eb.and([
                  eb("audioAddedAt", ">=", sinceMs),
                  eb("audioReused", "=", false),
                ]),
                eb.and([
                  eb("audioAddedAt", "is", null),
                  eb("audioStatus", "=", "downloading"),
                ]),
              ]),
            )
            .then(1)
            .else(0)
            .end(),
        )
        .as("audio"),
    ])
    .executeTakeFirst()
  return (row?.ebook ?? 0) + (row?.audio ?? 0)
}
