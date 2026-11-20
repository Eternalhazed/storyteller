import { logger } from "@/logging"
import type { UUID } from "@/uuid"

type EbookImportHandler = (bookUuid: UUID) => Promise<void>

declare global {
  // eslint-disable-next-line no-var
  var ebookImportHandler: EbookImportHandler | undefined
}

/** The server registers background work; scanner code in workers has no handler. */
export function setEbookImportHandler(handler: EbookImportHandler | undefined) {
  globalThis.ebookImportHandler = handler
}

/** Optional background work must not turn a completed import into a failure. */
export async function notifyEbookImported(bookUuid: UUID): Promise<void> {
  try {
    await globalThis.ebookImportHandler?.(bookUuid)
  } catch (error) {
    logger.warn({
      msg: "Post-import ebook work failed",
      bookUuid,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
