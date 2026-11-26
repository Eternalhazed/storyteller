import assert from "node:assert/strict"
import { test } from "vitest"

import { type PickWork } from "@storyteller/web/src/recommendations/types"

import {
  recommendationLength,
  resolvedWorkHref,
  seriesLine,
  stageLabel,
  subjectChoices,
  toggleSeriesLength,
  toggleSubject,
} from "./recommendations"
import { parsePickerTarget, parseRequestUuid } from "./requestNavigation"

test("recommendation stages describe the current work", () => {
  assert.equal(stageLabel(null), "Reading your history…")
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

test("series lengths can be combined, cleared, or reset to Any by picking all", () => {
  assert.deepEqual(toggleSeriesLength(["medium"], "long"), ["medium", "long"])
  assert.deepEqual(toggleSeriesLength(["medium", "long"], "medium"), ["long"])
  assert.deepEqual(toggleSeriesLength(["medium", "long"], "short"), [])
  assert.deepEqual(toggleSeriesLength(["medium", "long"], "any"), [])
})

test("profile subjects precede the curated list and duplicate custom subjects", () => {
  const choices = subjectChoices(
    ["Napoleonic naval warfare", " historical FICTION  "],
    [" historical fiction", "Cozy", "Sailing voyages", "sailing VOYAGES"],
  )
  assert.deepEqual(choices.slice(0, 3), [
    "Napoleonic naval warfare",
    "historical FICTION",
    "Military history",
  ])
  assert.deepEqual(choices.slice(-2), ["Coming of age", "Sailing voyages"])
})

test("custom chips sanitize input, enforce a selection limit, and toggle case-insensitively", () => {
  assert.deepEqual(toggleSubject([], " \n Deep   time \t"), ["Deep time"])
  assert.deepEqual(toggleSubject([], "x".repeat(50)), ["x".repeat(40)])
  assert.deepEqual(toggleSubject(["Space opera"], "space OPERA"), [])
  const full = Array.from({ length: 12 }, (_, index) => `Genre ${index + 1}`)
  assert.deepEqual(toggleSubject(full, "Another genre"), full)
  assert.deepEqual(toggleSubject(full, "GENRE 1"), full.slice(1))
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
