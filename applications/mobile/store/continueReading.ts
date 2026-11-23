import { type ReadiumLocator } from "@/modules/readium/src/Readium.types"
import { type UUID } from "@/uuid"

import { isStandaloneAudiobookLocator } from "./locatorFormat"

export type ReadingSession = { bookUuid: UUID } & (
  | { mode: "reading"; format: "ebook" | "readaloud" }
  | { mode: "listening"; format: "audiobook" | "readaloud" }
)

type Download = { downloadStatus: string | null } | null

type ContinueBook = {
  uuid: UUID
  status: { name: string } | null
  position: { timestamp: number; locator: ReadiumLocator } | null
  ebook: Download
  readaloud: (Download & { status?: string | null }) | null
  audiobook: Download
}

export type ContinueCandidate<Book> = {
  book: Book
  session: ReadingSession
  /** The format to continue in isn't on this device yet. */
  needsDownload: boolean
}

function isDownloaded(download: Download) {
  return download?.downloadStatus === "DOWNLOADED"
}

/** A read-along can only be downloaded once it has finished syncing. */
function canDownloadReadaloud(book: ContinueBook) {
  return book.readaloud?.status === "ALIGNED"
}

/**
 * The session that continues `wanted` on this device. A downloaded read-along
 * holds both the text and the audio, so it stands in for a missing ebook or
 * audiobook (which can't be downloaded alongside it). Null when nothing usable
 * is on the device or downloadable.
 */
function resolve(
  book: ContinueBook,
  wanted: ReadingSession,
): Omit<ContinueCandidate<ContinueBook>, "book"> | null {
  if (isDownloaded(book[wanted.format])) {
    return { session: wanted, needsDownload: false }
  }
  if (wanted.format !== "readaloud" && isDownloaded(book.readaloud)) {
    return {
      session: { ...wanted, format: "readaloud" } as ReadingSession,
      needsDownload: false,
    }
  }
  if (!book[wanted.format]) return null
  if (wanted.format === "readaloud" && !canDownloadReadaloud(book)) return null
  return { session: wanted, needsDownload: true }
}

/**
 * Prefer the last surface actually opened here; otherwise use saved progress,
 * which may come from another device. A book whose format isn't on this device
 * is still offered, flagged `needsDownload`, so it can be downloaded in place.
 */
export function getContinueReading<Book extends ContinueBook>(
  books: readonly Book[],
  remembered: ReadingSession | null,
): ContinueCandidate<Book> | null {
  let candidate: ContinueCandidate<Book> | null = null
  let latest = -Infinity

  for (const book of books) {
    if (book.status?.name === "Read") continue
    if (book.uuid === remembered?.bookUuid) {
      const resolved = resolve(book, remembered)
      if (resolved) return { book, ...resolved }
      // Do not silently replace a known reading or listening format.
      continue
    }

    const position = book.position
    if (!position || position.timestamp <= latest) continue
    const { locator } = position
    const progress = locator.locations?.totalProgression ?? 0
    if (
      book.status?.name !== "Reading" &&
      !(Number.isFinite(progress) && progress > 0)
    ) {
      continue
    }

    const resolved = isStandaloneAudiobookLocator(locator)
      ? resolve(book, {
          bookUuid: book.uuid,
          mode: "listening",
          format: "audiobook",
        })
      : isDownloaded(book.readaloud) || isDownloaded(book.ebook)
        ? resolve(book, {
            bookUuid: book.uuid,
            mode: "reading",
            format: isDownloaded(book.readaloud) ? "readaloud" : "ebook",
          })
        : canDownloadReadaloud(book)
          ? resolve(book, {
              bookUuid: book.uuid,
              mode: "reading",
              format: "readaloud",
            })
          : resolve(book, {
              bookUuid: book.uuid,
              mode: "reading",
              format: "ebook",
            })
    if (!resolved) continue

    candidate = { book, ...resolved }
    latest = position.timestamp
  }

  return candidate
}
