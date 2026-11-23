import { type PayloadAction, createSlice } from "@reduxjs/toolkit"

import type {
  BookDownloadActivity,
  DownloadTarget,
} from "@/store/downloadLifecycle"

export const BOOK_IMPORT_STAGES = [
  "copying",
  "extracting",
  "parsing",
  "saving",
] as const

export type BookImportStage = (typeof BOOK_IMPORT_STAGES)[number]

export type TransferFeedbackState = {
  importStage: BookImportStage | null
  failure: string | null
  download: BookDownloadActivity | null
}

const initialState: TransferFeedbackState = {
  importStage: null,
  failure: null,
  download: null,
}

export const transferFeedbackSlice = createSlice({
  name: "transferFeedback",
  initialState,
  reducers: {
    bookDownloadChanged(state, action: PayloadAction<BookDownloadActivity>) {
      state.download = action.payload
    },
    bookDownloadSettled(state, action: PayloadAction<DownloadTarget>) {
      if (
        state.download?.bookUuid === action.payload.bookUuid &&
        state.download.format === action.payload.format
      ) {
        state.download = null
      }
    },
    bookImportStageChanged(state, action: PayloadAction<BookImportStage>) {
      state.importStage = action.payload
    },
    bookImportSettled(state) {
      state.importStage = null
    },
    bookTransferFailed(state, action: PayloadAction<string>) {
      state.failure = action.payload
    },
    bookTransferFailureDismissed(state) {
      state.failure = null
    },
  },
})
