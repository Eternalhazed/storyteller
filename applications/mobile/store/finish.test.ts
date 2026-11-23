import assert from "node:assert/strict"
import { configureStore, createListenerMiddleware } from "@reduxjs/toolkit"
import { createApi } from "@reduxjs/toolkit/query"
import { test } from "vitest"

import { type ReadiumLocator } from "@/modules/readium/src/Readium.types"

import {
  canPromptAfterDismissal,
  getAudioRemainingSeconds,
  getProgress,
  looksFinished,
  shouldAutoStart,
  shouldFinish,
} from "./finish"
import { finishSlice } from "./slices/finishSlice"

const a = "10000000-0000-0000-0000-000000000000"
const b = "20000000-0000-0000-0000-000000000000"
const previousStatusUuid = "30000000-0000-0000-0000-000000000000"
const locator = (progress: number): ReadiumLocator => ({
  href: "chapter.xhtml",
  type: "application/xhtml+xml",
  locations: { totalProgression: progress },
})
const book = (progress: number, status = "Reading") => ({
  status: { name: status },
  position: { locator: locator(progress) },
})
const tracks = [
  { relativeUri: "part-1.mp3", duration: 3_600 },
  { relativeUri: "part-2.mp3", duration: 1_800 },
]
const audioLocator = (
  position: number,
  totalProgression = 0.8,
): ReadiumLocator => ({
  href: "part-2.mp3",
  type: "audio/mpeg",
  locations: { fragments: [`t=${position}`], totalProgression },
})

test("progress uses total progression and safely bounds missing or invalid values", () => {
  assert.equal(getProgress(locator(0.43)), 0.43)
  assert.equal(getProgress(undefined), 0)
  assert.equal(getProgress(null), 0)
  assert.equal(getProgress({ href: "chapter.xhtml", type: "text/html" }), 0)
  assert.equal(getProgress(locator(NaN)), 0)
  assert.equal(getProgress(locator(Infinity)), 0)
  assert.equal(getProgress(locator(-0.4)), 0)
  assert.equal(getProgress(locator(1.2)), 1)
  assert.equal(
    getProgress({ ...locator(0), locations: { progression: 0.98 } }),
    0,
  )
})

test("auto-start marks only To read books at or beyond two percent", () => {
  const preferences = { autoStartReading: true }
  assert.equal(shouldAutoStart(book(0.0199, "To read"), preferences), false)
  assert.equal(shouldAutoStart(book(0.02, "To read"), preferences), true)
  assert.equal(shouldAutoStart(book(0.8, "To read"), preferences), true)
  assert.equal(shouldAutoStart(book(0.8), preferences), false)
  assert.equal(shouldAutoStart(book(0.8, "Read"), preferences), false)
  assert.equal(shouldAutoStart({ status: null }, preferences), false)
  assert.equal(
    shouldAutoStart(book(0.8, "To read"), { autoStartReading: false }),
    false,
  )
})

test("finish respects each configured threshold and never re-finishes Read books", () => {
  for (const threshold of [0.9, 0.95, 0.98]) {
    assert.equal(shouldFinish(book(threshold - 0.001), threshold), false)
    assert.equal(shouldFinish(book(threshold), threshold), true)
    assert.equal(shouldFinish(book(1), threshold), true)
    assert.equal(shouldFinish(book(1, "Read"), threshold), false)
  }
  assert.equal(shouldFinish(book(0.95, "To read"), 0.95), true)
  assert.equal(shouldFinish({ status: { name: "Reading" } }, 0.95), false)
})

test("audiobook locators count the final ten minutes across the whole track list", () => {
  const audio = { tracks }
  const finalTenMinutes = {
    status: { name: "Reading" },
    position: { locator: audioLocator(1_200) },
  }
  assert.equal(getAudioRemainingSeconds(audioLocator(1_200), audio), 600)
  assert.equal(shouldFinish(finalTenMinutes, 0.95, audio), true)
  assert.equal(shouldFinish(finalTenMinutes, 0.95), false)
  assert.equal(
    shouldFinish(
      { ...finalTenMinutes, position: { locator: audioLocator(1_199) } },
      0.95,
      audio,
    ),
    false,
  )
  assert.equal(
    getAudioRemainingSeconds(
      { ...audioLocator(3_500), href: "part-1.mp3" },
      audio,
    ),
    1_900,
  )
  assert.equal(
    shouldFinish({ ...finalTenMinutes, status: { name: "Read" } }, 0.95, audio),
    false,
  )
})

test("audio locators can use track progression when the time fragment is absent", () => {
  const position: ReadiumLocator = {
    href: "part-2.mp3",
    type: "audio/mpeg",
    locations: { progression: 2 / 3 },
  }
  assert.equal(getAudioRemainingSeconds(position, { tracks }), 600)
})

test("readaloud audio uses the player position, not ebook progression as audio time", () => {
  const reading = book(0.82)
  const audio = { tracks, trackIndex: 1, position: 1_200 }
  assert.equal(getAudioRemainingSeconds(reading.position.locator, audio), 600)
  assert.equal(shouldFinish(reading, 0.95, audio), true)
  assert.equal(shouldFinish(reading, 0.95), false)
  assert.equal(
    shouldFinish(reading, 0.95, { ...audio, position: 1_199 }),
    false,
  )
})

test("incomplete or invalid audio metadata falls back to the progress threshold", () => {
  const invalidAudio = [
    { tracks: [] },
    { tracks: [{ relativeUri: "part-2.mp3", duration: 0 }] },
    { tracks: [{ relativeUri: "part-2.mp3", duration: NaN }] },
    { tracks, trackIndex: 9, position: 1_700 },
    { tracks, trackIndex: 1, position: -1 },
    { tracks, trackIndex: 1, position: 1_900 },
    { tracks, trackIndex: 1, position: Infinity },
    { tracks, trackIndex: 0.5, position: 1_700 },
    { tracks },
  ]
  for (const audio of invalidAudio) {
    assert.equal(shouldFinish(book(0.82), 0.95, audio), false)
    assert.equal(shouldFinish(book(0.96), 0.95, audio), true)
  }
  assert.equal(
    getAudioRemainingSeconds(
      { ...audioLocator(1_700), href: "unknown.mp3" },
      { tracks },
    ),
    null,
  )
  assert.equal(getAudioRemainingSeconds(audioLocator(1_900), { tracks }), null)
  assert.equal(getAudioRemainingSeconds(audioLocator(-1), { tracks }), null)
  assert.equal(
    getAudioRemainingSeconds(
      { href: "part-2.mp3", type: "audio/mpeg" },
      { tracks },
    ),
    null,
  )
})

test("Not yet lasts until progress grows by a full percentage point", () => {
  assert.equal(canPromptAfterDismissal(0.95, undefined), true)
  assert.equal(canPromptAfterDismissal(0.95, 0.95), false)
  assert.equal(canPromptAfterDismissal(0.8, 0.95), false)
  assert.equal(canPromptAfterDismissal(0.9599, 0.95), false)
  assert.equal(canPromptAfterDismissal(0.96, 0.95), true)
  assert.equal(canPromptAfterDismissal(0.97, 0.95), true)
  assert.equal(canPromptAfterDismissal(0.99, 0.98), true)
  assert.equal(canPromptAfterDismissal(1, 1), false)
})

test("the cleanup selects only Reading books at 90 percent without mutating the list", () => {
  const almostFinished = { ...book(0.9), uuid: a }
  const completed = { ...book(0.99), uuid: b }
  const books = [
    book(0.899),
    almostFinished,
    completed,
    book(1, "Read"),
    book(0.98, "To read"),
    { status: null },
  ]
  assert.deepEqual(looksFinished(books, 0.9), [almostFinished, completed])
  assert.deepEqual(looksFinished(books, 0.98), [completed])
  assert.equal(books.length, 6)
  assert.deepEqual(looksFinished([]), [])
})

test("finish state keeps dismissals through hydration and clears only the target prompt", () => {
  const { actions, reducer } = finishSlice
  let state = reducer(
    undefined,
    actions.promptShown({ kind: "ask", bookUuid: a, progress: 0.96 }),
  )
  state = reducer(state, actions.promptCleared({ bookUuid: b }))
  assert.equal(state.prompts[a]?.bookUuid, a)
  state = reducer(
    state,
    actions.promptDismissed({ bookUuid: a, progress: 0.96 }),
  )
  assert.equal(state.prompts[a], undefined)
  state = reducer(state, actions.dismissalsLoaded({ [a]: 0.95, [b]: 0.91 }))
  assert.deepEqual(state.dismissed, { [a]: 0.96, [b]: 0.91 })
  assert.equal(state.dismissalsLoaded, true)
})

test("recording an Undo dismissal preserves the original status and undo prompt", () => {
  const { actions, reducer } = finishSlice
  const prompt = {
    kind: "undo",
    bookUuid: a,
    progress: 0.95,
    previousStatusUuid,
    expiresAt: 8_000,
  } as const
  let state = reducer(undefined, actions.promptShown(prompt))
  state = reducer(
    state,
    actions.dismissalRecorded({ bookUuid: a, progress: 0.96 }),
  )
  assert.deepEqual(state.prompts[a], prompt)
  assert.equal(state.dismissed[a], 0.96)
})

test("RTK updatePosition matchFulfilled still fires when initiated with track false", async () => {
  const api = createApi({
    baseQuery: () => ({ data: null }),
    endpoints: (build) => ({
      updatePosition: build.mutation<null, void>({
        queryFn: () => ({ data: null }),
      }),
    }),
  })
  const listener = createListenerMiddleware()
  let fulfilled = false
  listener.startListening({
    matcher: api.endpoints.updatePosition.matchFulfilled,
    effect: () => {
      fulfilled = true
    },
  })
  const store = configureStore({
    reducer: { [api.reducerPath]: api.reducer },
    middleware: (getDefault) =>
      getDefault().concat(api.middleware, listener.middleware),
  })
  await store
    .dispatch(
      api.endpoints.updatePosition.initiate(undefined, { track: false }),
    )
    .unwrap()
  assert.equal(fulfilled, true)
  assert.deepEqual(store.getState()[api.reducerPath]!.mutations, {})
  store.dispatch(api.util.resetApiState())
})

test("finish prompts for different books do not overwrite each other", () => {
  const { actions, reducer } = finishSlice
  let state = reducer(
    undefined,
    actions.promptShown({ kind: "ask", bookUuid: a, progress: 0.95 }),
  )
  state = reducer(
    state,
    actions.promptShown({ kind: "ask", bookUuid: b, progress: 0.98 }),
  )
  assert.equal(state.prompts[a]?.progress, 0.95)
  assert.equal(state.prompts[b]?.progress, 0.98)
  state = reducer(state, actions.promptCleared({ bookUuid: a }))
  assert.equal(state.prompts[a], undefined)
  assert.equal(state.prompts[b]?.progress, 0.98)
})
