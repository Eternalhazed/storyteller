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

/** Prefer the last surface actually opened here; otherwise use saved progress. */
export function getContinueReading<Book extends ContinueBook>(
  books: readonly Book[],
  remembered: ReadingSession | null,
): { book: Book; session: ReadingSession } | null {
  let candidate: { book: Book; session: ReadingSession } | null = null
  let latest = -Infinity

  for (const book of books) {
    if (book.status?.name === "Read") continue
    if (book.uuid === remembered?.bookUuid) {
      if (book[remembered.format]?.downloadStatus === "DOWNLOADED") {
        return { book, session: remembered }
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
    if (isStandaloneAudiobookLocator(locator)) {
      if (book.audiobook?.downloadStatus !== "DOWNLOADED") continue
      session = { bookUuid: book.uuid, mode: "listening", format: "audiobook" }
    } else {
      const format =
        book.readaloud?.downloadStatus === "DOWNLOADED"
          ? "readaloud"
          : book.ebook?.downloadStatus === "DOWNLOADED"
            ? "ebook"
            : null
      if (!format) continue
      session = { bookUuid: book.uuid, mode: "reading", format }
    }

    candidate = { book, session }
    latest = position.timestamp
  }

  return candidate
}
