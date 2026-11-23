import { type Kysely, type Selectable, type Transaction, sql } from "kysely"

import {
  type ShortlistChange,
  applyShortlistChange,
  getShortlists,
  mergePulledShelves,
  sameBookOrder,
} from "@/store/shortlist"
import { type UUID, randomUUID } from "@/uuid"

import { db } from "./db"
import { type DB } from "./schema"

export type Shelf = Selectable<DB["shelf"]>
type Connection = Kysely<DB> | Transaction<DB>

function storedBooks(bookUuids: UUID[]) {
  return sql<UUID[]>`${JSON.stringify(bookUuids)}`
}

export function getShelves(serverUuid?: UUID, connection: Connection = db) {
  let query = connection
    .selectFrom("shelf")
    .innerJoin("server", "server.uuid", "shelf.serverUuid")
    .selectAll("shelf")
    .orderBy("server.createdAt", "asc")
    .orderBy("server.uuid", "asc")
    .orderBy("shelf.position", "asc")
    .orderBy("shelf.createdAt", "asc")
    .orderBy("shelf.uuid", "asc")
  if (serverUuid) query = query.where("shelf.serverUuid", "=", serverUuid)
  return query.execute()
}

export function getShelf(uuid: UUID, connection: Connection = db) {
  return connection
    .selectFrom("shelf")
    .selectAll()
    .where("uuid", "=", uuid)
    .executeTakeFirst()
}

export async function changeShortlist({
  bookUuid,
  serverUuid,
  change,
}: {
  bookUuid: UUID
  serverUuid: UUID
  change: ShortlistChange
}): Promise<Shelf | null> {
  return db.transaction().execute(async (tr) => {
    const book = await tr
      .selectFrom("book")
      .innerJoin("server", "server.uuid", "book.serverUuid")
      .select("book.uuid")
      .where("book.uuid", "=", bookUuid)
      .where("book.serverUuid", "=", serverUuid)
      .executeTakeFirst()
    if (!book) {
      throw new Error("Only books on a configured server can be shortlisted.")
    }

    const shelves = await getShelves(serverUuid, tr)
    const shortlist = getShortlists(shelves)[0]
    if (!shortlist) {
      if (change !== "add" && change !== "toggle") return null
      return tr
        .insertInto("shelf")
        .values({
          uuid: randomUUID(),
          remoteUuid: null,
          serverUuid,
          name: "Shortlist",
          kind: "manual",
          position: Math.max(-1, ...shelves.map((shelf) => shelf.position)) + 1,
          bookUuids: storedBooks([bookUuid]),
          dirty: "true",
        })
        .returningAll()
        .executeTakeFirstOrThrow()
    }

    const bookUuids = applyShortlistChange(
      shortlist.bookUuids,
      bookUuid,
      change,
    )
    if (bookUuids === shortlist.bookUuids) return shortlist
    return tr
      .updateTable("shelf")
      .set({
        bookUuids: storedBooks(bookUuids),
        dirty: "true",
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where("uuid", "=", shortlist.uuid)
      .returningAll()
      .executeTakeFirstOrThrow()
  })
}

/** Adopt an already-existing server Shortlist instead of creating a duplicate. */
export async function bindShelfToRemote(uuid: UUID, remote: Shelf) {
  return db.transaction().execute(async (tr) => {
    const local = await getShelf(uuid, tr)
    if (!local) return undefined
    const cachedRemote = (await getShelves(local.serverUuid, tr)).find(
      (shelf) => shelf.remoteUuid === remote.remoteUuid && shelf.uuid !== uuid,
    )
    // On first use, or when adopting an older duplicate, retain the canonical
    // shelf's books as well as additions made against the previous local list.
    const bookUuids =
      local.remoteUuid !== remote.remoteUuid
        ? [
            ...new Set([
              ...(cachedRemote?.bookUuids ?? remote.bookUuids),
              ...local.bookUuids,
            ]),
          ]
        : local.bookUuids
    if (cachedRemote) {
      await tr
        .deleteFrom("shelf")
        .where("uuid", "=", cachedRemote.uuid)
        .execute()
    }
    return tr
      .updateTable("shelf")
      .set({
        remoteUuid: remote.remoteUuid,
        name: remote.name,
        position: remote.position,
        createdAt: remote.createdAt,
        bookUuids: storedBooks(bookUuids),
        dirty: "true",
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where("uuid", "=", uuid)
      .returningAll()
      .executeTakeFirstOrThrow()
  })
}

/** Do not acknowledge edits made while a request was in flight. */
export async function acknowledgeShelfPush(snapshot: Shelf, remote: Shelf) {
  await db.transaction().execute(async (tr) => {
    const latest = await getShelf(snapshot.uuid, tr)
    if (!latest) return
    await tr
      .updateTable("shelf")
      .set({
        remoteUuid: remote.remoteUuid,
        createdAt: remote.createdAt,
        dirty: sameBookOrder(latest.bookUuids, snapshot.bookUuids)
          ? "false"
          : "true",
      })
      .where("uuid", "=", snapshot.uuid)
      .execute()
  })
}

export async function applyShelfPull(serverUuid: UUID, pulledShelves: Shelf[]) {
  await db.transaction().execute(async (tr) => {
    const server = await tr
      .selectFrom("server")
      .select("uuid")
      .where("uuid", "=", serverUuid)
      .executeTakeFirst()
    if (!server) return // The account may have been removed during the request.
    const local = await getShelves(serverUuid, tr)
    const merged = mergePulledShelves(local, pulledShelves)
    const kept = new Set(merged.map((shelf) => shelf.uuid))
    for (const shelf of local) {
      if (!kept.has(shelf.uuid)) {
        await tr.deleteFrom("shelf").where("uuid", "=", shelf.uuid).execute()
      }
    }
    for (const shelf of merged) {
      if (shelf.dirty === "true") continue
      const values = { ...shelf, bookUuids: storedBooks(shelf.bookUuids) }
      await tr
        .insertInto("shelf")
        .values(values)
        .onConflict((oc) => oc.column("uuid").doUpdateSet(values))
        .execute()
    }
  })
}
