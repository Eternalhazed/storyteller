import { configureStore } from "@reduxjs/toolkit"
import { afterEach, expect, test, vi } from "vitest"

import { type ReadiumLocator } from "@/modules/readium/src/Readium.types"
import {
  bookLocatorChanged,
  playerClipChanged,
  readerArrivalReported,
  serverPositionUpdated,
} from "@/store/actions"
import { bookshelfSlice } from "@/store/slices/bookshelfSlice"
import { type PassageContext, passageSlice } from "@/store/slices/passageSlice"
import { type UUID } from "@/uuid"

import "./passageListener"
import { listenerMiddleware } from "./listenerMiddleware"

const db = vi.hoisted(() => ({
  getBook: vi.fn(),
  updatePosition: vi.fn(),
}))
const playback = vi.hoisted(() => ({
  getCurrentTrack: vi.fn(),
  getPosition: vi.fn(),
  pause: vi.fn(),
  play: vi.fn(),
  seekTo: vi.fn(),
  getClip: vi.fn(),
  getFragment: vi.fn(),
}))

vi.mock("@sentry/react-native", () => ({ captureException: vi.fn() }))
vi.mock("@/logger", () => ({ logger: { debug: vi.fn(), warn: vi.fn() } }))
vi.mock("@/modules/readium", () => ({
  Storyteller: playback,
  getClip: playback.getClip,
  getFragment: playback.getFragment,
}))
vi.mock("@/store/localApi", () => ({
  localApi: {
    endpoints: {
      deleteBook: { matchFulfilled: () => false },
      getBook: { initiate: () => () => ({ unwrap: db.getBook }) },
      getBookPositions: { initiate: () => () => ({ unwrap: async () => [] }) },
      updatePosition: {
        initiate: (position: unknown) => () => ({
          unwrap: () => db.updatePosition(position),
        }),
      },
    },
  },
}))

const bookUuid = "105956c0-9874-4769-b969-a53609151fa3" as UUID
const context: PassageContext = { bookUuid, format: "ebook", surface: "text" }
const { actions } = passageSlice
const chapter = (number: number): ReadiumLocator => ({
  href: `chapter${number}.xhtml`,
  type: "application/xhtml+xml",
})

function openBook(format: PassageContext["format"] = "ebook") {
  db.getBook.mockResolvedValue({
    position: { locator: chapter(19), timestamp: 1 },
    [format]: { downloadStatus: "DOWNLOADED" },
  })
  db.updatePosition.mockResolvedValue(null)
  const store = configureStore({
    reducer: {
      bookshelf: bookshelfSlice.reducer,
      passage: passageSlice.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().prepend(listenerMiddleware.middleware),
  })
  store.dispatch(bookshelfSlice.actions.bookOpened({ bookUuid, format }))
  return store
}

afterEach(() => vi.resetAllMocks())

test("no saved progress changes on a reference, a preview page turn, a remote update, or Return", async () => {
  const store = openBook()
  const jump = actions.jump({
    ...context,
    purpose: "reference",
    origin: chapter(19),
    target: { locator: chapter(8) },
  })
  store.dispatch(jump)
  await vi.waitFor(() =>
    expect(store.getState().passage.navigation?.move?.state).toBe("display"),
  )
  store.dispatch(readerArrivalReported({ id: jump.payload.id, arrived: true }))
  await vi.waitFor(() =>
    expect(store.getState().passage.navigation?.move).toBeNull(),
  )

  store.dispatch(
    bookLocatorChanged({ bookUuid, locator: chapter(9), timestamp: 2 }),
  )
  store.dispatch(
    serverPositionUpdated({ bookUuid, locator: chapter(22), timestamp: 3 }),
  )
  expect(store.getState().passage.navigation?.viewport.locator).toEqual(
    chapter(9),
  )
  expect(db.updatePosition).not.toHaveBeenCalled()

  const back = actions.command(context, "return")
  store.dispatch(back)
  await vi.waitFor(() =>
    expect(store.getState().passage.navigation?.move).toMatchObject({
      state: "display",
      target: { locator: chapter(19) },
    }),
  )
  store.dispatch(readerArrivalReported({ id: back.payload.id, arrived: true }))
  await vi.waitFor(() =>
    expect(store.getState().passage.navigation?.preview).toBe(false),
  )
  expect(db.updatePosition).not.toHaveBeenCalled()
  expect(store.getState().passage.navigation?.remote?.locator).toEqual(
    chapter(22),
  )
})

test("a failed chapter target writes nothing; retry saves only after the reader confirms", async () => {
  const store = openBook()
  const jump = actions.jump({
    ...context,
    purpose: "chapter",
    origin: chapter(19),
    target: { locator: chapter(25) },
  })
  store.dispatch(jump)
  await vi.waitFor(() =>
    expect(store.getState().passage.navigation?.move?.state).toBe("display"),
  )
  store.dispatch(readerArrivalReported({ id: jump.payload.id, arrived: false }))
  await vi.waitFor(() =>
    expect(store.getState().passage.navigation?.move?.state).toBe("failed"),
  )
  expect(db.updatePosition).not.toHaveBeenCalled()

  const retry = actions.command(context, "retry")
  store.dispatch(retry)
  await vi.waitFor(() =>
    expect(store.getState().passage.navigation?.move?.state).toBe("display"),
  )
  expect(db.updatePosition).not.toHaveBeenCalled()
  store.dispatch(readerArrivalReported({ id: retry.payload.id, arrived: true }))
  await vi.waitFor(() =>
    expect(db.updatePosition).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ bookUuid, locator: chapter(25) }),
    ),
  )
  expect(store.getState().passage.navigation?.anchor.locator).toEqual(
    chapter(19),
  )
})

test("Continue here saves the preview page that the reader reached after the jump", async () => {
  const store = openBook()
  const jump = actions.jump({
    ...context,
    purpose: "reference",
    origin: chapter(19),
    target: { locator: chapter(8) },
  })
  store.dispatch(jump)
  await vi.waitFor(() =>
    expect(store.getState().passage.navigation?.move?.state).toBe("display"),
  )
  store.dispatch(readerArrivalReported({ id: jump.payload.id, arrived: true }))
  await vi.waitFor(() =>
    expect(store.getState().passage.navigation?.move).toBeNull(),
  )
  store.dispatch(
    bookLocatorChanged({ bookUuid, locator: chapter(9), timestamp: 2 }),
  )
  store.dispatch(actions.command(context, "continue"))
  await vi.waitFor(() => expect(store.getState().passage.navigation).toBeNull())
  expect(db.updatePosition).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ bookUuid, locator: chapter(9) }),
  )
})

test("listening pauses during a preview and returns to the original audio tick", async () => {
  const store = openBook("readaloud")
  const player: PassageContext = {
    bookUuid,
    format: "readaloud",
    surface: "audio",
  }
  const relativeUri = "audio.m4b"
  let time = 174.267
  playback.getCurrentTrack.mockResolvedValue({ bookUuid, relativeUri })
  playback.getPosition.mockImplementation(async () => time)
  playback.pause.mockResolvedValue(undefined)
  playback.getFragment.mockResolvedValue({ locator: chapter(19) })
  playback.getClip.mockResolvedValue({ relativeUrl: relativeUri, start: 16 })
  playback.seekTo.mockImplementation(
    async (_track: string, position: number) => {
      time = position
    },
  )

  const reference = actions.jump({
    ...player,
    purpose: "reference",
    origin: chapter(19),
    target: { locator: chapter(8) },
  })
  store.dispatch(reference)
  await vi.waitFor(() =>
    expect(store.getState().passage.navigation?.move).toBeNull(),
  )
  expect(playback.pause).toHaveBeenCalled()
  expect(playback.seekTo).toHaveBeenLastCalledWith(relativeUri, 16, true)

  store.dispatch(
    playerClipChanged({
      clip: {
        locator: chapter(8),
        relativeUrl: relativeUri,
        fragmentId: "ref-s8",
        start: 16,
        end: 18,
        duration: 2,
      },
    }),
  )
  store.dispatch(actions.command(player, "return"))
  await vi.waitFor(() => expect(store.getState().passage.navigation).toBeNull())
  expect(playback.seekTo).toHaveBeenLastCalledWith(relativeUri, 174.267, true)
  expect(playback.play).not.toHaveBeenCalled()
  expect(db.updatePosition).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ bookUuid, locator: chapter(19) }),
  )
})
