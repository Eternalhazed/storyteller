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

test("does not offer a finished book or an unstarted import", () => {
  assert.equal(
    getContinueReading(
      [
        { ...reading, status: { name: "Read" } },
        { ...reading, status: { name: "To read" }, position: text(50, 0) },
      ],
      null,
    ),
    null,
  )
})

test("offers progress made on another device, flagged for download", () => {
  const elsewhere = {
    ...reading,
    ebook: { downloadStatus: "NONE" },
    readaloud: { downloadStatus: "NONE" },
    audiobook: { downloadStatus: "NONE" },
  }
  assert.deepEqual(getContinueReading([elsewhere], null), {
    book: elsewhere,
    session: { bookUuid: a, mode: "reading", format: "readaloud" },
    needsDownload: true,
  })
})

test("prefers a downloaded format over one that still needs downloading", () => {
  const ebookOnly = { ...reading, readaloud: { downloadStatus: "NONE" } }
  const result = getContinueReading([ebookOnly], null)
  assert.equal(result?.session.format, "ebook")
  assert.equal(result?.needsDownload, false)
})

test("keeps a remembered format that was removed from this device, for download", () => {
  const removed = { ...reading, readaloud: { downloadStatus: "NONE" } }
  const result = getContinueReading([removed], {
    bookUuid: a,
    mode: "listening",
    format: "readaloud",
  })
  assert.equal(result?.session.format, "readaloud")
  assert.equal(result?.needsDownload, true)
})
