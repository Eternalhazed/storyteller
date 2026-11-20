import assert from "node:assert/strict"
import test from "node:test"

import {
  XRAY_SCHEMA_VERSION,
  type Xray,
  viewXray,
} from "@storyteller-platform/xray/view"

import { type ReadiumLocator } from "@/modules/readium/src/Readium.types"

import {
  XRAY_TEXT_PAGE_CHARACTERS,
  canUseXray,
  getXrayBoundary,
} from "./xrayBoundary"

const xray: Xray = {
  schemaVersion: XRAY_SCHEMA_VERSION,
  generator: { version: 1, model: "test" },
  source: { sha256: "test" },
  chapters: [
    {
      id: "chapter-1",
      href: "EPUB/text/chapter%201.xhtml",
      start: 0,
      lengths: [600, 600, 600, 600, 600, 600],
    },
    {
      id: "chapter-2",
      href: "EPUB/text/chapter2.xhtml",
      start: 6,
      lengths: [600, 600, 600, 600],
    },
  ],
  segments: [],
  entities: [
    {
      id: 0,
      type: "character",
      names: [{ at: 8, text: "The stranger" }],
      aliases: [{ at: 8, text: "The stranger" }],
      descriptions: [{ at: 9, text: "A late arrival." }],
      facts: [{ at: 9, sentence: 8, text: "Arrives near the end." }],
      mentions: [[8, 0]],
    },
  ],
  sentences: {},
}

function locator(
  href: string,
  locations?: ReadiumLocator["locations"],
): ReadiumLocator {
  return {
    href,
    type: "application/xhtml+xml",
    ...(locations && { locations }),
  }
}

const firstChapter = "EPUB/text/chapter 1.xhtml"
const secondChapter = "EPUB/text/chapter2.xhtml"

test("prefers a sentence fragment to an approximate chapter progression", () => {
  assert.equal(
    getXrayBoundary({
      xray,
      locator: locator(secondChapter, {
        fragments: ["chapter-2-s1"],
        progression: 0.99,
      }),
      mode: "audio",
    }),
    7,
  )
})

test("finds sentence and word fragments after unrelated element ids", () => {
  for (const fragment of ["#chapter-2-s0", "chapter-2-s0-w3"]) {
    assert.equal(
      getXrayBoundary({
        xray,
        locator: locator(secondChapter, {
          fragments: ["section-heading", fragment],
        }),
        mode: "audio",
      }),
      6,
    )
  }
})

test("falls back to href and progression when no sentence fragment resolves", () => {
  assert.equal(
    getXrayBoundary({
      xray,
      locator: locator(secondChapter, {
        fragments: ["section-heading", "chapter-2-s100"],
        progression: 0.5,
      }),
      mode: "audio",
    }),
    8,
  )
})

test("resolves absolute and percent-encoded reading-system hrefs", () => {
  const withDecodedHref: Xray = {
    ...xray,
    chapters: [{ ...xray.chapters[0]!, href: firstChapter }],
  }
  assert.equal(
    getXrayBoundary({
      xray: withDecodedHref,
      locator: locator("http://localhost/EPUB/text/chapter%201.xhtml#heading", {
        progression: 0.5,
      }),
      mode: "audio",
    }),
    3,
  )
})

test("uses a 1000-non-whitespace-character fallback only for text fragments", () => {
  assert.equal(XRAY_TEXT_PAGE_CHARACTERS, 1000)
  const current = locator(firstChapter, { fragments: ["chapter-1-s1"] })
  assert.equal(getXrayBoundary({ xray, locator: current, mode: "text" }), 1)
  assert.equal(getXrayBoundary({ xray, locator: current, mode: "audio" }), 1)
})

test("does not extend a visible page into the next chapter", () => {
  assert.equal(
    getXrayBoundary({
      xray,
      locator: locator(firstChapter, { fragments: ["chapter-1-s5"] }),
      mode: "text",
    }),
    5,
  )
})

test("does not advance past a sentence longer than the visible page estimate", () => {
  const longSentence: Xray = {
    ...xray,
    chapters: [
      { id: "long", href: "long.xhtml", start: 0, lengths: [2000, 100] },
    ],
  }
  assert.equal(
    getXrayBoundary({
      xray: longSentence,
      locator: locator("long.xhtml", { fragments: ["long-s0"] }),
      mode: "text",
    }),
    0,
  )
})

test("uses the farther current position rather than a stale return position", () => {
  const destination = locator(secondChapter, { fragments: ["chapter-2-s3"] })
  const returnPosition = {
    locator: locator(firstChapter, { fragments: ["chapter-1-s1"] }),
  }
  assert.equal(
    getXrayBoundary({
      xray,
      locator: destination,
      mode: "audio",
      returnPosition,
    }),
    9,
  )
  assert.equal(
    getXrayBoundary({
      xray,
      locator: destination,
      mode: "text",
      returnPosition,
    }),
    9,
  )
})

test("uses the return position even for a backward jump or missing current locator", () => {
  const returnPosition = {
    locator: locator(secondChapter, { fragments: ["chapter-2-s1"] }),
  }
  for (const current of [
    locator(firstChapter, { fragments: ["chapter-1-s0"] }),
    null,
  ]) {
    assert.equal(
      getXrayBoundary({
        xray,
        locator: current,
        mode: "audio",
        returnPosition,
      }),
      7,
    )
  }
})

test("resolves current and return href progressions independently", () => {
  const destination = locator(secondChapter, { fragments: ["chapter-2-s3"] })
  assert.equal(
    getXrayBoundary({
      xray,
      locator: destination,
      mode: "audio",
      returnPosition: { locator: locator(secondChapter, { progression: 0 }) },
    }),
    9,
  )
  assert.equal(
    getXrayBoundary({
      xray,
      locator: destination,
      mode: "text",
      returnPosition: { locator: locator("unknown.xhtml", { progression: 0 }) },
    }),
    9,
  )
})

test("keeps later knowledge available while a return control remains", () => {
  const destination = locator(secondChapter, { fragments: ["chapter-2-s3"] })
  const returnPosition = {
    locator: locator(firstChapter, { fragments: ["chapter-1-s0"] }),
  }
  assert.equal(
    viewXray(
      xray,
      getXrayBoundary({
        xray,
        locator: destination,
        mode: "audio",
        returnPosition,
      }),
    )[0]?.description,
    "A late arrival.",
  )
  assert.equal(
    viewXray(
      xray,
      getXrayBoundary({
        xray,
        locator: destination,
        mode: "audio",
        returnPosition: null,
      }),
    )[0]?.description,
    "A late arrival.",
  )
})

test("returns -1 when no X-Ray, locator, chapter, or progression resolves", () => {
  assert.equal(getXrayBoundary({ xray: null, locator: null, mode: "text" }), -1)
  assert.equal(
    getXrayBoundary({ xray: undefined, locator: null, mode: "audio" }),
    -1,
  )
  assert.equal(getXrayBoundary({ xray, locator: undefined, mode: "audio" }), -1)
  for (const unresolved of [
    locator("unknown.xhtml", { progression: 0.5 }),
    locator("", { progression: 0.5 }),
    locator(secondChapter),
    locator(secondChapter, { totalProgression: 0.8 }),
    locator(secondChapter, { progression: Number.NaN }),
    locator(secondChapter, { progression: Number.POSITIVE_INFINITY }),
    locator("bad%href.xhtml", { progression: 0.5 }),
    locator(secondChapter, { fragments: ["chapter-2-s100"] }),
  ]) {
    assert.equal(
      getXrayBoundary({ xray, locator: unresolved, mode: "text" }),
      -1,
      JSON.stringify(unresolved),
    )
  }
})

test("does not resolve a chapter without any sentences to the previous chapter", () => {
  const withEmptyChapter: Xray = {
    ...xray,
    chapters: [
      ...xray.chapters,
      { id: "empty", href: "empty.xhtml", start: 10, lengths: [] },
    ],
  }
  assert.equal(
    getXrayBoundary({
      xray: withEmptyChapter,
      locator: locator("empty.xhtml", { progression: 0 }),
      mode: "text",
    }),
    -1,
  )
})

test("clamps progression to the book chapter's first and last sentences", () => {
  assert.equal(
    getXrayBoundary({
      xray,
      locator: locator(secondChapter, { progression: -0.1 }),
      mode: "audio",
    }),
    6,
  )
  assert.equal(
    getXrayBoundary({
      xray,
      locator: locator(secondChapter, { progression: 1.1 }),
      mode: "audio",
    }),
    9,
  )
})

test("readaloud listening follows the spoken fragment rather than its HTML progression", () => {
  const spoken = locator(secondChapter, {
    fragments: ["chapter-2-s2"],
    progression: 0.01,
  })
  assert.equal(getXrayBoundary({ xray, locator: spoken, mode: "audio" }), 8)
  assert.equal(getXrayBoundary({ xray, locator: spoken, mode: "text" }), 8)
  assert.equal(canUseXray({ xray, format: "readaloud", mode: "audio" }), true)
})

test("standalone audiobook playback has no text boundary or X-Ray controls", () => {
  const audio = locator("Audio/track01.mp3", {
    fragments: ["t=12.5"],
    progression: 0.5,
    totalProgression: 0.75,
  })
  assert.equal(getXrayBoundary({ xray, locator: audio, mode: "audio" }), -1)
  assert.equal(canUseXray({ xray, format: "audiobook", mode: "audio" }), false)
  assert.equal(canUseXray({ xray, format: "ebook", mode: "text" }), true)
  assert.equal(
    canUseXray({ xray: null, format: "readaloud", mode: "audio" }),
    false,
  )
})

test("reading beyond a cover-page return position does not leave X-Ray empty", () => {
  const current = locator(secondChapter, { fragments: ["chapter-2-s1"] })
  const returnPosition = { locator: locator("cover.xhtml", { progression: 0 }) }
  assert.equal(
    getXrayBoundary({ xray, locator: current, mode: "audio", returnPosition }),
    7,
  )
  assert.equal(
    getXrayBoundary({ xray, locator: current, mode: "text", returnPosition }),
    7,
  )
})

test("playing narration in the reading view applies no page allowance to either locator", () => {
  const current = locator(firstChapter, { fragments: ["chapter-1-s1"] })
  const returnPosition = {
    locator: locator(secondChapter, { fragments: ["chapter-2-s1"] }),
  }
  assert.equal(
    getXrayBoundary({ xray, locator: current, mode: "text", isPlaying: true }),
    1,
  )
  assert.equal(
    getXrayBoundary({
      xray,
      locator: current,
      mode: "text",
      isPlaying: true,
      returnPosition,
    }),
    7,
  )
  assert.equal(
    getXrayBoundary({ xray, locator: current, mode: "text", returnPosition }),
    7,
  )
})

test("zero-entity files have no X-Ray controls in any reader mode", () => {
  const empty = { ...xray, entities: [] }
  assert.equal(
    canUseXray({ xray: empty, format: "ebook", mode: "text" }),
    false,
  )
  assert.equal(
    canUseXray({ xray: empty, format: "readaloud", mode: "text" }),
    false,
  )
  assert.equal(
    canUseXray({ xray: empty, format: "readaloud", mode: "audio" }),
    false,
  )
})

test("a measured page bottom beats fragments and overshooting layout without any allowance", () => {
  for (const [textEnd, expected] of [
    [600, 6],
    [601, 7],
    [1200, 7],
  ] as const) {
    const current = locator(secondChapter, {
      fragments: ["chapter-2-s3"],
      progression: 0.99,
      textStart: 200,
      textEnd,
      textLength: 2400,
    })
    for (const mode of ["text", "audio"] as const) {
      const boundary = getXrayBoundary({ xray, locator: current, mode })
      assert.equal(boundary, expected)
      assert.deepEqual(viewXray(xray, boundary), [])
    }
  }
})

test("measured offsets count the final visible character, not the next sentence", () => {
  const current = locator(secondChapter, {
    textStart: 1200,
    textEnd: 1500,
    textLength: 2400,
    progression: 0.99,
  })
  const boundary = getXrayBoundary({ xray, locator: current, mode: "text" })
  assert.equal(boundary, 8)
  const visible = viewXray(xray, boundary)[0]!
  assert.equal(visible.name, "The stranger")
  assert.equal(visible.description, null)
  assert.deepEqual(visible.facts, [])
  assert.equal(
    getXrayBoundary({
      xray,
      locator: locator(secondChapter, { textEnd: 0, progression: 0.99 }),
      mode: "text",
    }),
    -1,
  )
})

test("text offsets need a matching chapter and invalid offsets fall back to fragments", () => {
  assert.equal(
    getXrayBoundary({
      xray,
      locator: locator("http://reader.local/EPUB/text/chapter2.xhtml", {
        textEnd: 601,
      }),
      mode: "text",
    }),
    7,
  )
  for (const current of [
    locator("unknown.xhtml", { textEnd: 1, fragments: ["chapter-2-s1"] }),
    locator(secondChapter, {
      textEnd: Number.NaN,
      fragments: ["chapter-2-s1"],
    }),
    locator(secondChapter, { textEnd: -1, fragments: ["chapter-2-s1"] }),
  ]) {
    assert.equal(getXrayBoundary({ xray, locator: current, mode: "audio" }), 7)
  }
})

test("short fragment sentences advance at most 1000 non-whitespace characters", () => {
  const short: Xray = {
    ...xray,
    chapters: [
      {
        id: "short",
        href: "short.xhtml",
        start: 0,
        lengths: [400, 400, 400, 400, 400],
      },
    ],
  }
  const current = locator("short.xhtml", { fragments: ["short-s1"] })
  assert.equal(
    getXrayBoundary({ xray: short, locator: current, mode: "text" }),
    2,
  )
  assert.equal(
    getXrayBoundary({
      xray: short,
      locator: current,
      mode: "text",
      isPlaying: true,
    }),
    1,
  )
  assert.equal(
    getXrayBoundary({ xray: short, locator: current, mode: "audio" }),
    1,
  )
})

test("layout progression is a last resort and never gets a page allowance", () => {
  const short: Xray = {
    ...xray,
    chapters: [
      {
        id: "short",
        href: "short.xhtml",
        start: 0,
        lengths: Array<number>(10).fill(100),
      },
    ],
  }
  const current = locator("short.xhtml", {
    fragments: ["not-a-sentence"],
    progression: 0.5,
  })
  for (const mode of ["text", "audio"] as const) {
    assert.equal(getXrayBoundary({ xray: short, locator: current, mode }), 5)
  }
})

test("current and return page bottoms resolve independently without extending either", () => {
  const returnPosition = {
    locator: locator(secondChapter, {
      textEnd: 1200,
      progression: 0.99,
      fragments: ["chapter-2-s3"],
    }),
  }
  assert.equal(
    getXrayBoundary({
      xray,
      locator: locator(firstChapter, { textEnd: 600 }),
      mode: "text",
      returnPosition,
    }),
    7,
  )
  assert.equal(
    getXrayBoundary({
      xray,
      locator: locator(secondChapter, { textEnd: 1801 }),
      mode: "text",
      returnPosition,
    }),
    9,
  )
})
