import assert from "node:assert/strict"

import { test } from "vitest"

import { filterNextUp } from "./nextUp"

const book = (
  title: string,
  status: string | null,
  position: number | null,
  series = "series",
) => ({
  title,
  status: status === null ? null : { name: status },
  series: [{ uuid: series, position }],
})

test("Next up chooses the first unread volume, including out-of-order input", () => {
  const first = book("First", "Read", 1)
  const second = book("Second", "To read", 2)
  const third = book("Third", "To read", 3)
  const fourth = book("Fourth", "To read", 4)
  const fifth = book("Fifth", "To read", 5)

  assert.deepEqual(filterNextUp([first, second, third, fourth, fifth]), [
    second,
  ])
  assert.deepEqual(filterNextUp([fifth, third, first, fourth, second]), [
    second,
  ])
})

test("a started volume remains eligible without skipping earlier unread volumes", () => {
  const first = book("First", "Read", 1)
  const startedSecond = book("Second", "Reading", 2)
  const startedThird = book("Third", "Reading", 3)
  const unreadSecond = book("Second", "To read", 2)

  assert.deepEqual(filterNextUp([startedThird, first, startedSecond]), [
    startedSecond,
  ])
  assert.deepEqual(filterNextUp([startedThird, first, unreadSecond]), [
    unreadSecond,
  ])
})

test("Next up is strictly after the highest completed volume", () => {
  const first = book("First", "Read", 1)
  const second = book("Second", "To read", 2)
  const third = book("Third", "Read", 3)
  const samePosition = book("Alternate third", "To read", 3)
  const fourth = book("Fourth", null, 4)

  assert.deepEqual(filterNextUp([third, second, fourth, samePosition, first]), [
    fourth,
  ])
  assert.deepEqual(filterNextUp([third, second, samePosition, first]), [])
})

test("unnumbered books are neither Next up candidates nor completed anchors", () => {
  const first = book("First", "Read", 1)
  const unnumbered = book("Article", "Reading", null)
  const second = book("Second", "To read", 2)
  const unnumberedRead = book("Read article", "Read", null)

  assert.deepEqual(filterNextUp([unnumbered, first, second]), [second])
  assert.deepEqual(filterNextUp([first, unnumbered]), [])
  assert.deepEqual(filterNextUp([unnumberedRead, second]), [])
})

test("a series without a completed volume has no Next up book", () => {
  assert.deepEqual(
    filterNextUp([book("First", "Reading", 1), book("Second", "To read", 2)]),
    [],
  )
  assert.deepEqual(filterNextUp([]), [])
})

test("Next up is selected per series and shared candidates appear only once", () => {
  const first = book("First", "Read", 1)
  first.series.push({ uuid: "shared-series", position: 1 })
  const second = book("Second", "To read", 2)
  second.series.push({ uuid: "shared-series", position: 2 })
  const third = book("Third", "To read", 3)
  const otherFirst = book("Other first", "Read", 1, "other-series")
  const otherSecond = book("Other second", "To read", 2, "other-series")
  const otherThird = book("Other third", "To read", 3, "other-series")
  const unstarted = book("Unstarted", "To read", 1, "unstarted-series")

  assert.deepEqual(
    filterNextUp([
      third,
      first,
      second,
      otherThird,
      otherFirst,
      otherSecond,
      unstarted,
    ]),
    [second, otherSecond],
  )
})
