import AsyncStorage from "@react-native-async-storage/async-storage"
import { isAnyOf } from "@reduxjs/toolkit"

import { logger } from "@/logger"
import {
  canPromptAfterDismissal,
  getProgress,
  shouldAutoStart,
  shouldFinish,
} from "@/store/finish"
import { localApi } from "@/store/localApi"
import { finishSlice } from "@/store/slices/finishSlice"
import { type UUID } from "@/uuid"

import { startAppListening } from "./listenerMiddleware"

const STORAGE_KEY = "storyteller.finish-dismissed"
const { actions } = finishSlice
let savedDismissals: Promise<Record<string, number>> | undefined
let storageWrite = Promise.resolve()
const positionUpdates = new Map<UUID, Promise<void>>()

function loadDismissals() {
  savedDismissals ??= AsyncStorage.getItem(STORAGE_KEY)
    .then((value) => {
      const parsed: unknown = value ? JSON.parse(value) : {}
      const dismissed: Record<string, number> = {}
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [bookUuid, progress] of Object.entries(parsed)) {
          if (
            typeof progress === "number" &&
            Number.isFinite(progress) &&
            progress >= 0 &&
            progress <= 1
          ) {
            dismissed[bookUuid] = progress
          }
        }
      }
      return dismissed
    })
    .catch(() => {
      logger.error("Could not read finished-book dismissals")
      return {}
    })
  return savedDismissals
}

startAppListening({
  // `track: false` skips RTK's mutation cache, not its fulfilled action.
  matcher: localApi.endpoints.updatePosition.matchFulfilled,
  effect: async (action, listenerApi) => {
    const { bookUuid, locator, timestamp } = action.meta.arg.originalArgs
    const { bookshelf } = listenerApi.getState()
    const audio =
      bookshelf.currentlyPlayingBookUuid === bookUuid &&
      bookshelf.currentlyPlayingFormat !== "ebook" &&
      (bookshelf.isPlaying || bookshelf.playbackSpeedContext === "listening")
        ? {
            tracks: bookshelf.tracks,
            trackIndex: bookshelf.currentTrackIndex,
            position: bookshelf.position,
          }
        : undefined

    // Serialize a book's updates so slow storage cannot mark it read twice or
    // replace the original status needed by Undo.
    const previous = positionUpdates.get(bookUuid) ?? Promise.resolve()
    const update = previous
      .catch(() => {})
      .then(async () => {
        const [book, preferences, statuses, dismissed] = await Promise.all([
          listenerApi
            .dispatch(
              localApi.endpoints.getBook.initiate(
                { uuid: bookUuid },
                { subscribe: false, forceRefetch: true },
              ),
            )
            .unwrap(),
          listenerApi
            .dispatch(
              localApi.endpoints.getGlobalPreferences.initiate(undefined, {
                subscribe: false,
              }),
            )
            .unwrap(),
          listenerApi
            .dispatch(
              localApi.endpoints.listStatuses.initiate(undefined, {
                subscribe: false,
              }),
            )
            .unwrap(),
          loadDismissals(),
        ])
        if (!listenerApi.getState().finish.dismissalsLoaded) {
          listenerApi.dispatch(actions.dismissalsLoaded(dismissed))
        }
        if (!book || (book.position && book.position.timestamp > timestamp)) {
          return
        }

        const evaluation = { status: book.status, position: { locator } }
        const finishPreferences = preferences.finishPrompt
        if (shouldAutoStart(evaluation, finishPreferences)) {
          const reading = statuses.find((status) => status.name === "Reading")
          if (reading) {
            await listenerApi
              .dispatch(
                localApi.endpoints.updateStatus.initiate(
                  { bookUuid, statusUuid: reading.uuid },
                  { track: false },
                ),
              )
              .unwrap()
            evaluation.status = {
              ...reading,
              dirty: "true",
            }
          }
        }

        const progress = getProgress(locator)
        const finish = listenerApi.getState().finish
        if (
          finishPreferences.mode === "off" ||
          !shouldFinish(evaluation, finishPreferences.threshold, audio) ||
          !canPromptAfterDismissal(progress, finish.dismissed[bookUuid])
        ) {
          if (finish.prompts[bookUuid]?.kind === "ask") {
            listenerApi.dispatch(actions.promptCleared({ bookUuid }))
          }
          return
        }

        if (finishPreferences.mode === "ask") {
          listenerApi.dispatch(
            actions.promptShown({ kind: "ask", bookUuid, progress }),
          )
          return
        }

        const read = statuses.find((status) => status.name === "Read")
        const previousStatusUuid =
          evaluation.status?.uuid ??
          statuses.find((status) => status.name === "To read")?.uuid
        if (!read || !previousStatusUuid) return

        await listenerApi
          .dispatch(
            localApi.endpoints.updateStatus.initiate(
              { bookUuid, statusUuid: read.uuid },
              { track: false },
            ),
          )
          .unwrap()
        listenerApi.dispatch(
          actions.promptShown({
            kind: "undo",
            bookUuid,
            progress,
            previousStatusUuid,
            expiresAt: Date.now() + 8_000,
          }),
        )
      })
    positionUpdates.set(bookUuid, update)
    try {
      await update
    } finally {
      if (positionUpdates.get(bookUuid) === update) {
        positionUpdates.delete(bookUuid)
      }
    }
  },
})

startAppListening({
  matcher: isAnyOf(actions.promptDismissed, actions.dismissalRecorded),
  effect: async (_, listenerApi) => {
    const value = JSON.stringify(listenerApi.getState().finish.dismissed)
    storageWrite = storageWrite
      .then(() => AsyncStorage.setItem(STORAGE_KEY, value))
      .catch(() => {
        logger.error("Could not remember finished-book dismissals")
      })
    await storageWrite
  },
})

startAppListening({
  actionCreator: actions.promptShown,
  effect: async (action, listenerApi) => {
    const prompt = action.payload
    if (prompt.kind !== "undo") return
    await listenerApi.delay(Math.max(0, prompt.expiresAt - Date.now()))
    const current = listenerApi.getState().finish.prompts[prompt.bookUuid]
    if (
      current?.kind === "undo" &&
      current.bookUuid === prompt.bookUuid &&
      current.expiresAt === prompt.expiresAt
    ) {
      listenerApi.dispatch(actions.promptCleared({ bookUuid: prompt.bookUuid }))
    }
  },
})
