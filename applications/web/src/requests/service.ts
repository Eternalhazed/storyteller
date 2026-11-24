import { randomUUID } from "node:crypto"

import { AsyncMutex } from "@esfx/async-mutex"

import {
  type BookRequest,
  countRequestDownloads,
  createBookRequest,
  getBookRequest,
  sqlNow,
  updateBookRequest,
} from "@/database/bookRequests"
import { getBook } from "@/database/books"
import { db } from "@/database/connection"
import { getLatestJobForBook } from "@/database/jobs"
import { getUserSettings, setUserSetting } from "@/database/userSettings"
import { type UUID } from "@/uuid"
import { enqueueBookAlign } from "@/work/distributor"

import { type AcquisitionAdapter, type ReleaseRef } from "./adapter"
import {
  type ChosenRelease,
  type ChosenWork,
  type Release,
  type RequestFormat,
  type RequestInput,
  type RequestKind,
} from "./types"

/** New torrents the household may add for requests in a day. */
export const HOUSEHOLD_DAILY_DOWNLOADS = 10
const DAY_MS = 24 * 60 * 60_000

const REQUEST_COLLECTION_SETTING = "requestCollection"

/** A request the server refuses, with a reason the app can show. */
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
    this.name = "RequestError"
  }
}

async function isPrivateMember(
  userId: UUID,
  collectionUuid: UUID,
): Promise<boolean> {
  const row = await db
    .selectFrom("collection")
    .innerJoin(
      "collectionToUser",
      "collectionToUser.collectionUuid",
      "collection.uuid",
    )
    .select("collection.uuid")
    .where("collection.uuid", "=", collectionUuid)
    .where("collectionToUser.userId", "=", userId)
    .where("collection.public", "=", false)
    .executeTakeFirst()
  return !!row
}

/**
 * The collection a reader's requested books are filed into. It must be a
 * private collection they are a member of, so a request never puts a book on
 * anyone else's shelf. Null when unset or no longer valid.
 */
export async function getRequestCollection(userId: UUID): Promise<UUID | null> {
  const settings = await getUserSettings(userId)
  const value = settings[REQUEST_COLLECTION_SETTING]
  if (typeof value !== "string") return null
  return (await isPrivateMember(userId, value as UUID)) ? (value as UUID) : null
}

export async function setRequestCollection(
  userId: UUID,
  collectionUuid: UUID,
): Promise<void> {
  if (!(await isPrivateMember(userId, collectionUuid))) {
    throw new RequestError(
      "Requested books can only go into a private collection you belong to",
      400,
      "invalid-collection",
    )
  }
  await setUserSetting(userId, REQUEST_COLLECTION_SETTING, collectionUuid)
}

function toChosenRelease(release: Release): ChosenRelease {
  return {
    source: release.source,
    id: release.id,
    kind: release.kind,
    title: release.title,
    seeders: release.seeders,
    size: release.size,
    facts: release.facts,
  }
}

/** Fresh details for a chosen release; refuses one nobody is sharing. */
async function inspectChosen(
  adapter: AcquisitionAdapter,
  ref: ReleaseRef,
): Promise<Release & { infohash: string }> {
  const fresh = await adapter.inspect(ref)
  if (fresh.seeders < 1) {
    throw new RequestError(
      `The chosen ${ref.kind === "ebook" ? "ebook" : "audiobook"} has no seeders right now`,
      409,
      `no-seeders-${ref.kind}`,
    )
  }
  if (!fresh.infohash) {
    throw new RequestError(
      "The download source did not identify the release",
      502,
      "no-infohash",
    )
  }
  return { ...fresh, infohash: fresh.infohash }
}

/** Hashes some request already uses: downloading them again costs nothing. */
async function hashesInUse(hashes: string[]): Promise<Set<string>> {
  if (!hashes.length) return new Set()
  const rows = await db
    .selectFrom("bookRequest")
    .select(["ebookInfohash", "audioInfohash"])
    .where((eb) =>
      eb.or([
        eb("ebookInfohash", "in", hashes),
        eb("audioInfohash", "in", hashes),
      ]),
    )
    .execute()
  return new Set(
    rows.flatMap((row) => [row.ebookInfohash, row.audioInfohash]),
  ) as Set<string>
}

/**
 * Check the household limit for new downloads. Both halves of a pair are
 * counted together, so a pair is never half-added for lack of room.
 */
async function reserveDownloads(hashes: string[], now: number): Promise<void> {
  const inUse = await hashesInUse(hashes)
  const needed = hashes.filter((hash) => !inUse.has(hash)).length
  if (!needed) return
  const used = await countRequestDownloads(now - DAY_MS)
  if (used + needed > HOUSEHOLD_DAILY_DOWNLOADS) {
    throw new RequestError(
      `The household has used ${used} of ${HOUSEHOLD_DAILY_DOWNLOADS} downloads today`,
      429,
      "daily-limit",
    )
  }
}

// Serializes the limit check with the insert that uses it.
const creation = new AsyncMutex()

export type CreateRequestInput = {
  kind: RequestKind
  input: RequestInput
  work: ChosenWork
  ebook?: ReleaseRef | null
  audio?: ReleaseRef | null
  /** For `add_format`: the book on the reader's shelf that lacks a format. */
  bookUuid?: UUID | null
}

export async function createRequest(
  userId: UUID,
  body: CreateRequestInput,
  adapter: AcquisitionAdapter,
  now = Date.now(),
): Promise<BookRequest> {
  const chosen = { ebook: body.ebook ?? null, audio: body.audio ?? null }
  if (!chosen.ebook && !chosen.audio) {
    throw new RequestError(
      "Choose an ebook, an audiobook or both",
      400,
      "empty",
    )
  }
  for (const format of ["ebook", "audio"] as const) {
    const ref = chosen[format]
    if (ref && ref.kind !== format) {
      throw new RequestError(
        `The ${format} choice is the wrong kind`,
        400,
        "kind",
      )
    }
  }

  const collectionUuid = await getRequestCollection(userId)
  if (!collectionUuid) {
    throw new RequestError(
      "Choose the shelf your requested books go on first",
      409,
      "no-collection",
    )
  }

  let bookUuid: UUID = randomUUID()
  if (body.kind === "add_format") {
    if (!body.bookUuid || !(await getBook(body.bookUuid, userId))) {
      throw new RequestError("That book is not on your shelf", 404, "no-book")
    }
    bookUuid = body.bookUuid
  }

  const ebook = chosen.ebook ? await inspectChosen(adapter, chosen.ebook) : null
  const audio = chosen.audio ? await inspectChosen(adapter, chosen.audio) : null

  await creation.lock()
  try {
    await reserveDownloads(
      [ebook?.infohash, audio?.infohash].filter((hash) => !!hash) as string[],
      now,
    )
    return await createBookRequest(
      {
        userId,
        kind: body.kind,
        input: body.input,
        chosenWork: body.work,
        bookUuid,
        collectionUuid,
        ebookStatus: ebook ? "downloading" : "none",
        ebookRelease: ebook ? toChosenRelease(ebook) : null,
        ebookInfohash: ebook?.infohash ?? null,
        audioStatus: audio ? "downloading" : "none",
        audioRelease: audio ? toChosenRelease(audio) : null,
        audioInfohash: audio?.infohash ?? null,
      },
      { kind: "requested", message: `Requested ${body.work.title}` },
    )
  } finally {
    creation.unlock()
  }
}

/** A request the reader owns, or a refusal that says nothing about it. */
export async function getOwnRequest(
  userId: UUID,
  uuid: UUID,
): Promise<BookRequest> {
  const request = await getBookRequest(uuid)
  if (!request) throw new RequestError("No such request", 404, "not-found")
  if (request.userId !== userId) {
    throw new RequestError(
      "This request belongs to another account",
      403,
      "other-account",
    )
  }
  return request
}

/**
 * Pick another release for one format: after its seeders dropped to zero, or
 * to replace a stalled download. The stalled torrent is never removed; it
 * finishes on its own if a seeder returns.
 */
export async function chooseRelease(
  userId: UUID,
  uuid: UUID,
  format: RequestFormat,
  ref: ReleaseRef,
  adapter: AcquisitionAdapter,
  now = Date.now(),
): Promise<BookRequest> {
  const request = await getOwnRequest(userId, uuid)
  const status = format === "ebook" ? request.ebookStatus : request.audioStatus
  if (!["choosing", "stalled", "failed", "none"].includes(status)) {
    throw new RequestError(
      "That format is already on its way",
      409,
      "not-choosing",
    )
  }
  if (ref.kind !== format) {
    throw new RequestError(
      `The ${format} choice is the wrong kind`,
      400,
      "kind",
    )
  }
  const fresh = await inspectChosen(adapter, ref)

  await creation.lock()
  try {
    await reserveDownloads([fresh.infohash], now)
    const name = format === "ebook" ? "Ebook" : "Audiobook"
    return await updateBookRequest(
      uuid,
      format === "ebook"
        ? {
            ebookStatus: "downloading",
            ebookRelease: toChosenRelease(fresh),
            ebookInfohash: fresh.infohash,
            ebookProgress: 0,
            ebookBytesDone: 0,
            ebookProgressAt: null,
            ebookAddedAt: null,
            ebookReused: false,
            ebookError: null,
            closedAt: null,
          }
        : {
            audioStatus: "downloading",
            audioRelease: toChosenRelease(fresh),
            audioInfohash: fresh.infohash,
            audioProgress: 0,
            audioBytesDone: 0,
            audioProgressAt: null,
            audioAddedAt: null,
            audioReused: false,
            audioError: null,
            closedAt: null,
          },
      { kind: `${format}-chosen`, message: `${name}: another version chosen` },
    )
  } finally {
    creation.unlock()
  }
}

/** Queue the sync again after it failed or was cancelled. */
export async function retrySync(
  userId: UUID,
  uuid: UUID,
): Promise<BookRequest> {
  const request = await getOwnRequest(userId, uuid)
  if (request.alignStatus !== "failed") {
    throw new RequestError("The sync has not failed", 409, "not-failed")
  }
  const latest = await getLatestJobForBook(request.bookUuid, "book_align")
  const job =
    latest && ["QUEUED", "RUNNING", "PAUSED"].includes(latest.status)
      ? latest
      : await enqueueBookAlign(request.bookUuid, false)
  return await updateBookRequest(
    uuid,
    {
      alignJobUuid: job.uuid,
      alignStatus: "queued",
      notified: request.notified.filter(
        (milestone) => milestone !== "sync-failed" && milestone !== "synced",
      ),
      closedAt: null,
    },
    { kind: "sync-retried", message: "Narration sync queued again" },
  )
}

/** Take a request off the Home card. Its history stays. */
export async function dismissRequest(
  userId: UUID,
  uuid: UUID,
): Promise<BookRequest> {
  const request = await getOwnRequest(userId, uuid)
  if (request.closedAt) return request
  return await updateBookRequest(
    uuid,
    { closedAt: sqlNow() },
    { kind: "dismissed", message: "Dismissed" },
  )
}
