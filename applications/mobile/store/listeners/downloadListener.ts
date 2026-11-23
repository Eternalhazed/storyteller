import { type ListenerEffectAPI, isAnyOf } from "@reduxjs/toolkit"
import { Directory, File } from "expo-file-system"
import * as FileSystem from "expo-file-system/legacy"
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake"
import * as SecureStore from "expo-secure-store"
import { sql } from "kysely"

import { getBook, removeBookDownloads } from "@/database/books"
import { db, rawDb } from "@/database/db"
import { getServer } from "@/database/servers"
import { describeError } from "@/describeError"
import { logger } from "@/logger"
import {
  type ReadiumManifest,
  Storyteller,
  buildAudiobookManifest,
  extractArchive,
  getPositions,
  openPublication,
} from "@/modules/readium"
import type {
  ReadiumClip,
  ReadiumLocator,
} from "@/modules/readium/src/Readium.types"
import type { AppDispatch, RootState } from "@/store/appState"
import {
  type DownloadFormat,
  createDownloadQueue,
  downloadLifecycle,
} from "@/store/downloadLifecycle"
import { localApi } from "@/store/localApi"
import {
  deleteLocalBookFiles,
  getLocalBookArchiveUrl,
  getLocalBookExtractedUrl,
} from "@/store/persistence/files"
import { getDownloadUrl } from "@/store/serverApi"
import { transferFeedbackSlice } from "@/store/slices/transferFeedbackSlice"
import { type UUID, randomUUID } from "@/uuid"

import {
  createDownloadProgressHandler,
  getDownloadProgress,
} from "./downloadProgress"
import { startAppListening } from "./listenerMiddleware"

async function downloadBook(
  bookUuid: UUID,
  format: DownloadFormat,
  listenerApi: ListenerEffectAPI<RootState, AppDispatch>,
) {
  const target = { bookUuid, format }
  const task = downloadLifecycle.begin(target)
  if (!task) return false

  listenerApi.dispatch(
    transferFeedbackSlice.actions.bookDownloadChanged({
      ...target,
      phase: "downloading",
    }),
  )
  let keepAwake = false
  function updateCachedDownloadState(state: {
    downloadStatus?: "ERROR" | "DOWNLOADED" | "DOWNLOADING"
    downloadProgress?: number
  }) {
    listenerApi.dispatch(
      localApi.util.updateQueryData("getBook", { uuid: bookUuid }, (book) => {
        if (!book?.[format]) return
        Object.assign(book[format], state)
      }),
    )
  }

  // The runtime task, not a rounded byte percentage, owns the transition to
  // non-cancellable extraction and publication parsing.

  try {
    logger.debug(`Starting download for ${bookUuid} (${format})`)
    const book = await getBook(bookUuid)
    if (
      !book?.[format] ||
      !["DOWNLOADING", "QUEUED", "PAUSED"].includes(
        book[format]!.downloadStatus,
      ) ||
      task.isCancelled()
    )
      return true

    await db
      .updateTable(format)
      .set({ downloadStatus: "DOWNLOADING", downloadProgress: 0 })
      .where("bookUuid", "=", bookUuid)
      .execute()
    updateCachedDownloadState({
      downloadStatus: "DOWNLOADING",
      downloadProgress: 0,
    })
    if (!book.serverUuid) {
      throw new Error(
        `Attempted to download a book that did not originate from a server`,
      )
    }

    logger.debug(`Getting server for ${bookUuid} (${format})`)
    const server = await getServer(book.serverUuid)
    const token = await SecureStore.getItemAsync(`server.${server.uuid}.token`)

    logger.debug(`Getting local book archive URI for ${bookUuid} (${format})`)
    const localBookArchiveUri = getLocalBookArchiveUrl(book.uuid, format)

    logger.debug(`Creating parent directory for ${localBookArchiveUri}`)
    new File(localBookArchiveUri).parentDirectory.create({
      idempotent: true,
      intermediates: true,
    })

    logger.debug(`Creating download resumable for ${bookUuid} (${format})`)
    const downloadProgress = createDownloadProgressHandler(
      async (isActive, progressData: FileSystem.DownloadProgressData) => {
        logger.debug(
          `Progress: ${progressData.totalBytesWritten} / ${progressData.totalBytesExpectedToWrite}`,
        )
        const progress = getDownloadProgress(
          progressData.totalBytesWritten,
          progressData.totalBytesExpectedToWrite,
        )
        logger.debug(`Progress: ${progress}`)
        await db.transaction().execute(async (tr) => {
          logger.debug(`Updating download status for ${bookUuid} (${format})`)
          const { downloadStatus } = await tr
            .selectFrom(format)
            .select(["downloadStatus"])
            .where("bookUuid", "=", bookUuid)
            .executeTakeFirstOrThrow()
          if (!isActive() || downloadStatus === "DOWNLOADED") return

          logger.debug(`Updating download status for ${bookUuid} (${format})`)
          await tr
            .updateTable(format)
            .set({
              downloadStatus: "DOWNLOADING",
              downloadProgress: progress,
            })
            .where("bookUuid", "=", bookUuid)
            .execute()
        })

        if (!isActive()) return

        logger.debug(
          `Updating cached download state for ${bookUuid} (${format})`,
        )
        updateCachedDownloadState({
          downloadStatus: "DOWNLOADING",
          downloadProgress: progress,
        })

        logger.debug(`Downloading...`)

        // TODO: Support pausing
      },
      250,
    )
    const download = FileSystem.createDownloadResumable(
      getDownloadUrl(server.baseUrl, bookUuid, format),
      localBookArchiveUri,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(format === "audiobook" && {
            Accept: "application/audiobook+zip",
          }),
        },
      },
      downloadProgress.update,
    )

    if (task.isCancelled()) return true

    let result
    try {
      logger.debug(`Activating keep awake for ${bookUuid} (${format})`)
      await activateKeepAwakeAsync(`download.${bookUuid}.${format}`)
      keepAwake = true
      if (task.isCancelled()) return true
      task.setCancelTransfer(() => download.cancelAsync())
      logger.debug(`Starting download for ${bookUuid} (${format})`)
      result = await download.downloadAsync()
    } finally {
      downloadProgress.cancel()
    }

    if (task.isCancelled()) return true
    if (!result) throw new Error("Download stopped before completion")
    if (!task.prepare()) return true
    listenerApi.dispatch(
      transferFeedbackSlice.actions.bookDownloadChanged({
        ...target,
        phase: "preparing",
      }),
    )

    logger.debug(`Download complete for ${bookUuid} (${format})`)
    logger.debug(`Extracting archive for ${bookUuid} (${format})`)

    const localExtractedUri = getLocalBookExtractedUrl(bookUuid, format)
    logger.debug(`Getting extracted directory for ${localExtractedUri}`)
    const extractedDirectory = new Directory(localExtractedUri)
    logger.debug(
      `Checking if extracted directory exists for ${localExtractedUri}`,
    )
    if (extractedDirectory.exists) {
      extractedDirectory.delete()
    }
    logger.debug(`Creating extracted directory for ${localExtractedUri}`)
    extractedDirectory.create({
      idempotent: true,
      intermediates: true,
    })

    logger.debug(
      `Extracting archive for ${localBookArchiveUri} to ${extractedDirectory.uri}`,
    )
    await extractArchive(localBookArchiveUri, extractedDirectory.uri)

    new File(localBookArchiveUri).delete()

    if (format === "audiobook") {
      logger.debug(`Reading audiobook manifest for ${bookUuid} (${format})`)
      const manifestFile = new File(
        extractedDirectory,
        "manifest.audiobook-manifest",
      )
      const manifestText = await manifestFile.text()
      const manifest = JSON.parse(manifestText) as ReadiumManifest

      logger.debug(`Updating audiobook manifest for ${bookUuid} (${format})`)
      await db
        .updateTable("audiobook")
        .set({
          manifest: JSON.stringify(manifest) as unknown as ReadiumManifest,
        })
        .where("bookUuid", "=", bookUuid)
        .execute()
    } else {
      logger.debug(`Reading EPUB manifest`)
      const epubManifest = await openPublication(
        bookUuid,
        getLocalBookExtractedUrl(bookUuid, format),
      )
      logger.debug(`Building audiobook manifest`)
      const audioManifest = await buildAudiobookManifest(bookUuid)

      if (format === "readaloud" && !audioManifest.readingOrder.length) {
        // The audio tracks are derived from the media overlays, so an empty
        // reading order means they were never parsed. Caching that would leave
        // the book readable with dead audio, so fail the download instead.
        throw new Error(`Readaloud for book ${bookUuid} has no audio tracks`)
      }

      logger.debug("Retrieving overlay clips")
      const clips = await Storyteller.getOverlayClips(bookUuid)
      logger.debug("Retrieving positions")
      const positions = await getPositions(bookUuid)

      await db
        .updateTable(format)
        .set({
          ...(format === "ebook"
            ? {
                manifest: JSON.stringify(
                  epubManifest,
                ) as unknown as ReadiumManifest,
              }
            : {
                epubManifest: JSON.stringify(
                  epubManifest,
                ) as unknown as ReadiumManifest,
                audioManifest: JSON.stringify(
                  audioManifest,
                ) as unknown as ReadiumManifest,
                clips: JSON.stringify(clips) as unknown as ReadiumClip[],
              }),
          positions: JSON.stringify(positions) as unknown as ReadiumLocator[],
        })
        .where("bookUuid", "=", bookUuid)
        .execute()

      logger.debug("Cached publication metadata in local db")

      if (!book.position) {
        logger.debug(`No local position for book, starting at beginning`)
        await db
          .insertInto("position")
          .values({
            uuid: randomUUID(),
            bookUuid,
            locator: JSON.stringify(positions[0]!) as unknown as ReadiumLocator,
            timestamp: Date.now(),
          })
          .execute()
      }
    }

    await db
      .updateTable(format)
      .set({
        downloadProgress: 100,
        downloadStatus: "DOWNLOADED",
      })
      .where("bookUuid", "=", bookUuid)
      .execute()

    await rawDb.flushPendingReactiveQueries()

    updateCachedDownloadState({
      downloadStatus: "DOWNLOADED",
      downloadProgress: 100,
    })
    logger.debug(`Download complete`)

    if (format === "readaloud") {
      logger.debug(`Removing standalone formats of ${bookUuid}`)

      for (const standaloneFormat of ["ebook", "audiobook"] as const) {
        await removeBookDownloads(bookUuid, standaloneFormat)
        await deleteLocalBookFiles(bookUuid, standaloneFormat)
      }
    }

    listenerApi.dispatch(
      localApi.util.invalidateTags([{ type: "Books", id: bookUuid }]),
    )
    listenerApi.dispatch(
      localApi.endpoints.refreshBookXray.initiate(
        { bookUuid },
        { track: false },
      ),
    )
  } catch (e) {
    if (task.isCancelled()) return true
    logger.error(`Failed to download book`)
    logger.error(describeError(e))

    await db
      .updateTable(format)
      .set({ downloadStatus: "ERROR" })
      .where("bookUuid", "=", bookUuid)
      .execute()

    await rawDb.flushPendingReactiveQueries()

    updateCachedDownloadState({
      downloadStatus: "ERROR",
    })

    listenerApi.dispatch(
      transferFeedbackSlice.actions.bookTransferFailed(
        `Failed to download ${format}: ${describeError(e)}`,
      ),
    )
  } finally {
    if (keepAwake) {
      try {
        await deactivateKeepAwake(`download.${bookUuid}.${format}`)
      } catch (error) {
        logger.error(describeError(error))
      }
    }
    task.finish()
    listenerApi.dispatch(
      transferFeedbackSlice.actions.bookDownloadSettled(target),
    )
  }
  return true
}

const processDownloadQueue = createDownloadQueue<
  ListenerEffectAPI<RootState, AppDispatch>
>(async (listenerApi) => {
  const next = await db
    .selectFrom("audiobook")
    .select([
      "bookUuid",
      "downloadQueuePosition",
      sql.lit("audiobook").as("format"),
    ])
    .where("downloadStatus", "in", ["QUEUED", "DOWNLOADING", "PAUSED"])
    .union(
      db
        .selectFrom("ebook")
        .select([
          "bookUuid",
          "downloadQueuePosition",
          sql.lit("ebook").as("format"),
        ])
        .where("downloadStatus", "in", ["QUEUED", "DOWNLOADING", "PAUSED"]),
    )
    .union(
      db
        .selectFrom("readaloud")
        .select([
          "bookUuid",
          "downloadQueuePosition",
          sql.lit("readaloud").as("format"),
        ])
        .where("downloadStatus", "in", ["QUEUED", "DOWNLOADING", "PAUSED"]),
    )
    .orderBy("downloadQueuePosition", "asc")
    .limit(1)
    .executeTakeFirst()
  if (!next) return "empty"
  const started = await downloadBook(
    next.bookUuid,
    next.format as DownloadFormat,
    listenerApi,
  )
  return started ? "processed" : "blocked"
})

startAppListening({
  matcher: isAnyOf(
    localApi.endpoints.downloadBook.matchFulfilled,
    localApi.endpoints.cancelDownload.matchFulfilled,
    localApi.endpoints.cancelDownload.matchRejected,
  ),
  effect: async (action, listenerApi) => {
    await processDownloadQueue(
      listenerApi,
      localApi.endpoints.downloadBook.matchFulfilled(action),
    )
  },
})
