import { stat } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import { Audiobook } from "@storyteller/audiobooks"

import { getAudiobookTracks } from "@/assets/audiobooks"
import { relocateIfNeeded } from "@/assets/library/scanner/relocate"
import { scan } from "@/assets/library/scanner/scan"
import { type Candidate } from "@/assets/library/scanner/types"
import { type BookWithRelations, getBook } from "@/database/books"
import { addBooksToCollections } from "@/database/collections"
import { getBookImportedFrom } from "@/database/importRules"
import { type UUID } from "@/uuid"

export type DeliveryFormat = "ebook" | "audiobook"

export type DeliverFormatInput = {
  /** The id reserved for the book before anything was imported. */
  bookUuid: UUID
  /** The only collection the book is filed into. */
  collectionUuid: UUID
  /** Whose shelf the book is for; checks run with their visibility. */
  userId: UUID
  format: DeliveryFormat
  /** The EPUB file, or the folder holding the audiobook's tracks. */
  source: string
}

export type DeliverFormatResult = {
  /** The reserved id, or the existing book the files already belong to. */
  bookUuid: UUID
  outcome: "created" | "attached" | "already-present" | "joined-existing"
}

/**
 * A delivery that cannot finish. `retryable` failures (a failed import, a
 * file not readable yet) may succeed on a later attempt; the others need a
 * person.
 */
export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = "DeliveryError"
  }
}

function hasFormat(book: BookWithRelations, format: DeliveryFormat): boolean {
  const asset = format === "ebook" ? book.ebook : book.audiobook
  return !!asset?.filepath && !asset.missing
}

function isSource(filepath: string, input: DeliverFormatInput): boolean {
  return resolve(filepath) === resolve(input.source)
}

async function sourceFiles(input: DeliverFormatInput): Promise<string[]> {
  if (input.format === "ebook") return [input.source]
  try {
    return await getAudiobookTracks(input.source)
  } catch (error) {
    throw new DeliveryError(
      `No audio tracks readable in the download: ${error instanceof Error ? error.message : String(error)}`,
      true,
    )
  }
}

async function importCandidate(
  input: DeliverFormatInput,
  bookUuid: UUID,
): Promise<void> {
  const candidate: Candidate = {
    folder: input.format === "ebook" ? dirname(input.source) : input.source,
    format: input.format,
    filepath: input.source,
    bookUuidHint: bookUuid,
    collections: [input.collectionUuid],
    exactCollections: true,
    attachIfMissing: true,
    // the source is a download still being seeded: never move or edit it.
    importMode: "copy",
  }

  await scan({
    source: "api",
    request: { kind: "candidates", candidates: [candidate] },
    options: { force: true },
    signal: new AbortController().signal,
  })
}

async function totalDuration(tracks: string[]): Promise<number> {
  const [first, ...rest] = tracks
  if (!first) return 0
  using audiobook = await Audiobook.from(first, ...rest)
  return await audiobook.getDuration()
}

/**
 * A copied audiobook counts as delivered only when it has as many tracks as
 * the download and plays for as long.
 */
async function verifyAudiobook(
  input: DeliverFormatInput,
  libraryDir: string,
): Promise<void> {
  const [sourceTracks, libraryTracks] = await Promise.all([
    getAudiobookTracks(input.source),
    getAudiobookTracks(libraryDir),
  ])
  if (sourceTracks.length !== libraryTracks.length) {
    throw new DeliveryError(
      `The library copy has ${libraryTracks.length} tracks, the download has ${sourceTracks.length}`,
      false,
    )
  }

  const [sourceSeconds, librarySeconds] = await Promise.all([
    totalDuration(sourceTracks),
    totalDuration(libraryTracks),
  ])
  if (Math.abs(sourceSeconds - librarySeconds) > 1) {
    throw new DeliveryError(
      `The library copy plays for ${Math.round(librarySeconds)} s, the download for ${Math.round(sourceSeconds)} s`,
      false,
    )
  }
}

async function verifyEbook(filepath: string): Promise<void> {
  try {
    await stat(filepath)
  } catch {
    throw new DeliveryError(`The library copy at ${filepath} is missing`, true)
  }
}

/**
 * Bring one format of a requested book into the library, safely repeatable
 * after a crash or a lost response at any point:
 *
 * - The book is created with the reserved id, so a repeat finds it instead of
 *   creating a second one.
 * - A format the book already has is left as it is; nothing is replaced.
 * - The book joins the given collection and no other.
 * - Files that another book already imported (another reader requested the
 *   same download) add the collection to that book instead of creating one.
 * - The source is copied, never moved or changed.
 *
 * Throws a `DeliveryError` when the result cannot be confirmed.
 */
export async function deliverFormat(
  input: DeliverFormatInput,
): Promise<DeliverFormatResult> {
  let outcome: DeliverFormatResult["outcome"]
  let bookUuid = input.bookUuid
  const existing = await getBook(bookUuid)

  if (existing) {
    // The reserved book was created by this delivery; if the reader can no
    // longer see it, it was moved off their shelf, and is not ours to change.
    if (!(await getBook(bookUuid, input.userId))) {
      throw new DeliveryError(
        "The book is no longer on the requester's shelf",
        false,
      )
    }
    const current =
      input.format === "ebook" ? existing.ebook : existing.audiobook
    if (current?.filepath && isSource(current.filepath, input)) {
      // An earlier attempt created the book but stopped before its copy was
      // made: the book still reads the download itself. Make the copy now.
      await relocateIfNeeded(existing, input.source, input.format, "copy")
      outcome = "attached"
    } else if (hasFormat(existing, input.format)) {
      outcome = "already-present"
    } else {
      await importCandidate(input, bookUuid)
      outcome = "attached"
    }
    await addBooksToCollections([input.collectionUuid], [bookUuid])
  } else {
    const owner = await getBookImportedFrom(await sourceFiles(input))
    if (owner) {
      await addBooksToCollections([input.collectionUuid], [owner])
      bookUuid = owner
      outcome = "joined-existing"
    } else {
      await importCandidate(input, bookUuid)
      outcome = "created"
    }
  }

  const book = await getBook(bookUuid)
  const asset = input.format === "ebook" ? book?.ebook : book?.audiobook
  if (!asset?.filepath || asset.missing || isSource(asset.filepath, input)) {
    throw new DeliveryError(
      `The ${input.format} could not be imported from ${input.source}`,
      outcome !== "joined-existing",
    )
  }

  // Check the copy whenever it was made from these files, including by an
  // earlier attempt that was interrupted before it could check.
  const copiedFromSource =
    outcome === "created" ||
    outcome === "attached" ||
    (outcome === "already-present" &&
      (await getBookImportedFrom(await sourceFiles(input))) === bookUuid)
  if (copiedFromSource) {
    if (input.format === "audiobook") {
      await verifyAudiobook(input, asset.filepath)
    } else {
      await verifyEbook(asset.filepath)
    }
  }

  return { bookUuid, outcome }
}
