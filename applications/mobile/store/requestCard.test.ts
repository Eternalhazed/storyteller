import {
  type FormatView,
  type RequestView,
} from "@storyteller/web/src/requests/http"
import { describe, expect, test } from "vitest"

import { getRequestCard } from "./requestCard"

const format = (status: FormatView["status"], progress = 0): FormatView => ({
  status,
  progress,
  release: null,
  error: null,
})

function card(
  ebook: FormatView,
  audio: FormatView,
  {
    status = "none",
    progress = 0,
    stage = null,
    complete = false,
  }: Partial<RequestView["sync"]> & { complete?: boolean } = {},
) {
  return getRequestCard({
    work: { title: "Book title", authors: [] },
    ebook,
    audio,
    sync: { status, progress, stage },
    complete,
  })
}

const ready = format("ready", 1)
const none = format("none")

describe("request card", () => {
  test("combines two downloads into one percentage", () => {
    expect(
      card(format("downloading", 0.34), format("downloading", 0.46)),
    ).toEqual({
      title: "Getting Book title",
      primary: null,
      status: "40%",
      pick: [],
      retrySync: false,
      dismissOnOpen: false,
    })
  })

  test("opens the ebook while narration downloads", () => {
    expect(card(ready, format("downloading", 0.62))).toMatchObject({
      primary: "Read ebook now",
      status: "Audiobook 62%",
      dismissOnOpen: false,
    })
  })

  test("opens the audiobook while the ebook downloads", () => {
    expect(card(format("downloading", 0.3), ready)).toMatchObject({
      primary: "Listen now",
      status: "Ebook 30%",
      dismissOnOpen: false,
    })
  })

  test("keeps the ebook usable while narration sync is queued or syncing", () => {
    for (const status of ["queued", "syncing"] as const) {
      expect(card(ready, ready, { status })).toMatchObject({
        primary: "Read ebook now",
        status: "Syncing narration",
        dismissOnOpen: false,
      })
    }
    expect(
      card(ready, ready, { status: "syncing", progress: 0.28, stage: "align" })
        .status,
    ).toBe("Syncing narration 28%")
    expect(
      card(ready, ready, { status: "syncing", stage: "align" }).status,
    ).toBe("Syncing narration 0%")
  })

  test("opens the finished read-along and dismisses the Home card on open", () => {
    expect(
      card(ready, ready, { status: "done", complete: true }),
    ).toMatchObject({
      primary: "Open read-along",
      status: "",
      dismissOnOpen: true,
    })
  })

  test("keeps the ebook usable and allows replacing a stalled audiobook", () => {
    expect(card(ready, format("stalled"))).toMatchObject({
      primary: "Read ebook now",
      status: "Audiobook stalled",
      pick: ["audio"],
    })
  })

  test("keeps the ebook usable and allows retrying a failed sync", () => {
    expect(card(ready, ready, { status: "failed" })).toMatchObject({
      primary: "Read ebook now",
      status: "Narration sync failed",
      retrySync: true,
      dismissOnOpen: false,
    })
  })

  test("offers the picker for only the formats needing attention", () => {
    expect(card(format("choosing"), format("failed"))).toMatchObject({
      primary: null,
      status: "Ebook needs your pick · Audiobook failed",
      pick: ["ebook", "audio"],
    })
    expect(card(ready, format("failed")).primary).toBe("Read ebook now")
  })

  test("reports imports and ignores the unrequested format", () => {
    expect(card(format("importing"), none)).toMatchObject({
      primary: null,
      status: "Adding to your library: ebook",
      pick: [],
    })
    expect(card(none, format("downloading", 0.5)).status).toBe("Audiobook 50%")
    expect(card(ready, none, { complete: true })).toMatchObject({
      primary: "Read ebook now",
      status: "",
      dismissOnOpen: true,
    })
    expect(card(none, ready, { complete: true })).toMatchObject({
      primary: "Listen now",
      status: "",
      dismissOnOpen: true,
    })
  })

  test("does not dismiss an add-format request that is waiting for sync", () => {
    expect(card(none, ready, { status: "queued" })).toMatchObject({
      primary: "Listen now",
      status: "Syncing narration",
      dismissOnOpen: false,
    })
  })

  test("reports paused narration without offering failed-sync retry", () => {
    expect(card(ready, ready, { status: "paused" })).toMatchObject({
      primary: "Read ebook now",
      status: "Narration sync paused",
      retrySync: false,
    })
  })
})
