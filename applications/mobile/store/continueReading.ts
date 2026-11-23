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
  readaloud: Download
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
      const download = book[remembered.format]
      if (download) {
        return {
          book,
          session: remembered,
          needsDownload: !isDownloaded(download),
        }
      }
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

    let session: ReadingSession
    let needsDownload: boolean
    if (isStandaloneAudiobookLocator(locator)) {
      if (!book.audiobook) continue
      session = { bookUuid: book.uuid, mode: "listening", format: "audiobook" }
      needsDownload = !isDownloaded(book.audiobook)
    } else {
      const format = isDownloaded(book.readaloud)
        ? "readaloud"
        : isDownloaded(book.ebook)
          ? "ebook"
          : book.readaloud
            ? "readaloud"
            : book.ebook
              ? "ebook"
              : null
      if (!format) continue
      session = { bookUuid: book.uuid, mode: "reading", format }
      needsDownload = !isDownloaded(book[format])
    }

    candidate = { book, session, needsDownload }
    latest = position.timestamp
  }

  return candidate
}
