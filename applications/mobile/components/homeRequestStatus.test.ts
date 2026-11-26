import { type RequestView } from "@storyteller/web/src/requests/http"
import { expect, test } from "vitest"

import { homeRequestStatus } from "./homeRequestStatus"

function format(status: RequestView["ebook"]["status"], progress = 0) {
  return { status, progress, release: null, error: null }
}

const noSync = { status: "none", progress: 0, stage: null } as const

test("shows only the active downloads in the combined progress", () => {
  const ebook = format("downloading", 0.24)
  const audio = format("downloading", 0.6)
  expect(homeRequestStatus({ ebook, audio, sync: noSync })).toEqual({
    label: "Downloading 42%",
    percent: 42,
  })
  expect(
    homeRequestStatus({ ebook: format("ready", 1), audio, sync: noSync }),
  ).toEqual({ label: "Downloading 60%", percent: 60 })
})

test("distinguishes importing from a queued or active narration sync", () => {
  const ebook = format("ready", 1)
  const audio = format("ready", 1)
  expect(
    homeRequestStatus({ ebook, audio: format("importing", 1), sync: noSync }),
  ).toEqual({ label: "Adding to your library" })
  expect(
    homeRequestStatus({ ebook, audio, sync: { ...noSync, status: "queued" } }),
  ).toEqual({ label: "Syncing narration" })
  expect(
    homeRequestStatus({
      ebook,
      audio,
      sync: { status: "syncing", progress: 0.35, stage: "TRANSCRIBE" },
    }),
  ).toEqual({ label: "Syncing narration 35%", percent: 35 })
})

test("distinguishes which requested format is ready", () => {
  const ebook = format("ready", 1)
  const audio = format("ready", 1)
  expect(
    homeRequestStatus({ ebook, audio: format("none"), sync: noSync }),
  ).toEqual({
    label: "Ready to read",
  })
  expect(
    homeRequestStatus({ ebook: format("none"), audio, sync: noSync }),
  ).toEqual({
    label: "Ready to listen",
  })
  expect(
    homeRequestStatus({ ebook, audio, sync: { ...noSync, status: "done" } }),
  ).toEqual({ label: "Read-along ready" })
})
