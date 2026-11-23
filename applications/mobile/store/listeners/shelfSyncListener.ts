import { isAnyOf } from "@reduxjs/toolkit"

import { getBook } from "@/database/books"
import { getPreference } from "@/database/preferences"
import {
  type Shelf,
  acknowledgeShelfPush,
  applyShelfPull,
  bindShelfToRemote,
  getShelf,
  getShelves,
} from "@/database/shelves"
import { getStatus } from "@/database/statuses"
import { logger } from "@/logger"
import { type AppDispatch } from "@/store/appState"
import { localApi } from "@/store/localApi"
import { type ServerShelf, serverApi } from "@/store/serverApi"
import {
  getShortlists,
  isShortlistShelf,
  shouldRemoveFromShortlist,
} from "@/store/shortlist"
import { type UUID, randomUUID } from "@/uuid"

import { startAppListening } from "./listenerMiddleware"

function cachedShelf(
  remote: ServerShelf,
  serverUuid: UUID,
  position: number,
): Shelf {
  return {
    uuid: randomUUID(),
    remoteUuid: remote.uuid,
    serverUuid,
    name: remote.name,
    kind:
      remote.filter !== null || remote.filterIssues?.length
        ? "smart"
        : "manual",
    position,
    bookUuids: [...remote.books]
      .sort((a, b) => a.position - b.position)
      .map((book) => book.bookUuid),
    dirty: "false",
    createdAt: remote.createdAt,
    updatedAt: remote.updatedAt,
  }
}

async function syncServerShelves(serverUuid: UUID, dispatch: AppDispatch) {
  // Fetch before creating, including after a failed POST whose response may
  // have been lost. Only the oldest manual Shortlist is ever adopted.
  const remoteShelves = [
    ...(await dispatch(
      serverApi.endpoints.listShelves.initiate(
        { serverUuid },
        { subscribe: false, forceRefetch: true },
      ),
    ).unwrap()),
  ]

  for (const dirty of (await getShelves(serverUuid)).filter(
    (shelf) => shelf.dirty === "true",
  )) {
    let snapshot = await getShelf(dirty.uuid)
    if (!snapshot || snapshot.dirty !== "true") continue
    const remoteUuid = snapshot.remoteUuid
    let remoteIndex = remoteShelves.findIndex(
      (remote) => remote.uuid === remoteUuid,
    )

    if (isShortlistShelf(snapshot)) {
      const existing = getShortlists(
        remoteShelves.map((remote, index) =>
          cachedShelf(remote, serverUuid, index),
        ),
      )[0]
      if (existing) {
        if (snapshot.remoteUuid !== existing.remoteUuid) {
          snapshot = await bindShelfToRemote(snapshot.uuid, existing)
          if (!snapshot) continue
        }
        remoteIndex = remoteShelves.findIndex(
          (remote) => remote.uuid === existing.remoteUuid,
        )
      } else {
        // A renamed/deleted shelf is no longer the account's Shortlist.
        remoteIndex = -1
      }
    }

    let saved: ServerShelf
    if (remoteIndex === -1) {
      saved = await dispatch(
        serverApi.endpoints.createShelf.initiate(
          { serverUuid, name: snapshot.name, books: snapshot.bookUuids },
          { track: false },
        ),
      ).unwrap()
      remoteIndex = remoteShelves.length
      remoteShelves.push(saved)
    } else {
      saved = await dispatch(
        serverApi.endpoints.updateShelfBooks.initiate(
          {
            serverUuid,
            shelfUuid: remoteShelves[remoteIndex]!.uuid,
            books: snapshot.bookUuids,
          },
          { track: false },
        ),
      ).unwrap()
      remoteShelves[remoteIndex] = saved
    }
    await acknowledgeShelfPush(
      snapshot,
      cachedShelf(saved, serverUuid, remoteIndex),
    )
  }

  const pulled = await Promise.all(
    remoteShelves.map(async (remote, index) => {
      const shelf = cachedShelf(remote, serverUuid, index)
      if (shelf.kind === "smart") {
        const books = await dispatch(
          serverApi.endpoints.getShelfBooks.initiate(
            { serverUuid, shelfUuid: remote.uuid, limit: 50 },
            { subscribe: false, forceRefetch: true },
          ),
        ).unwrap()
        shelf.bookUuids = books.slice(0, 50).map((book) => book.uuid)
      }
      return shelf
    }),
  )
  // Re-read in the transaction: an edit made during the requests stays dirty
  // and cannot be overwritten by this older server snapshot.
  await applyShelfPull(serverUuid, pulled)
}

// Serialize per account, including first-use POSTs. An edit made while syncing
// queues one more pass; a failed pass leaves dirty rows for the next refresh.
const syncing = new Map<UUID, { again: boolean }>()

async function requestShelfSync(serverUuid: UUID, dispatch: AppDispatch) {
  const running = syncing.get(serverUuid)
  if (running) {
    running.again = true
    return
  }
  const run = { again: false }
  syncing.set(serverUuid, run)
  try {
    do {
      run.again = false
      try {
        await syncServerShelves(serverUuid, dispatch)
      } catch (error) {
        logger.debug(
          `Keeping cached shelves for ${serverUuid}: ${String(error)}`,
        )
      }
      dispatch(localApi.util.invalidateTags(["Shelves"]))
    } while (run.again)
  } finally {
    syncing.delete(serverUuid)
  }
}

startAppListening({
  matcher: isAnyOf(
    serverApi.endpoints.listBooks.matchFulfilled,
    localApi.endpoints.updateShortlist.matchFulfilled,
  ),
  effect: async (action, { dispatch }) => {
    // listBooks fulfillment is the refresh signal shared by Home, grids and
    // useListAllServerBooks. Shelf membership does not require imported books.
    if (serverApi.endpoints.listBooks.matchFulfilled(action)) {
      await requestShelfSync(action.meta.arg.originalArgs.serverUuid, dispatch)
    } else if (
      localApi.endpoints.updateShortlist.matchFulfilled(action) &&
      action.payload?.dirty === "true"
    ) {
      await requestShelfSync(action.meta.arg.originalArgs.serverUuid, dispatch)
    }
  },
})

startAppListening({
  matcher: localApi.endpoints.updateStatus.matchFulfilled,
  effect: async (action, { dispatch }) => {
    const { bookUuid, statusUuid } = action.meta.arg.originalArgs
    const status = await getStatus(statusUuid)
    if (status.name !== "Reading" && status.name !== "Read") return
    const preference = await getPreference("shortlist")
    if (!shouldRemoveFromShortlist(status.name, preference.removeWhen)) return
    const book = await getBook(bookUuid)
    if (!book?.serverUuid) return
    await dispatch(
      localApi.endpoints.updateShortlist.initiate(
        { bookUuid, serverUuid: book.serverUuid, change: "remove" },
        { track: false },
      ),
    ).unwrap()
  },
})

startAppListening({
  matcher: localApi.endpoints.deleteServer.matchFulfilled,
  effect: (_action, { dispatch }) => {
    // SQLite cascades the rows; subscribed Home/Shortlist views must drop them.
    dispatch(localApi.util.invalidateTags(["Shelves"]))
  },
})
