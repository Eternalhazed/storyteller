import { createAction } from "@reduxjs/toolkit"

import {
  type ReadiumClip,
  type ReadiumLocator,
} from "@/modules/readium/src/Readium.types"
import { type UUID } from "@/uuid"

export const bookImported = createAction(
  "bookImported",
  (payload: { url: string; from: "home" | "open-with" }) => ({ payload }),
)

export const bookDoubleTapped = createAction(
  "bookDoubleTapped",
  (payload: {
    bookUuid: UUID
    locator: ReadiumLocator
    timestamp: number
  }) => ({
    payload,
  }),
)

export const bookDetailPressed = createAction(
  "bookDetailPressed",
  (payload: {
    bookUuid: UUID
    format: "audiobook" | "ebook" | "readaloud"
  }) => ({
    payload,
  }),
)

export const bookLocatorChanged = createAction(
  "bookLocatorChanged",
  (payload: {
    bookUuid: UUID
    locator: ReadiumLocator
    timestamp: number
  }) => ({
    payload,
  }),
)

export const miniPlayerSliderChapterPositionChanged = createAction(
  "miniPlayerSliderChapterPositionChanged",
  (payload: {
    bookUuid: UUID
    locator: ReadiumLocator
    timestamp: number
  }) => ({
    payload,
  }),
)

export type RemoteBookPosition = {
  bookUuid: UUID
  locator: ReadiumLocator
  timestamp: number
}

export const serverPositionUpdated = createAction(
  "serverPositionUpdated",
  (payload: RemoteBookPosition) => ({ payload }),
)

export const readerArrivalReported = createAction<{
  id: string
  arrived: boolean
}>("readerArrivalReported")

export const passageSurfaceEntered = createAction<{
  bookUuid: UUID
  format: "ebook" | "readaloud" | "audiobook"
  surface: "text" | "audio"
}>("passageSurfaceEntered")

export const playerPositionUpdated = createAction("playerPositionUpdated")

export const playerPositionSeeked = createAction(
  "playerPositionSeeked",
  (payload: { progress: number }) => ({
    payload,
  }),
)

export const playerTotalPositionSeeked = createAction(
  "playerTotalPositionSeeked",
  (payload: { progress: number }) => ({
    payload,
  }),
)

export const playerTrackChanged = createAction(
  "playerTrackChanged",
  (payload: { relativeUri: string; position?: number }) => ({
    payload,
  }),
)

export const playerClipChanged = createAction(
  "playerClipChanged",
  (payload: { clip: ReadiumClip }) => ({
    payload,
  }),
)

export const nextTrackPressed = createAction("nextTrackPressed")

export const prevTrackPressed = createAction("prevTrackPressed")

export const nextFragmentPressed = createAction("nextFragmentPressed")

export const previousFragmentPressed = createAction("previousFragmentPressed")
