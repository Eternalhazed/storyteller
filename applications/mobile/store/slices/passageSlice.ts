import { type PayloadAction, createSlice, nanoid } from "@reduxjs/toolkit"

import { type ReadiumLocator } from "@/modules/readium/src/Readium.types"
import { type RemoteBookPosition, serverPositionUpdated } from "@/store/actions"
import { type UUID } from "@/uuid"

export type PassageContext = {
  bookUuid: UUID
  format: "ebook" | "readaloud" | "audiobook"
  surface: "text" | "audio"
}

type AudioPoint = { relativeUri: string; seconds: number }
export type Passage = { locator: ReadiumLocator; audio?: AudioPoint }
type Destination = { locator: ReadiumLocator } | { audio: AudioPoint }
type Purpose =
  | "reference"
  | "chapter"
  | "return"
  | "continue"
  | "remote"
  | "keep"
  | "leave"
type Command = Exclude<Purpose, "chapter" | "reference"> | "retry"
type Jump = PassageContext & {
  purpose: "reference" | "chapter"
  origin: ReadiumLocator
  target: Destination
}
type Move = {
  id: string
  purpose: Purpose
  target: Destination
  state: "requested" | "display" | "failed"
  openedPreview: boolean
}

type Navigation = {
  context: PassageContext
  anchor: Passage
  viewport: Passage
  preview: boolean
  move: Move | null
  remote?: RemoteBookPosition
}

type State = { navigation: Navigation | null }
const initialState: State = { navigation: null }

export function samePassageContext(a: PassageContext, b: PassageContext) {
  return (
    a.bookUuid === b.bookUuid &&
    a.format === b.format &&
    a.surface === b.surface
  )
}

function inContext(state: State, context: PassageContext) {
  const nav = state.navigation
  return nav && samePassageContext(nav.context, context) ? nav : null
}

export function isMoving(move: Move | null | undefined) {
  return !!move && move.state !== "failed"
}

export const passageSlice = createSlice({
  name: "passage",
  initialState,
  reducers: {
    jump: {
      prepare: (payload: Jump) => ({ payload: { ...payload, id: nanoid() } }),
      reducer(state, { payload }: PayloadAction<Jump & { id: string }>) {
        const previous = inContext(state, payload)
        if (isMoving(state.navigation?.move)) return
        const preview = previous?.preview || payload.purpose === "reference"
        const origin = { locator: payload.origin }
        const nav = previous?.preview
          ? previous
          : {
              context: {
                bookUuid: payload.bookUuid,
                format: payload.format,
                surface: payload.surface,
              },
              anchor: origin,
              viewport: origin,
              preview,
              ...(previous?.remote && { remote: previous.remote }),
              move: null,
            }
        nav.move = {
          id: payload.id,
          purpose: preview ? "reference" : "chapter",
          target: payload.target,
          state: "requested",
          openedPreview: preview && !previous?.preview,
        }
        state.navigation = nav
      },
    },
    command: {
      prepare: (context: PassageContext, command: Command) => ({
        payload: { context, command, id: nanoid() },
      }),
      reducer(
        state,
        {
          payload,
        }: PayloadAction<{
          context: PassageContext
          command: Command
          id: string
        }>,
      ) {
        const nav = inContext(state, payload.context)
        if (!nav) return
        const { command, id } = payload
        if (command === "leave") {
          if (nav.move?.purpose === "leave") return
          if (
            !nav.preview ||
            nav.context.surface === "text" ||
            !nav.anchor.audio
          ) {
            if (nav.remote) {
              if (nav.preview) nav.viewport = nav.anchor
              nav.preview = false
              nav.move = null
            } else {
              state.navigation = null
            }
            return
          }
          // Prevent pending position/seek events from committing the preview.
          nav.move = {
            id,
            purpose: "leave",
            target: nav.anchor,
            state: "requested",
            openedPreview: false,
          }
          return
        }
        if (isMoving(nav.move)) return
        if (command === "retry") {
          if (nav.move?.state === "failed")
            nav.move = { ...nav.move, id, state: "requested" }
          return
        }
        if (command === "continue" && (!nav.preview || nav.move)) return
        if (
          (command === "remote" || command === "keep") &&
          (nav.preview || !nav.remote)
        )
          return
        nav.move = {
          id,
          purpose: command,
          target:
            command === "return"
              ? nav.anchor
              : command === "remote" && nav.remote
                ? { locator: nav.remote.locator }
                : nav.viewport,
          state: "requested",
          openedPreview: false,
        }
      },
    },
    originCaptured(
      state,
      { payload }: PayloadAction<{ id: string; origin: Passage }>,
    ) {
      const nav = state.navigation
      if (nav?.move?.id !== payload.id) return
      nav.anchor = payload.origin
    },
    displayRequested(
      state,
      { payload }: PayloadAction<{ id: string; locator: ReadiumLocator }>,
    ) {
      const nav = state.navigation
      if (nav?.move?.id !== payload.id) return
      nav.move.state = "display"
      nav.move.target = { locator: payload.locator }
    },
    viewportChanged(
      state,
      {
        payload,
      }: PayloadAction<{ context: PassageContext; locator: ReadiumLocator }>,
    ) {
      const nav = inContext(state, payload.context)
      if (!nav?.preview || isMoving(nav.move)) return
      nav.viewport = { locator: payload.locator }
    },
    moveFailed(state, { payload }: PayloadAction<{ id: string }>) {
      const nav = state.navigation
      if (nav?.move?.id !== payload.id) return
      nav.move.state = "failed"
    },
    moveCompleted(
      state,
      { payload }: PayloadAction<{ id: string; viewport: Passage }>,
    ) {
      const nav = state.navigation
      if (nav?.move?.id !== payload.id) return
      const { purpose } = nav.move
      nav.viewport = payload.viewport
      nav.move = null
      if (purpose === "reference" || purpose === "chapter") return
      if ((purpose === "return" || purpose === "leave") && nav.remote) {
        nav.preview = false
        nav.anchor = payload.viewport
        return
      }
      state.navigation = null
    },
    reset(state) {
      state.navigation = null
    },
  },
  extraReducers: (builder) => {
    builder.addCase(serverPositionUpdated, (state, { payload }) => {
      const nav = state.navigation
      if (
        nav?.context.bookUuid !== payload.bookUuid ||
        (!nav.preview && !nav.remote && !isMoving(nav.move))
      )
        return
      if (!nav.remote || payload.timestamp >= nav.remote.timestamp)
        nav.remote = payload
    })
  },
})
