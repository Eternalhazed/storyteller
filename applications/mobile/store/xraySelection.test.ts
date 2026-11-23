import assert from "node:assert/strict"
import { test } from "vitest"

import { XRAY_SCHEMA_VERSION, type Xray } from "@storyteller/xray/view"

import { type ReadiumLocator } from "@/modules/readium/src/Readium.types"

import { getSelectionXray, getXraySelectionFacts } from "./xraySelection"

const xray: Xray = {
  schemaVersion: XRAY_SCHEMA_VERSION,
  generator: { model: "test", version: 1 },
  source: { sha256: "test" },
  chapters: [
    {
      id: "chapter",
      href: "EPUB/chapter.xhtml",
      start: 0,
      lengths: Array<number>(10).fill(1000),
    },
  ],
  segments: [],
  entities: [
    {
      id: 0,
      type: "character",
      names: [
        { text: "The stranger", at: 0 },
        { text: "Captain Grey", at: 7 },
      ],
      aliases: [
        { text: "The stranger", at: 0 },
        { text: "Captain Grey", at: 7 },
      ],
      descriptions: [
        { text: "A visitor.", at: 2 },
        { text: "The ship's captain.", at: 8 },
      ],
      facts: [
        { text: "Wears a coat.", at: 2, sentence: 1 },
        { text: "Carries a bag.", at: 4, sentence: 3 },
        { text: "Boards the ship.", at: 6, sentence: 5 },
        { text: "Commands the ship.", at: 8, sentence: 7 },
      ],
      mentions: [
        [0, 0],
        [5, 0],
        [7, 1],
        [9, 1],
      ],
    },
  ],
  sentences: {},
}

function selection(text: string, progression = 0.5): ReadiumLocator {
  return {
    href: "chapter.xhtml",
    type: "application/xhtml+xml",
    locations: { progression },
    text: { highlight: text },
  }
}

test("a selection reveals its own sentence without extending a text page beyond it", () => {
  const result = getSelectionXray({
    xray,
    readerBoundary: 2,
    selection: selection("The stranger"),
  })!
  assert.equal(result.boundary, 5)
  assert.equal(result.entity.name, "The stranger")
  assert.equal(result.entity.description, "A visitor.")
  assert.deepEqual(result.entity.mentions, [0, 5])
  assert.deepEqual(
    result.entity.facts.map((fact) => fact.at),
    [2, 4],
  )
})

test("selecting a name during a detour cannot reveal a future alias", () => {
  assert.equal(
    getSelectionXray({
      xray,
      readerBoundary: 2,
      freezeBoundary: true,
      selection: selection("Captain Grey", 0.9),
    }),
    null,
  )
})

test("a lookup keeps a later reader boundary when selecting earlier text", () => {
  const result = getSelectionXray({
    xray,
    readerBoundary: 8,
    selection: selection("The stranger", 0.1),
  })!
  assert.equal(result.boundary, 8)
  assert.equal(result.entity.name, "Captain Grey")
  assert.equal(result.entity.description, "The ship's captain.")
  assert.deepEqual(result.entity.mentions, [0, 5, 7])
})

test("the selection ordinal uses href and progression, not an unrelated fragment", () => {
  const selected = selection("The stranger")
  selected.locations!.fragments = ["chapter-s9"]
  assert.equal(
    getSelectionXray({ xray, readerBoundary: 2, selection: selected })!
      .boundary,
    5,
  )
})

test("future aliases stay hidden until the selected sentence reveals them", () => {
  assert.equal(
    getSelectionXray({
      xray,
      readerBoundary: 2,
      selection: selection("Captain Grey", 0.5),
    }),
    null,
  )
  const result = getSelectionXray({
    xray,
    readerBoundary: 2,
    selection: selection("Captain Grey", 0.7),
  })!
  assert.equal(result.boundary, 7)
  assert.equal(result.entity.name, "Captain Grey")
  assert.equal(result.entity.description, "A visitor.")
  assert.ok(result.entity.facts.every((fact) => fact.at <= 7))
})

test("selected phrases can contain a known alias without matching an unknown entity", () => {
  assert.equal(
    getSelectionXray({
      xray,
      readerBoundary: 2,
      selection: selection("said The stranger quietly"),
    })!.entity.id,
    0,
  )
  assert.equal(
    getSelectionXray({
      xray,
      readerBoundary: 9,
      selection: selection("A different person"),
    }),
    null,
  )
})

test("missing files, empty selections, and unresolved boundaries have no X-Ray action", () => {
  assert.equal(
    getSelectionXray({
      xray: null,
      readerBoundary: 2,
      selection: selection("The stranger"),
    }),
    null,
  )
  assert.equal(
    getSelectionXray({ xray, readerBoundary: 2, selection: null }),
    null,
  )
  assert.equal(
    getSelectionXray({ xray, readerBoundary: 2, selection: selection("  ") }),
    null,
  )
  assert.equal(
    getSelectionXray({
      xray,
      readerBoundary: -1,
      selection: { ...selection("The stranger"), href: "unknown.xhtml" },
    }),
    null,
  )
})

test("an invalid selection location does not discard the established reader boundary", () => {
  for (const selected of [
    { ...selection("The stranger"), href: "bad%href.xhtml" },
    selection("The stranger", Number.NaN),
    { ...selection("The stranger"), locations: { fragments: ["chapter-s9"] } },
  ]) {
    assert.equal(
      getSelectionXray({ xray, readerBoundary: 2, selection: selected })!
        .boundary,
      2,
    )
  }
})

test("the compact card has at most the two most recent visible facts", () => {
  const result = getSelectionXray({
    xray,
    readerBoundary: 8,
    selection: selection("The stranger"),
  })!
  assert.deepEqual(
    getXraySelectionFacts(result.entity).map((fact) => fact.at),
    [8, 6],
  )
  assert.deepEqual(
    result.entity.facts.map((fact) => fact.at),
    [2, 4, 6, 8],
  )
  assert.deepEqual(getXraySelectionFacts({ ...result.entity, facts: [] }), [])
  assert.deepEqual(
    getXraySelectionFacts({
      ...result.entity,
      facts: [{ at: 2, sentence: 1, text: "Only fact" }],
    }),
    [{ at: 2, sentence: 1, text: "Only fact" }],
  )
})

test("the common word will is not the character Will, and the longest known alias wins", () => {
  const names: Xray = {
    ...xray,
    entities: [
      {
        ...xray.entities[0]!,
        id: 1,
        names: [{ at: 0, text: "Will" }],
        aliases: [{ at: 0, text: "Will" }],
        mentions: [[0, 0]],
      },
      {
        ...xray.entities[0]!,
        id: 2,
        names: [{ at: 0, text: "Captain Will" }],
        aliases: [{ at: 0, text: "Captain Will" }],
        mentions: [[1, 0]],
      },
    ],
  }
  assert.equal(
    getSelectionXray({
      xray: names,
      readerBoundary: 5,
      selection: selection("will"),
    }),
    null,
  )
  assert.equal(
    getSelectionXray({
      xray: names,
      readerBoundary: 5,
      selection: selection("Will"),
    })!.entity.id,
    1,
  )
  assert.equal(
    getSelectionXray({
      xray: names,
      readerBoundary: 5,
      selection: selection("said Captain Will quietly"),
    })!.entity.id,
    2,
  )
  assert.equal(
    getSelectionXray({
      xray: { ...names, entities: [] },
      readerBoundary: 5,
      selection: selection("Will"),
    }),
    null,
  )
})

test("recent card facts use their source sentences when their visibility stamps tie", () => {
  const result = getSelectionXray({
    xray,
    readerBoundary: 8,
    selection: selection("The stranger"),
  })!
  const facts = [
    { at: 8, sentence: 1, text: "Early" },
    { at: 8, sentence: 7, text: "Latest" },
    { at: 8, sentence: 5, text: "Recent" },
  ]
  assert.deepEqual(
    getXraySelectionFacts({ ...result.entity, facts }).map(
      (fact) => fact.sentence,
    ),
    [7, 5],
  )
})

test("a measured reader page prevents selection progression from revealing later aliases or facts", () => {
  const readerLocator: ReadiumLocator = {
    ...selection("The stranger"),
    locations: {
      textStart: 1000,
      textEnd: 2500,
      textLength: 10000,
      progression: 0.9,
    },
  }
  const result = getSelectionXray({
    xray,
    readerBoundary: 2,
    readerLocator,
    selection: selection("The stranger", 0.99),
  })!
  assert.equal(result.boundary, 2)
  assert.equal(result.entity.name, "The stranger")
  assert.equal(result.entity.description, "A visitor.")
  assert.deepEqual(
    result.entity.facts.map((fact) => fact.at),
    [2],
  )
  assert.deepEqual(result.entity.mentions, [0])
  assert.equal(
    getSelectionXray({
      xray,
      readerBoundary: 2,
      readerLocator,
      selection: selection("Captain Grey", 0.99),
    }),
    null,
  )
})

test("an empty measured page cannot be bypassed by selection progression", () => {
  assert.equal(
    getSelectionXray({
      xray,
      readerBoundary: -1,
      readerLocator: { ...selection(""), locations: { textEnd: 0 } },
      selection: selection("The stranger", 0.99),
    }),
    null,
  )
})

test("without a measured page, a selection can still extend an earlier reader boundary", () => {
  const result = getSelectionXray({
    xray,
    readerBoundary: 2,
    readerLocator: { ...selection(""), locations: { progression: 0.2 } },
    selection: selection("Captain Grey", 0.7),
  })!
  assert.equal(result.boundary, 7)
  assert.equal(result.entity.name, "Captain Grey")
})
