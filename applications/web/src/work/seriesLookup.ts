import { getBook } from "@/database/books"
import { logger } from "@/logging"
import { autoImportMetadata } from "@/metadataAutoImport"
import { type UUID } from "@/uuid"
import { queueWritesToFiles } from "@/writeToFiles/fileWriteDistributor"

/**
 * Look up metadata for a newly imported book whose files name no series.
 *
 * A book that names its series joins it (or starts it) on import already.
 * Many files carry no series, so this asks the metadata providers, as the
 * book page's "auto import" action does, and the confidence thresholds in
 * the settings decide whether anything is applied. Never throws: an import
 * must not fail because a lookup did.
 */
export async function lookUpSeriesForNewBook(bookUuid: UUID): Promise<void> {
  try {
    const book = await getBook(bookUuid)
    if (!book || book.series.length) return

    const result = await autoImportMetadata(book)
    if (result.fields.length) void queueWritesToFiles(book.uuid)
    logger.info({
      msg: "Looked up metadata for a new book without a series",
      bookUuid,
      status: result.status,
      fields: result.fields,
      series: result.book.series.map((series) => series.name),
    })
  } catch (error) {
    logger.warn({
      msg: "Metadata lookup for a new book failed",
      bookUuid,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
