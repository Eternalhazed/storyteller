import assert from "node:assert/strict"
import { test } from "vitest"

import { getContinueReading } from "./continueReading"

const a = "10000000-0000-0000-0000-000000000000"
const b = "20000000-0000-0000-0000-000000000000"
const downloaded = { downloadStatus: "DOWNLOADED" }
const text = (timestamp: number, totalProgression: number) => ({
  timestamp,
  locator: {
    href: "chapter.xhtml",
    type: "application/xhtml+xml",
    locations: { totalProgression },
  },
})

const reading = {
  uuid: a,
  status: { name: "Reading" },
  position: text(10, 0.3),
  ebook: downloaded,
  readaloud: downloaded,
  audiobook: downloaded,
} as const

const listening = {
  ...reading,
  uuid: b,
  position: {
    timestamp: 20,
    locator: {
      href: "chapter.mp3",
      type: "audio/mpeg",
      locations: { totalProgression: 0.5 },
    },
  },
} as const

test("remembers which surface was used for a downloaded readaloud", () => {
  assert.deepEqual(
    getContinueReading([reading, listening], {
      bookUuid: a,
      mode: "listening",
      format: "readaloud",
    })?.session,
    { bookUuid: a, mode: "listening", format: "readaloud" },
  )
})

test("uses the newest unfinished offline progress when there is no remembered session", () => {
  assert.deepEqual(getContinueReading([listening, reading], null)?.session, {
    bookUuid: b,
    mode: "listening",
    format: "audiobook",
  })
})

test("does not substitute another format for a remembered format that was removed", () => {
  assert.equal(
    getContinueReading([{ ...reading, readaloud: null }, listening], {
      bookUuid: a,
      mode: "listening",
      format: "readaloud",
    })?.book.uuid,
    b,
  )
})

test("does not offer a finished book, an unstarted import, or a pending download", () => {
  assert.equal(
    getContinueReading(
      [
        { ...reading, status: { name: "Read" } },
        { ...reading, status: { name: "To read" }, position: text(50, 0) },
        {
          ...listening,
          audiobook: { downloadStatus: "DOWNLOADING" },
        },
      ],
      null,
    ),
    null,
  )
})
