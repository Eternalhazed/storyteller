import assert from "node:assert/strict"

import { test } from "vitest"

import { seriesCardLabel, seriesCoverLabel } from "@/components/seriesLabel"
import {
  getFeaturedSeries,
  getSeriesProgress,
  getSeriesProgressByUuid,
  nextInSeriesAfter,
  type SeriesMembership,
} from "./seriesProgress"

function book(
  position: number | null,
  status: string | null = "To read",
  seriesUuid = "sharpe",
) {
  const membership: SeriesMembership = {
    uuid: seriesUuid,
    name: seriesUuid === "sharpe" ? "Sharpe" : seriesUuid,
    position,
    featured: "true",
  }
  return {
    uuid: `${seriesUuid}-${position ?? "unnumbered"}`,
    title: `${seriesUuid} ${position ?? "unnumbered"}`,
    status: status === null ? null : { name: status },
    position: { timestamp: 0, locator: { locations: { totalProgression: 0 } } },
    series: [membership],
  }
}

function sharpeBooks() {
  const finished = new Set([6, 10, 11, 12, 14, 15, 16, 18, 19])
  const reading = new Set([3, 8, 9, 13, 17, 20, 22])
  return [3, ...Array.from({ length: 17 }, (_, index) => index + 6)]
    .map((position) =>
      book(
        position,
        finished.has(position)
          ? "Read"
          : reading.has(position)
            ? "Reading"
            : "To read",
      ),
    )
    .concat(book(null))
}

test("Sharpe uses the furthest finished volume, not the earliest unfinished volume", () => {
  const books = sharpeBooks().reverse()
  const original = [...books]
  books.find((entry) => entry.uuid === "sharpe-3")!.position.timestamp = 900
  books.find((entry) => entry.uuid === "sharpe-20")!.position.timestamp = 500
  const series = getSeriesProgressByUuid(books, "sharpe")
  assert.ok(series)
  assert.equal(series.name, "Sharpe")
  assert.equal(series.furthestRead, 19)
  assert.deepEqual(
    series.ahead.map((entry) => entry.series[0]!.position),
    [20, 21, 22],
  )
  assert.deepEqual(
    series.behind.map((entry) => entry.series[0]!.position),
    [3, 7, 8, 9, 13, 17],
  )
  assert.equal(series.next?.uuid, "sharpe-20")
  assert.deepEqual(series.missing, [1, 2, 4, 5])
  assert.equal(series.nextMissing, null)
  assert.equal(series.state, "inProgress")
  assert.equal(series.lastActivity, 900)
  assert.equal(series.owned, 19)
  assert.deepEqual(
    series.books.map((entry) => entry.series[0]!.position),
    [3, ...Array.from({ length: 17 }, (_, index) => index + 6), null],
  )
  assert.deepEqual(books, original)
  assert.equal(seriesCardLabel(series), "3 ahead")
  assert.equal(
    seriesCoverLabel(
      books.find((entry) => entry.uuid === "sharpe-21")!,
      [series],
    ),
    "Sharpe #21 · 3 ahead",
  )
})

test("untouched series is not started, with ordered candidates and all owned books counted", () => {
  const books = [book(3), book(null), book(1), book(2)]
  const [series] = getSeriesProgress(books)
  assert.ok(series)
  assert.equal(series.state, "notStarted")
  assert.equal(series.furthestRead, null)
  assert.equal(series.next, books[2])
  assert.equal(series.ahead.length, 3)
  assert.deepEqual(series.behind, [])
  assert.equal(series.nextMissing, null)
  assert.equal(seriesCardLabel(series), "Not started · 4")
  assert.equal(seriesCoverLabel(books[0]!, [series]), "Sharpe #3")
})

test("Reading without any Read books starts the series at its first unfinished volume", () => {
  const books = [book(3, "Reading"), book(1), book(2)]
  const [series] = getSeriesProgress(books)
  assert.ok(series)
  assert.equal(series.state, "inProgress")
  assert.equal(series.furthestRead, null)
  assert.deepEqual(series.ahead, [books[1], books[2], books[0]])
  assert.equal(series.next, books[1])
})

test("progress starts a series but even 100% progress does not finish a book", () => {
  const first = book(1, null)
  first.position.locator.locations.totalProgression = 1
  const second = book(2)
  const [series] = getSeriesProgress([second, first])
  assert.ok(series)
  assert.equal(series.state, "inProgress")
  assert.equal(series.furthestRead, null)
  assert.equal(series.next, first)
  assert.equal(series.ahead.length, 2)
})

test("caught up ignores unfinished earlier books and reports the next missing number", () => {
  const earlier = book(1, "Reading")
  const furthest = book(3, "Read")
  const [series] = getSeriesProgress([furthest, earlier])
  assert.ok(series)
  assert.equal(series.state, "caughtUp")
  assert.deepEqual(series.ahead, [])
  assert.deepEqual(series.behind, [earlier])
  assert.equal(series.next, null)
  assert.deepEqual(series.missing, [2])
  assert.equal(series.nextMissing, 4)
  assert.equal(seriesCardLabel(series), "#4 not in library")
  assert.equal(seriesCoverLabel(furthest, [series]), "Sharpe #3")
})

test("unnumbered books stay listed but never become ordered candidates or finished anchors", () => {
  const finishedExtra = book(null, "Read")
  const first = book(1)
  const [series] = getSeriesProgress([finishedExtra, first])
  assert.ok(series)
  assert.equal(series.furthestRead, null)
  assert.equal(series.state, "inProgress")
  assert.deepEqual(series.books, [first, finishedExtra])
  assert.deepEqual(series.ahead, [first])
  assert.equal(
    nextInSeriesAfter([finishedExtra, first], finishedExtra.uuid),
    null,
  )
  const [onlyExtra] = getSeriesProgress([book(null, "Reading")])
  assert.ok(onlyExtra)
  assert.equal(onlyExtra.state, "caughtUp")
  assert.equal(onlyExtra.nextMissing, null)
  assert.equal(seriesCardLabel(onlyExtra), "Caught up")
})

test("decimal positions participate in ordering but do not own or invent integer volumes", () => {
  const first = book(1, "Read")
  const novella = book(1.5)
  const third = book(3)
  const lateExtra = book(4.5)
  const [series] = getSeriesProgress([lateExtra, third, novella, first])
  assert.ok(series)
  assert.deepEqual(series.ahead, [novella, third, lateExtra])
  assert.equal(series.next, novella)
  assert.deepEqual(series.missing, [2])
  assert.equal(series.nextMissing, null)
  const [fractionalFinish] = getSeriesProgress([book(1.5, "Read"), book(1)])
  assert.ok(fractionalFinish)
  assert.equal(fractionalFinish.furthestRead, 1.5)
  assert.equal(fractionalFinish.nextMissing, null)
  assert.equal(seriesCardLabel(fractionalFinish), "Caught up")
})

test("books at the completed position are neither ahead nor below the furthest volume", () => {
  const [series] = getSeriesProgress([
    book(2, "Read"),
    { ...book(2), uuid: "alternate" },
    book(1),
    book(3),
  ])
  assert.ok(series)
  assert.equal(series.ahead.length, 1)
  assert.equal(series.behind.length, 1)
  assert.equal(seriesCardLabel(series), "1 left")
})

test("nextInSeriesAfter follows the book rather than the series' furthest completed volume", () => {
  const books = [book(1, "Read"), book(2), book(3, "Read"), book(4)]
  assert.equal(nextInSeriesAfter(books, books[0]!.uuid), books[1])
  assert.equal(getSeriesProgress(books)[0]!.next, books[3])
  assert.equal(nextInSeriesAfter(books, books[3]!.uuid), null)
  assert.equal(nextInSeriesAfter(books, "missing"), null)
})

test("featured series wins over the first series, with first-series fallback", () => {
  const first = book(1, "Read", "other")
  first.series[0]!.featured = "false"
  first.series.push({
    uuid: "sharpe",
    name: "Sharpe",
    position: 19,
    featured: "true",
  })
  const otherNext = book(2, "To read", "other")
  const sharpeNext = book(20)
  assert.equal(getFeaturedSeries(first)?.uuid, "sharpe")
  assert.equal(
    nextInSeriesAfter([first, otherNext, sharpeNext], first.uuid),
    sharpeNext,
  )
  assert.equal(seriesCoverLabel(first), "Sharpe #19")
  first.series[1]!.featured = "false"
  assert.equal(
    nextInSeriesAfter([first, otherNext, sharpeNext], first.uuid),
    otherNext,
  )
  assert.equal(seriesCoverLabel(first), "other #1")
})

test("grouping uses UUIDs, keeps shared membership, and handles empty and unrelated books", () => {
  const first = book(1, "Read")
  first.series.push({
    uuid: "other",
    name: "Sharpe",
    position: 5,
    featured: "false",
  })
  const second = book(2)
  const noSeries = { ...book(null), series: [] }
  const series = getSeriesProgress([first, second, noSeries])
  assert.equal(series.length, 2)
  assert.equal(series[0]!.owned, 2)
  assert.equal(series[1]!.owned, 1)
  assert.equal(seriesCoverLabel(noSeries, series), null)
  assert.equal(getSeriesProgressByUuid([first], "missing"), null)
  assert.equal(nextInSeriesAfter([noSeries], noSeries.uuid), null)
  assert.deepEqual(getSeriesProgress([]), [])
})

test("next missing is reported separately from owned-range gaps", () => {
  const [series] = getSeriesProgress([book(1, "Read"), book(null)])
  assert.ok(series)
  assert.deepEqual(series.missing, [])
  assert.equal(series.nextMissing, 2)
  assert.equal(seriesCardLabel(series), "#2 not in library")
})
