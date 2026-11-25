import assert from "node:assert/strict"
import { test } from "vitest"

import { type PickWork } from "@storyteller/web/src/recommendations/types"

import {
  recommendationLength,
  resolvedWorkHref,
  seriesLine,
  stageLabel,
  subjectList,
} from "./recommendations"
import { parsePickerTarget, parseRequestUuid } from "./requestNavigation"

test("recommendation stages describe the current work", () => {
  assert.equal(stageLabel(null), "Starting your picks…")
  assert.equal(stageLabel("finding"), "Finding books…")
  assert.equal(stageLabel("verifying"), "Checking the catalog…")
  assert.equal(stageLabel("ranking"), "Ranking your picks…")
})

test("details format optional catalog lengths and series order", () => {
  assert.equal(recommendationLength({ runtimeMinutes: null, pages: null }), "")
  assert.equal(recommendationLength({ runtimeMinutes: 60, pages: null }), "1 h")
  assert.equal(
    recommendationLength({ runtimeMinutes: 173, pages: 320 }),
    "2 h 53 min · 320 pages",
  )
  assert.equal(
    recommendationLength({ runtimeMinutes: null, pages: 1 }),
    "1 page",
  )
  assert.equal(
    seriesLine({
      name: "Blue Seas",
      position: 3,
      books: 14,
      latestReleaseYear: 2024,
    }),
    "Blue Seas · Book 3 of 14 · Latest: 2024",
  )
  assert.equal(
    seriesLine({
      name: "Blue Seas",
      position: null,
      books: 2,
      latestReleaseYear: null,
    }),
    "Blue Seas · 2 books",
  )
})

test("subject lists trim, split and deduplicate entries", () => {
  assert.deepEqual(subjectList(" Naval, , Science fiction\nNaval "), [
    "Naval",
    "Science fiction",
  ])
})

test("resolved picks preserve their identifiers and attribution through Expo params", () => {
  const serverUuid = parseRequestUuid("00000000-0000-4000-8000-000000000001")
  const recommendationUuid = parseRequestUuid(
    "00000000-0000-4000-8000-000000000002",
  )
  assert.ok(serverUuid && recommendationUuid)
  const work: PickWork = {
    key: "audible:EXAMPLE",
    title: "The Long Journey",
    authors: ["A. Writer"],
    series: { name: "Blue Seas", position: 3 },
    language: "en",
    ids: { asin: "EXAMPLE" },
    altTitles: ["Long Journey"],
    coverUrl: null,
    releaseDate: null,
    runtimeMinutes: null,
    pages: null,
    narrators: [],
    description: null,
  }
  const href = resolvedWorkHref(serverUuid, work, recommendationUuid)
  assert.equal(href.pathname, "/request/new")
  assert.deepEqual(
    parsePickerTarget(
      Object.fromEntries(
        Object.entries(href.params).flatMap(([key, value]) =>
          value == null ? [] : [[key, String(value)]],
        ),
      ),
    ),
    {
      kind: "title",
      resolved: true,
      input: { text: work.title, recommendationUuid },
      work: {
        title: work.title,
        authors: work.authors,
        series: work.series,
        language: work.language,
        ids: work.ids,
        altTitles: work.altTitles,
      },
    },
  )
})
