import { isAnyOf } from "@reduxjs/toolkit"

import { logger } from "@/logger"
import { Storyteller, getClip } from "@/modules/readium"
import { type ReadiumLocator } from "@/modules/readium/src/Readium.types"
import { passageSurfaceEntered, readerArrivalReported } from "@/store/actions"
import { localApi } from "@/store/localApi"
import {
  getCurrentlyPlayingBookUuid,
  getCurrentlyPlayingFormat,
} from "@/store/selectors/bookshelfSelectors"
import { bookshelfSlice } from "@/store/slices/bookshelfSlice"
import { type Passage, passageSlice } from "@/store/slices/passageSlice"

import { startAppListening } from "./listenerMiddleware"
import { getLocatorFromTrackPosition } from "./syncListeners"

const { actions: passage } = passageSlice

startAppListening({
  predicate: (_, state, previous) => {
    const move = state.passage.navigation?.move
    return (
      move?.state === "requested" &&
      move.id !== previous.passage.navigation?.move?.id
    )
  },
  effect: async (_, api) => {
    const nav = api.getState().passage.navigation
    const move = nav?.move
    if (!nav || !move) return
    const { id, purpose, target } = move
    const { bookUuid, format, surface } = nav.context
    const isCurrent = () => api.getState().passage.navigation?.move?.id === id
    const ownsPlayer = () =>
      getCurrentlyPlayingBookUuid(api.getState()) === bookUuid &&
      getCurrentlyPlayingFormat(api.getState()) === format
    const writePosition = (locator: ReadiumLocator, timestamp = Date.now()) =>
      api
        .dispatch(
          localApi.endpoints.updatePosition.initiate(
            { bookUuid, locator, timestamp },
            { track: false },
          ),
        )
        .unwrap()

    async function captureAudio() {
      const track = await Storyteller.getCurrentTrack()
      const seconds = await Storyteller.getPosition()
      if (
        !isCurrent() ||
        !ownsPlayer() ||
        !track ||
        track.bookUuid !== bookUuid ||
        !Number.isFinite(seconds)
      )
        return null
      return { track, point: { relativeUri: track.relativeUri, seconds } }
    }

    async function seekAudio({
      relativeUri,
      seconds,
    }: NonNullable<Passage["audio"]>) {
      if (!isCurrent() || !ownsPlayer()) throw new Error("Player changed")
      await Storyteller.seekTo(relativeUri, seconds, true)
      for (
        let attempt = 0;
        isCurrent() && ownsPlayer() && attempt < 12;
        attempt++
      ) {
        const sample = await captureAudio()
        if (
          sample?.point.relativeUri === relativeUri &&
          Math.abs(sample.point.seconds - seconds) < 0.5
        )
          return
        await api.delay(80)
      }
      throw new Error("Player did not reach the selected position")
    }

    try {
      if (!ownsPlayer()) throw new Error("Book changed")
      let anchor = nav.anchor
      if (
        format !== "ebook" &&
        (nav.preview || purpose === "return" || purpose === "leave")
      ) {
        await Storyteller.pause()
        if (!isCurrent() || !ownsPlayer()) return
      }
      if (
        format !== "ebook" &&
        !anchor.audio &&
        (move.openedPreview || (purpose === "chapter" && surface === "audio"))
      ) {
        const sample = await captureAudio()
        if (!sample && surface === "audio")
          throw new Error("Player position unavailable")
        if (sample) {
          const locator =
            surface === "audio"
              ? await getLocatorFromTrackPosition(
                  bookUuid,
                  format,
                  sample.track,
                  sample.point.seconds,
                )
              : anchor.locator
          if (!isCurrent() || !ownsPlayer()) return
          anchor = { locator: locator ?? anchor.locator, audio: sample.point }
          // The pause event cannot save while we hold the checkpoint.
          if (move.openedPreview && locator && surface === "audio")
            await writePosition(locator)
          if (!isCurrent() || !ownsPlayer()) return
          api.dispatch(passage.originCaptured({ id, origin: anchor }))
        }
      }
      if (purpose === "leave") {
        if (anchor.audio) await seekAudio(anchor.audio)
        if (isCurrent())
          api.dispatch(passage.moveCompleted({ id, viewport: anchor }))
        return
      }

      const book = await api
        .dispatch(
          localApi.endpoints.getBook.initiate(
            { uuid: bookUuid },
            { subscribe: false },
          ),
        )
        .unwrap()
      if (!isCurrent() || !ownsPlayer()) return
      if (!book?.position || book[format]?.downloadStatus !== "DOWNLOADED")
        throw new Error("Edition unavailable")

      let locator =
        purpose === "keep"
          ? book.position.locator
          : purpose === "return"
            ? anchor.locator
            : "locator" in target
              ? target.locator
              : null
      let audio =
        purpose === "return"
          ? anchor.audio
          : "audio" in target
            ? target.audio
            : undefined
      if (purpose === "continue" && surface === "audio") {
        const sample = await captureAudio()
        if (!sample) throw new Error("Player position unavailable")
        locator =
          (await getLocatorFromTrackPosition(
            bookUuid,
            format,
            sample.track,
            sample.point.seconds,
          )) ?? null
      }

      if (
        surface === "text" &&
        locator &&
        purpose !== "continue" &&
        purpose !== "keep"
      ) {
        let reached = false
        const arrival = api.condition((action) => {
          if (!readerArrivalReported.match(action) || action.payload.id !== id)
            return false
          reached = action.payload.arrived
          return true
        }, 12_000)
        api.dispatch(passage.displayRequested({ id, locator }))
        if (!(await arrival) || !reached)
          throw new Error("Reader did not reach the selected passage")
      }
      if (!isCurrent() || !ownsPlayer()) return

      if (
        format !== "ebook" &&
        purpose !== "keep" &&
        !(purpose === "continue" && surface === "audio") &&
        !(purpose === "reference" && surface === "text")
      ) {
        if (!audio && locator) {
          const positions =
            format === "readaloud"
              ? await api
                  .dispatch(
                    localApi.endpoints.getBookPositions.initiate(
                      { bookUuid, format },
                      { subscribe: false },
                    ),
                  )
                  .unwrap()
              : null
          const clip = await getClip(book, format, locator, positions)
          if (clip)
            audio = { relativeUri: clip.relativeUrl, seconds: clip.start }
        }
        if (audio) await seekAudio(audio)
        else if (surface === "audio")
          throw new Error("Passage has no audio position")
      }
      if (!locator && audio) {
        const { relativeUri, seconds } = audio
        const tracks = await Storyteller.getTracks()
        const track = tracks.find(
          (candidate) =>
            candidate.relativeUri === relativeUri &&
            candidate.bookUuid === bookUuid,
        )
        if (track)
          locator =
            (await getLocatorFromTrackPosition(
              bookUuid,
              format,
              track,
              seconds,
            )) ?? null
      }
      if (!isCurrent() || !ownsPlayer()) return
      if (!locator) throw new Error("Passage has no saved position")
      const latestRemote = api.getState().passage.navigation?.remote
      if (purpose !== "reference" && !(purpose === "return" && nav.preview)) {
        const timestamp =
          purpose === "remote"
            ? nav.remote?.timestamp
            : latestRemote
              ? Math.max(Date.now(), latestRemote.timestamp + 1)
              : undefined
        await writePosition(locator, timestamp)
      }
      if (isCurrent())
        api.dispatch(passage.moveCompleted({ id, viewport: { locator } }))
    } catch (error) {
      if (!isCurrent()) return
      logger.warn("Could not complete passage navigation", error)
      if (purpose === "leave") {
        // Reload the saved origin on next open rather than keep preview audio queued.
        if (ownsPlayer())
          api.dispatch(bookshelfSlice.actions.miniPlayerWidgetSwiped())
        api.dispatch(passage.reset())
      } else {
        api.dispatch(passage.moveFailed({ id }))
      }
    }
  },
})

startAppListening({
  actionCreator: passageSurfaceEntered,
  effect: (action, api) => {
    const nav = api.getState().passage.navigation
    const { bookUuid, format, surface } = action.payload
    if (
      nav?.context.bookUuid === bookUuid &&
      nav.context.format === format &&
      nav.context.surface !== surface &&
      nav.move?.purpose !== "leave"
    ) {
      api.dispatch(passage.command(nav.context, "leave"))
    }
  },
})

startAppListening({
  matcher: isAnyOf(
    bookshelfSlice.actions.bookOpened,
    bookshelfSlice.actions.playerAttached,
    bookshelfSlice.actions.bookDeleted,
  ),
  effect: (action, api) => {
    const nav = api.getState().passage.navigation
    if (!nav) return
    if (bookshelfSlice.actions.bookDeleted.match(action)) {
      if (nav.context.bookUuid === action.payload.bookUuid)
        api.dispatch(passage.reset())
    } else if (
      bookshelfSlice.actions.bookOpened.match(action) ||
      bookshelfSlice.actions.playerAttached.match(action)
    ) {
      if (
        nav.context.bookUuid !== action.payload.bookUuid ||
        nav.context.format !== action.payload.format
      ) {
        api.dispatch(passage.reset())
      }
    }
  },
})
