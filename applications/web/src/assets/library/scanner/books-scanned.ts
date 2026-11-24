import { logger } from "@/logging"
import type { UUID } from "@/uuid"

type BooksScannedHandler = (bookUuids: UUID[]) => Promise<void>

declare global {
  // eslint-disable-next-line no-var
  var booksScannedHandler: BooksScannedHandler | undefined
}

/**
 * The server registers work that follows a scan that created or changed
 * books (a new book, an attached or replaced format). Scanner code in workers
 * has no handler.
 */
export function setBooksScannedHandler(
  handler: BooksScannedHandler | undefined,
) {
  globalThis.booksScannedHandler = handler
}

/** Follow-up work must not turn a completed scan into a failure. */
export async function notifyBooksScanned(bookUuids: UUID[]): Promise<void> {
  if (!bookUuids.length) return
  try {
    await globalThis.booksScannedHandler?.(bookUuids)
  } catch (error) {
    logger.warn({
      msg: "Post-scan book work failed",
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
