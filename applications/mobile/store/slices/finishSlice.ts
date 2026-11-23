import { type PayloadAction, createSlice } from "@reduxjs/toolkit"

import { type UUID } from "@/uuid"

export type FinishPromptState =
  | { kind: "ask"; bookUuid: UUID; progress: number }
  | {
      kind: "undo"
      bookUuid: UUID
      progress: number
      previousStatusUuid: UUID
      expiresAt: number
    }

export type FinishState = {
  prompts: Record<string, FinishPromptState>
  dismissed: Record<string, number>
  dismissalsLoaded: boolean
}

const initialState: FinishState = {
  prompts: {},
  dismissed: {},
  dismissalsLoaded: false,
}

export const finishSlice = createSlice({
  name: "finish",
  initialState,
  reducers: {
    dismissalsLoaded(state, action: PayloadAction<Record<string, number>>) {
      state.dismissed = { ...action.payload, ...state.dismissed }
      state.dismissalsLoaded = true
    },
    promptShown(state, action: PayloadAction<FinishPromptState>) {
      state.prompts[action.payload.bookUuid] = action.payload
    },
    promptCleared(state, action: PayloadAction<{ bookUuid: UUID }>) {
      delete state.prompts[action.payload.bookUuid]
    },
    dismissalRecorded(
      state,
      action: PayloadAction<{ bookUuid: UUID; progress: number }>,
    ) {
      state.dismissed[action.payload.bookUuid] = action.payload.progress
    },
    promptDismissed(
      state,
      action: PayloadAction<{ bookUuid: UUID; progress: number }>,
    ) {
      state.dismissed[action.payload.bookUuid] = action.payload.progress
      delete state.prompts[action.payload.bookUuid]
    },
  },
})
