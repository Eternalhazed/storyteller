import assert from "node:assert/strict"
import test from "node:test"

import {
  XRAY_SCHEMA_VERSION,
  type Xray,
  viewXray,
} from "@storyteller-platform/xray/view"

import {
  getLastNavigationMenuTab,
  getLastXrayScope,
  getNavigationMenuTabFromPathname,
  setLastNavigationMenuTab,
  setLastXrayScope,
} from "@/components/toolbarItems/navigation/navigationMenuSessionState"
import {
  type ReadiumLocator,
  type ReadiumManifest,
} from "@/modules/readium/src/Readium.types"

import { getXrayBoundary } from "./xrayBoundary"
import {
  type XrayScope,
  buildXrayJump,
  getScopedXrayEntities,
  getXrayChapterLinks,
  getXrayDetailRows,
  getXrayEntitySummary,
  splitXrayNames,
} from "./xrayNavigation"

function entity(
  id: number,
  type: Xray["entities"][number]["type"],
  mentions: number[],
): Xray["entities"][number] {
  return {
    id,
    type,
    names: [{ at: mentions[0]!, text: `Entity ${id}` }],
    aliases: [{ at: mentions[0]!, text: `Entity ${id}` }],
    descriptions: [],
    facts: [],
    mentions: mentions.map((ordinal) => [ordinal, 0]),
  }
}

const xray: Xray = {
  schemaVersion: XRAY_SCHEMA_VERSION,
  generator: { version: 1, model: "test" },
  source: { sha256: "test" },
  chapters: [
    {
      id: "c1",
      href: "OEBPS/text/c1.xhtml",
      start: 0,
      lengths: Array<number>(50).fill(100),
    },
    {
      id: "c2",
      href: "OEBPS/text/c2.xhtml",
      start: 50,
      lengths: Array<number>(50).fill(100),
    },
    {
      id: "c3",
      href: "OEBPS/text/c3.xhtml",
      start: 100,
      lengths: Array<number>(50).fill(100),
    },
  ],
  entities: [
    entity(0, "character", [0, 10, 20, 50, 61, 70, 80, 99, 130]),
    entity(1, "place", [1, 94, 140]),
    entity(2, "group", [50, 51, 52, 55]),
    entity(3, "thing", [3, 5]),
    entity(4, "character", [110]),
  ],
  segments: [],
  sentences: Object.fromEntries(
    Array.from({ length: 150 }, (_, i) => [i, `Sentence ${i}.`]),
  ),
}

const manifest: ReadiumManifest = {
  "@context": [],
  metadata: { title: "Open edition", duration: 0 },
  links: [],
  readingOrder: [
    { href: "text/c1.xhtml", type: "text/html" },
    { href: "OEBPS/text/c2.xhtml", type: "application/xhtml+xml" },
    { href: "text/c3.xhtml", type: "application/xhtml+xml" },
  ],
  toc: [
    { href: "text/c1.xhtml#heading", title: "First chapter" },
    {
      href: "part.xhtml",
      title: "Part",
      children: [
        {
          href: "section.xhtml",
          children: [
            {
              href: "http://reader.local/OEBPS/text/c2.xhtml#heading",
              title: "Second chapter",
            },
          ],
        },
      ],
    },
  ],
}

function scoped(
  scope: XrayScope,
  type: Xray["entities"][number]["type"] | null = null,
  boundary = 95,
) {
  return getScopedXrayEntities({
    xray,
    views: viewXray(xray, boundary),
    boundary,
    scope,
    type,
  })
}

test("Just now uses the last 40 sentences and sorts by the latest mention", () => {
  assert.deepEqual(
    scoped("now").entities.map((item) => item.id),
    [1, 0],
  )
  assert.deepEqual(
    scoped("now", null, 94).entities.map((item) => item.id),
    [1, 0, 2],
  )
  assert.equal(scoped("now").entities[1]!.mentions.length, 7)
})

test("This chapter ranks by mentions in the current chapter, not across the book", () => {
  assert.deepEqual(
    scoped("chapter", null, 99).entities.map((item) => item.id),
    [0, 2, 1],
  )
  const changedCounts: Xray = {
    ...xray,
    entities: [
      entity(0, "character", [0, 1, 2, 3, 4, 5, 94]),
      entity(1, "place", [50, 60, 70]),
    ],
  }
  assert.deepEqual(
    getScopedXrayEntities({
      xray: changedCounts,
      views: viewXray(changedCounts, 95),
      boundary: 95,
      scope: "chapter",
      type: null,
    }).entities.map((item) => item.id),
    [1, 0],
  )
})

test("Book so far preserves viewXray order and never reveals future entities", () => {
  assert.deepEqual(scoped("book").entities, viewXray(xray, 95))
  assert.ok(!scoped("book").entities.some((item) => item.id === 4))
  assert.ok(
    scoped("book").entities.every((item) =>
      item.mentions.every((at) => at <= 95),
    ),
  )
})

test("empty scopes fall back through the next wider scopes with the type filter intact", () => {
  assert.equal(scoped("now", "group").scope, "chapter")
  assert.deepEqual(
    scoped("now", "group").entities.map((item) => item.id),
    [2],
  )
  assert.equal(scoped("now", "thing").scope, "book")
  assert.deepEqual(
    scoped("now", "thing").entities.map((item) => item.id),
    [3],
  )
  assert.equal(scoped("chapter", "thing").scope, "book")
  assert.deepEqual(
    scoped("now", "place").entities.map((item) => item.id),
    [1],
  )
  assert.deepEqual(scoped("now", "group", -1).entities, [])
})

test("summaries prefer descriptions, then the latest visible source sentence", () => {
  const visible = viewXray(xray, 95)[0]!
  assert.equal(getXrayEntitySummary(visible), null)
  assert.equal(
    getXrayEntitySummary({
      ...visible,
      facts: [
        { at: 80, sentence: 79, text: "Newest fact" },
        { at: 80, sentence: 3, text: "Earlier fact" },
      ],
    }),
    "Newest fact",
  )
  assert.equal(
    getXrayEntitySummary({
      ...visible,
      description: "Known description",
      facts: [{ at: 80, sentence: 79, text: "Newest fact" }],
    }),
    "Known description",
  )
})

test("chapter links preserve the open edition's href and MIME type, resolving nested TOC titles", () => {
  assert.deepEqual(getXrayChapterLinks(xray, manifest), [
    { href: "text/c1.xhtml", type: "text/html", title: "First chapter" },
    {
      href: "OEBPS/text/c2.xhtml",
      type: "application/xhtml+xml",
      title: "Second chapter",
    },
    {
      href: "text/c3.xhtml",
      type: "application/xhtml+xml",
      title: "Untitled chapter",
    },
  ])
})

test("link matching handles escaped paths and does not accept unrelated chapters", () => {
  const spaced: Xray = {
    ...xray,
    chapters: [
      {
        id: "spaced",
        href: "OEBPS/text/chapter%201.xhtml",
        start: 0,
        lengths: [100],
      },
    ],
  }
  const withEscapedHref: ReadiumManifest = {
    ...manifest,
    readingOrder: [
      { href: "bad%href.xhtml", type: "text/html" },
      { href: "text/chapter%201.xhtml", type: "application/xhtml+xml" },
    ],
    toc: [{ href: "text/chapter%201.xhtml#title", title: "Escaped chapter" }],
  }
  assert.deepEqual(getXrayChapterLinks(spaced, withEscapedHref), [
    {
      href: "text/chapter%201.xhtml",
      type: "application/xhtml+xml",
      title: "Escaped chapter",
    },
  ])
  assert.deepEqual(getXrayChapterLinks(xray, null), [null, null, null])
})

test("TOC links can supply a target, but a missing media type is not invented", () => {
  const tocOnly: ReadiumManifest = {
    ...manifest,
    readingOrder: [],
    toc: [
      {
        href: "text/c1.xhtml#title",
        title: "First chapter",
        type: "text/html",
      },
      { href: "text/c2.xhtml#title", title: "Second chapter" },
    ],
  }
  const chapterLinks = getXrayChapterLinks(xray, tocOnly)
  assert.deepEqual(chapterLinks[0], {
    href: "text/c1.xhtml",
    type: "text/html",
    title: "First chapter",
  })
  assert.equal(chapterLinks[1]!.type, null)
  assert.equal(chapterLinks[1]!.title, "Second chapter")
  assert.equal(chapterLinks[2], null)
  assert.equal(
    buildXrayJump({
      xray,
      ordinal: 55,
      chapterLinks,
      format: "readaloud",
      currentLocator: null,
    }),
    null,
  )
})

test("readaloud jumps carry the sentence fragment and character progression", () => {
  const jump = buildXrayJump({
    xray,
    ordinal: 25,
    chapterLinks: getXrayChapterLinks(xray, manifest),
    format: "readaloud",
    currentLocator: null,
  })
  assert.deepEqual(jump, {
    locator: {
      href: "text/c1.xhtml",
      type: "text/html",
      title: "First chapter",
      locations: { fragments: ["c1-s25"], progression: 0.5 },
    },
    currentLocator: undefined,
  })
})

test("plain ebook jumps carry the exact sentence quote, with progression as fallback", () => {
  const jump = buildXrayJump({
    xray,
    ordinal: 75,
    chapterLinks: getXrayChapterLinks(xray, manifest),
    format: "ebook",
    currentLocator: null,
  })
  assert.deepEqual(jump!.locator.locations, { progression: 0.5 })
  assert.equal(jump!.locator.href, "OEBPS/text/c2.xhtml")
  assert.equal(jump!.locator.type, "application/xhtml+xml")
  assert.deepEqual(jump!.locator.text, { highlight: xray.sentences[75] })
})

test("invalid ordinals, unavailable targets, and standalone audio do not produce jumps", () => {
  const chapterLinks = getXrayChapterLinks(xray, manifest)
  for (const ordinal of [-1, 150]) {
    assert.equal(
      buildXrayJump({
        xray,
        ordinal,
        chapterLinks,
        format: "readaloud",
        currentLocator: null,
      }),
      null,
    )
  }
  assert.equal(
    buildXrayJump({
      xray,
      ordinal: 25,
      chapterLinks: [],
      format: "ebook",
      currentLocator: null,
    }),
    null,
  )
  assert.equal(
    buildXrayJump({
      xray,
      ordinal: 25,
      chapterLinks,
      format: "audiobook",
      currentLocator: null,
    }),
    null,
  )
})

test("successive fact or mention jumps keep the original return locator and spoiler boundary", () => {
  const realPosition: ReadiumLocator = {
    href: "OEBPS/text/c2.xhtml",
    type: "application/xhtml+xml",
    locations: { fragments: ["c2-s5"], progression: 0.1 },
  }
  const chapterLinks = getXrayChapterLinks(xray, manifest)
  const first = buildXrayJump({
    xray,
    ordinal: 10,
    chapterLinks,
    format: "readaloud",
    currentLocator: realPosition,
  })!
  assert.strictEqual(first.currentLocator, realPosition)
  const returnPosition = { locator: first.currentLocator! }
  const second = buildXrayJump({
    xray,
    ordinal: 3,
    chapterLinks,
    format: "readaloud",
    currentLocator: first.locator,
    returnPosition,
  })!
  assert.strictEqual(second.currentLocator, realPosition)
  assert.equal(
    getXrayBoundary({
      xray,
      locator: second.locator,
      mode: "audio",
      returnPosition,
    }),
    55,
  )
  assert.equal(
    getXrayBoundary({
      xray,
      locator: second.locator,
      mode: "text",
      returnPosition,
    }),
    64,
  )

  const afterDismissal = buildXrayJump({
    xray,
    ordinal: 10,
    chapterLinks,
    format: "readaloud",
    currentLocator: second.locator,
    returnPosition: null,
  })!
  assert.strictEqual(afterDismissal.currentLocator, second.locator)
})

test("a jump returns to the reader's place, not to an older return position behind it", () => {
  const chapterLinks = getXrayChapterLinks(xray, manifest)
  const readTo: ReadiumLocator = {
    href: "OEBPS/text/c2.xhtml",
    type: "application/xhtml+xml",
    locations: { fragments: ["c2-s5"], progression: 0.1 },
  }
  // Left behind by an earlier Contents jump from the start of the book.
  const staleReturn = {
    locator: {
      href: "OEBPS/text/c1.xhtml",
      type: "application/xhtml+xml",
      locations: { fragments: ["c1-s0"], progression: 0 },
    },
  }

  const jump = buildXrayJump({
    xray,
    ordinal: 10,
    chapterLinks,
    format: "readaloud",
    currentLocator: readTo,
    returnPosition: staleReturn,
  })!

  assert.strictEqual(jump.currentLocator, readTo)
})

test("detail rows contain visible facts and mentions, grouped by chapter in either order", () => {
  const withFacts: Xray = {
    ...xray,
    entities: [
      {
        ...xray.entities[0]!,
        facts: [
          { at: 20, sentence: 6, text: "A visible fact" },
          { at: 140, sentence: 100, text: "A future fact" },
        ],
      },
    ],
  }
  const visible = viewXray(withFacts, 95)[0]!
  const chapterLinks = getXrayChapterLinks(withFacts, manifest)
  assert.deepEqual(viewXray(withFacts, 19)[0]!.facts, [])
  assert.equal(viewXray(withFacts, 20)[0]!.facts[0]!.sentence, 6)
  const newest = getXrayDetailRows({
    xray: withFacts,
    entity: visible,
    chapterLinks,
    newestFirst: true,
  })
  assert.deepEqual(
    newest
      .filter((row) => row.kind === "section")
      .map((row) => [row.title, row.count]),
    [
      ["Key facts", 1],
      ["Mentions", 7],
    ],
  )
  assert.deepEqual(
    newest
      .filter((row) => row.kind === "chapter")
      .map((row) => [row.title, row.count]),
    [
      ["Second chapter", 4],
      ["First chapter", 3],
    ],
  )
  assert.deepEqual(
    newest.filter((row) => row.kind === "mention").map((row) => row.ordinal),
    [80, 70, 61, 50, 20, 10, 0],
  )
  assert.deepEqual(
    newest.filter((row) => row.kind === "fact").map((row) => row.text),
    ["A visible fact"],
  )
  assert.equal(newest.find((row) => row.key === "mention:80")!.kind, "mention")
  assert.ok(!JSON.stringify(newest).includes("future fact"))
  const fact = newest.find((row) => row.kind === "fact")!
  assert.equal(fact.ordinal, 6)
  assert.deepEqual(
    buildXrayJump({
      xray: withFacts,
      ordinal: fact.ordinal,
      chapterLinks,
      format: "readaloud",
      currentLocator: {
        href: "text/c2.xhtml",
        type: "application/xhtml+xml",
        locations: { progression: 0.9 },
      },
    })!.locator.locations,
    { fragments: ["c1-s6"], progression: 0.12 },
  )

  const oldest = getXrayDetailRows({
    xray: withFacts,
    entity: visible,
    chapterLinks,
    newestFirst: false,
  })
  assert.deepEqual(
    oldest
      .filter((row) => row.kind === "chapter")
      .map((row) => [row.title, row.count]),
    [
      ["First chapter", 3],
      ["Second chapter", 4],
    ],
  )
  assert.deepEqual(
    oldest.filter((row) => row.kind === "mention").map((row) => row.ordinal),
    [0, 10, 20, 50, 61, 70, 80],
  )
})

test("thousands of mentions remain separate virtualizable rows with stable unique keys", () => {
  const large: Xray = {
    ...xray,
    chapters: [
      {
        id: "large",
        href: "large.xhtml",
        start: 0,
        lengths: Array<number>(5000).fill(10),
      },
    ],
    entities: [
      entity(
        0,
        "character",
        Array.from({ length: 5000 }, (_, index) => index),
      ),
    ],
    sentences: Object.fromEntries(
      Array.from({ length: 5000 }, (_, index) => [index, `Sentence ${index}.`]),
    ),
  }
  const visible = viewXray(large, 4999)[0]!
  const rows = getXrayDetailRows({
    xray: large,
    entity: visible,
    chapterLinks: [],
    newestFirst: true,
  })
  assert.equal(rows.length, 5002)
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length)
  assert.deepEqual(rows[1], {
    kind: "chapter",
    key: "chapter:0",
    title: "Untitled chapter",
    count: 5000,
  })
  assert.deepEqual(rows[2], {
    kind: "mention",
    key: "mention:4999",
    ordinal: 4999,
    text: "Sentence 4999.",
  })
  assert.deepEqual(rows.at(-1), {
    kind: "mention",
    key: "mention:0",
    ordinal: 0,
    text: "Sentence 0.",
  })
})

test("a mention is split around the entity's names, whole words only and longest name first", () => {
  assert.deepEqual(
    splitXrayNames("Later, Bono. BONO'S hair; Bonobos ignored.", ["Bono"]),
    [
      { text: "Later, ", name: false },
      { text: "Bono", name: true },
      { text: ". ", name: false },
      { text: "BONO", name: true },
      { text: "'S hair; Bonobos ignored.", name: false },
    ],
  )
  assert.deepEqual(splitXrayNames("Dr. Crest waved.", ["Crest", "Dr. Crest"]), [
    { text: "Dr. Crest", name: true },
    { text: " waved.", name: false },
  ])
  assert.deepEqual(splitXrayNames("No name here.", ["C++ (lang)"]), [
    { text: "No name here.", name: false },
  ])
  assert.deepEqual(splitXrayNames("Plain.", []), [
    { text: "Plain.", name: false },
  ])
})

test("the X-Ray tab and scope persist for the session, with a safe tab fallback for other books", () => {
  assert.equal(getLastXrayScope(), "now")
  setLastXrayScope("chapter")
  assert.equal(getLastXrayScope(), "chapter")
  setLastXrayScope("now")
  setLastNavigationMenuTab("xray")
  assert.equal(getLastNavigationMenuTab(true), "xray")
  assert.equal(getLastNavigationMenuTab(false), "toc")
  assert.equal(
    getNavigationMenuTabFromPathname("/navigation-menu/xray"),
    "xray",
  )
  setLastNavigationMenuTab("highlights")
  assert.equal(getLastNavigationMenuTab(false), "highlights")
  setLastNavigationMenuTab("toc")
})

test("manifest matching decodes both hrefs without matching part of a path segment", () => {
  const encoded: Xray = {
    ...xray,
    chapters: [
      {
        id: "accent",
        href: "Text/Cap%C3%ADtulo%201.xhtml",
        start: 0,
        lengths: [100],
      },
    ],
  }
  const open: ReadiumManifest = {
    ...manifest,
    readingOrder: [
      { href: "OEBPS/Text/notCap%C3%ADtulo%201.xhtml", type: "text/html" },
      { href: "OEBPS/Text/Capítulo 1.xhtml", type: "application/xhtml+xml" },
    ],
    toc: [
      { href: "Text/Cap%C3%ADtulo%201.xhtml#title", title: "Capítulo uno" },
    ],
  }
  assert.deepEqual(getXrayChapterLinks(encoded, open), [
    {
      href: "OEBPS/Text/Capítulo 1.xhtml",
      type: "application/xhtml+xml",
      title: "Capítulo uno",
    },
  ])
  assert.deepEqual(
    getXrayChapterLinks(encoded, {
      ...open,
      readingOrder: [open.readingOrder[0]!],
      toc: [],
    }),
    [null],
  )
})
