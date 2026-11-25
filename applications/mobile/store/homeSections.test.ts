import assert from "node:assert/strict"
import { test } from "vitest"

import { type UUID } from "@/uuid"

import { type HomeBook, buildHomeSections, resolveOrder } from "./homeSections"

const DAY = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 10, 23)

let next = 0
function book(
  overrides: Partial<HomeBook> & {
    progress?: number
    openedDaysAgo?: number
  } = {},
): HomeBook {
  const { progress, openedDaysAgo, ...rest } = overrides
  next += 1
  return {
    uuid: `00000000-0000-0000-0000-${String(next).padStart(12, "0")}` as UUID,
    title: `Book ${next}`,
    createdAt: new Date(now - next * DAY).toISOString(),
    alignedAt: null,
    status: { name: "To read" },
    position:
      progress === undefined
        ? null
        : {
            timestamp: now - (openedDaysAgo ?? 0) * DAY,
            locator: { locations: { totalProgression: progress } },
          },
    series: [],
    collections: [],
    readaloud: null,
    ...rest,
  }
}

const defaults = {
  now,
  continueBookUuid: null,
  shortlist: [],
  seriesNext: [],
  seriesStarts: [],
  shelves: [],
  collections: [],
  order: [
    "continue",
    "jumpBackIn",
    "shortlist",
    "nextInSeries",
    "nearlyDone",
    "startSeries",
    "newReadalouds",
    "toRead",
    "recentlyAdded",
    "magazines",
    "collections",
    "paused",
  ],
  hidden: [],
  dedupe: true,
}

function section(
  sections: ReturnType<typeof buildHomeSections<HomeBook>>,
  id: string,
) {
  return (
    sections.find((s) => s.id === id)?.items.map(({ book }) => book.title) ?? []
  )
}

test("shows each suggested book once, in the first section that claims it", () => {
  const current = book({
    status: { name: "Reading" },
    progress: 0.4,
    openedDaysAgo: 0,
  })
  const other = book({
    status: { name: "Reading" },
    progress: 0.2,
    openedDaysAgo: 3,
  })
  const flagged = book()
  const sections = buildHomeSections({
    ...defaults,
    books: [current, other, flagged],
    continueBookUuid: current.uuid,
    shortlist: [flagged.uuid],
  })
  assert.deepEqual(section(sections, "continue"), [current.title])
  assert.deepEqual(section(sections, "jumpBackIn"), [other.title])
  assert.deepEqual(section(sections, "shortlist"), [flagged.title])
  assert.deepEqual(section(sections, "recentlyAdded"), [])
})

test("jump back in holds recently opened books; older ones are paused", () => {
  const recent = book({
    status: { name: "Reading" },
    progress: 0.1,
    openedDaysAgo: 13,
  })
  const stale = book({
    status: { name: "Reading" },
    progress: 0.3,
    openedDaysAgo: 90,
  })
  const sections = buildHomeSections({ ...defaults, books: [recent, stale] })
  assert.deepEqual(section(sections, "jumpBackIn"), [recent.title])
  assert.deepEqual(section(sections, "paused"), [stale.title])
})

test("nearly done lists half-read books left alone for a while, furthest first", () => {
  const far = book({
    status: { name: "Reading" },
    progress: 0.86,
    openedDaysAgo: 70,
  })
  const half = book({
    status: { name: "Reading" },
    progress: 0.55,
    openedDaysAgo: 20,
  })
  const fresh = book({
    status: { name: "Reading" },
    progress: 0.9,
    openedDaysAgo: 2,
  })
  const sections = buildHomeSections({ ...defaults, books: [half, far, fresh] })
  assert.deepEqual(section(sections, "nearlyDone"), [far.title, half.title])
  const reason = sections.find((s) => s.id === "nearlyDone")?.items[0]?.reason
  assert.equal(reason, "86% · last opened 2 months ago")
})

test("to read leaves series books to the series sections", () => {
  const standalone = book()
  const inSeries = book({ series: [{ uuid: "s", position: 7 }] })
  const sections = buildHomeSections({
    ...defaults,
    books: [standalone, inSeries],
  })
  assert.deepEqual(section(sections, "toRead"), [standalone.title])
})

test("new read-alongs are recently synced books not yet started", () => {
  const ready = book({
    readaloud: { status: "ALIGNED" },
    alignedAt: new Date(now - 3 * DAY).toISOString(),
  })
  const old = book({
    readaloud: { status: "ALIGNED" },
    alignedAt: new Date(now - 45 * DAY).toISOString(),
  })
  const started = book({
    readaloud: { status: "ALIGNED" },
    alignedAt: new Date(now - DAY).toISOString(),
    progress: 0.2,
  })
  const sections = buildHomeSections({
    ...defaults,
    dedupe: false,
    books: [ready, old, started],
  })
  assert.deepEqual(section(sections, "newReadalouds"), [ready.title])
  assert.equal(
    sections.find((s) => s.id === "newReadalouds")?.items[0]?.reason,
    "Ready 3 days ago",
  )
})

test("magazines stay off the reading sections and get their own row", () => {
  const magazines = { uuid: "m", name: "Magazines" }
  const issue = book({
    collections: [magazines],
    status: { name: "Reading" },
    progress: 0.3,
  })
  const sections = buildHomeSections({
    ...defaults,
    books: [issue],
    collections: [magazines],
  })
  assert.deepEqual(section(sections, "jumpBackIn"), [])
  assert.deepEqual(section(sections, "recentlyAdded"), [])
  assert.deepEqual(section(sections, "collection:m"), [issue.title])
})

test("hidden sections are left out and collections are hidden unless enabled", () => {
  const mine = { uuid: "c", name: "David" }
  const owned = book({ collections: [mine] })
  const sections = buildHomeSections({
    ...defaults,
    books: [owned],
    collections: [mine],
    hidden: ["collections", "recentlyAdded"],
  })
  assert.equal(
    sections.some((s) => s.id === "collection:c"),
    false,
  )
  assert.equal(
    sections.some((s) => s.id === "recentlyAdded"),
    false,
  )
})

test("a shelf made on the web lands before To read until the reader moves it", () => {
  assert.deepEqual(
    resolveOrder(
      ["continue", "toRead", "recentlyAdded"],
      ["continue", "toRead", "recentlyAdded", "shelf:x"],
    ),
    ["continue", "shelf:x", "toRead", "recentlyAdded"],
  )
  assert.deepEqual(
    resolveOrder(["recentlyAdded", "gone"], ["continue", "recentlyAdded"]),
    ["recentlyAdded", "continue"],
  )
})

test("For you follows Next in your series in saved orders unless moved", () => {
  const available = ["continue", "nextInSeries", "forYou", "toRead"]
  assert.deepEqual(
    resolveOrder(["toRead", "nextInSeries", "continue"], available),
    ["toRead", "nextInSeries", "forYou", "continue"],
  )
  assert.deepEqual(
    resolveOrder(["forYou", "nextInSeries", "toRead", "continue"], available),
    ["forYou", "nextInSeries", "toRead", "continue"],
  )
  assert.deepEqual(resolveOrder([], available), available)
  assert.deepEqual(resolveOrder(["continue", "toRead"], available), [
    "continue",
    "toRead",
    "nextInSeries",
    "forYou",
  ])
})

test("finished books never appear in the Shortlist or Next in your series", () => {
  const done = book({ status: { name: "Read" } })
  const sections = buildHomeSections({
    ...defaults,
    books: [done],
    shortlist: [done.uuid],
    seriesNext: [{ bookUuid: done.uuid, reason: "next" }],
  })
  assert.deepEqual(section(sections, "shortlist"), [])
  assert.deepEqual(section(sections, "nextInSeries"), [])
})
