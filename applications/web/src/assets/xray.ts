import { rename, rm, stat } from "node:fs/promises"

import { getXrayFilepath, getXrayStateFilepath } from "@/assets/paths"
import { logger } from "@/logging"
import type { UUID } from "@/uuid"

/** Derived data must never prevent a book deletion, merge, or replacement. */
export async function removeXrayFiles(bookUuid: UUID): Promise<void> {
  for (const filepath of [
    getXrayFilepath(bookUuid),
    getXrayStateFilepath(bookUuid),
  ]) {
    try {
      await rm(filepath, { force: true })
    } catch (error) {
      logger.warn({
        msg: "Failed to remove X-Ray data",
        bookUuid,
        filepath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/** Keep paid-for X-Ray data when its ebook moves to a merged book. */
export async function mergeXrayFiles(
  sourceBookUuid: UUID,
  targetBookUuid: UUID,
): Promise<void> {
  try {
    try {
      if ((await stat(getXrayFilepath(targetBookUuid))).size > 0) {
        await removeXrayFiles(sourceBookUuid)
        return
      }
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      ) {
        throw error
      }
    }

    for (const [source, target] of [
      [getXrayFilepath(sourceBookUuid), getXrayFilepath(targetBookUuid)],
      [
        getXrayStateFilepath(sourceBookUuid),
        getXrayStateFilepath(targetBookUuid),
      ],
    ] as const) {
      try {
        await rename(source, target)
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          continue
        }
        logger.warn({
          msg: "Failed to move merged X-Ray data",
          sourceBookUuid,
          targetBookUuid,
          source,
          target,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  } catch (error) {
    logger.warn({
      msg: "Failed to preserve merged X-Ray data",
      sourceBookUuid,
      targetBookUuid,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
