import assert from "node:assert"
import { describe, it } from "node:test"

import { AliasMatcher } from "./matcher.ts"
import { XRAY_SCHEMA_VERSION, type Xray } from "./model.ts"
import {
  chapterIndexForHref,
  findEntity,
  locateSentence,
  ordinalAtProgression,
  ordinalAtTextOffset,
  ordinalOfFragment,
  storySoFar,
  viewXray,
} from "./view.ts"

/**
 * A ranger is called "Strider" from sentence 2. Sentence 1 mentions an
 * "Aragorn" in passing; sentence 7 reveals that Strider is Aragorn.
 */
const xray: Xray = {
  schemaVersion: XRAY_SCHEMA_VERSION,
  generator: { version: 1, model: "test" },
  source: { sha256: "" },
  chapters: [
    { id: "c1", href: "text/c1.xhtml", start: 0, lengths: [10, 10, 20, 10] },
    { id: "c2", href: "text/c2.xhtml", start: 4, lengths: [10, 10, 10, 10] },
  ],
  segments: [
    { start: 0, end: 4, summary: "The hobbits meet a ranger." },
    { start: 4, end: 8, summary: "The ranger reveals his name." },
  ],
  entities: [
    {
      id: 0,
      type: "character",
      names: [
        { text: "Strider", at: 2 },
        { text: "Aragorn", at: 7 },
      ],
      aliases: [
        { text: "Strider", at: 2 },
        { text: "Aragorn", at: 7 },
      ],
      descriptions: [
        { text: "A ranger met at the inn.", at: 3 },
        { text: "The heir of Isildur.", at: 7 },
      ],
      facts: [
        { text: "Sits in the corner of the inn.", sentence: 2, at: 3 },
        { text: "Reveals he is Aragorn.", sentence: 7, at: 7 },
      ],
      mentions: [
        [1, 1],
        [2, 0],
        [5, 0],
        [7, 1],
      ],
    },
    {
      id: 1,
      type: "place",
      names: [{ text: "Bree", at: 0 }],
      aliases: [{ text: "Bree", at: 0 }],
      descriptions: [{ text: "A village.", at: 3 }],
      facts: [],
      mentions: [[0, 0]],
    },
  ],
  sentences: {},
}

void describe("viewXray", () => {
  void it("hides an entity until the text names it", () => {
    assert.deepStrictEqual(
      viewXray(xray, 1).map((view) => view.name),
      ["Bree"],
    )
  })

  void it("shows only what is stamped at or before the position", () => {
    const strider = viewXray(xray, 5).find((view) => view.id === 0)

    assert.deepStrictEqual(strider, {
      id: 0,
      type: "character",
      name: "Strider",
      aliases: ["Strider"],
      description: "A ranger met at the inn.",
      facts: [{ text: "Sits in the corner of the inn.", sentence: 2, at: 3 }],
      // Sentence 1 names "Aragorn", which is not yet tied to Strider.
      mentions: [2, 5],
    })
  })

  void it("withholds a description until its passage is finished", () => {
    assert.strictEqual(viewXray(xray, 2)[0]?.description, null)
  })

  void it("lists an entity under a name the reader has met", () => {
    const early: Xray = {
      ...xray,
      entities: [
        {
          id: 0,
          type: "character",
          names: [{ text: "Aragorn", at: 3 }],
          aliases: [
            { text: "Aragorn", at: 3 },
            { text: "Strider", at: 0 },
          ],
          descriptions: [],
          facts: [],
          mentions: [
            [0, 1],
            [3, 0],
          ],
        },
      ],
    }

    assert.strictEqual(viewXray(early, 2)[0]?.name, "Strider")
    assert.strictEqual(viewXray(early, 3)[0]?.name, "Aragorn")
  })

  void it("adds earlier mentions once a name is revealed", () => {
    const aragorn = viewXray(xray, 7)[0]

    assert.strictEqual(aragorn?.name, "Aragorn")
    assert.deepStrictEqual(aragorn.mentions, [1, 2, 5, 7])
  })
})

void describe("findEntity", () => {
  void it("does not resolve a name the reader has not seen tied", () => {
    assert.strictEqual(findEntity(viewXray(xray, 5), "Aragorn"), null)
    assert.strictEqual(findEntity(viewXray(xray, 7), "Aragorn")?.id, 0)
  })

  void it("does not take a common word for a capitalised name", () => {
    const views = viewXray(
      {
        ...xray,
        entities: [
          {
            id: 0,
            type: "character",
            names: [{ text: "Will", at: 0 }],
            aliases: [{ text: "Will", at: 0 }],
            descriptions: [],
            facts: [],
            mentions: [[0, 0]],
          },
        ],
      },
      5,
    )

    assert.strictEqual(findEntity(views, "will"), null)
    assert.strictEqual(findEntity(views, " Will ")?.id, 0)
  })

  void it("resolves a selection that surrounds a name", () => {
    assert.strictEqual(
      findEntity(viewXray(xray, 5), "said Strider’s voice")?.id,
      0,
    )
  })
})

void describe("storySoFar", () => {
  void it("leaves out the passage being read", () => {
    assert.deepStrictEqual(storySoFar(xray, 6), ["The hobbits meet a ranger."])
  })
})

void describe("chapterIndexForHref", () => {
  const encoded: Xray = {
    ...xray,
    chapters: [
      { id: "c1", href: "Text/chapter%201.xhtml", start: 0, lengths: [1] },
      { id: "c2", href: "Text/chapter 11.xhtml", start: 1, lengths: [1] },
    ],
  }

  void it("matches hrefs whichever side is percent-encoded or rooted", () => {
    assert.strictEqual(
      chapterIndexForHref(encoded, "/OEBPS/Text/chapter 1.xhtml#x"),
      0,
    )
    assert.strictEqual(chapterIndexForHref(encoded, "chapter%2011.xhtml"), 1)
  })

  void it("does not match a file whose name merely ends the same", () => {
    assert.strictEqual(chapterIndexForHref(encoded, "1.xhtml"), -1)
    assert.strictEqual(chapterIndexForHref(encoded, ""), -1)
  })
})

void describe("sentence locations", () => {
  void it("round-trips an ordinal through its element id", () => {
    const location = locateSentence(xray, 6)

    assert.deepStrictEqual(location, {
      chapter: 1,
      href: "text/c2.xhtml",
      sentence: 2,
      fragment: "c2-s2",
      progression: 0.5,
    })
    assert.strictEqual(ordinalOfFragment(xray, "c2-s2"), 6)
    assert.strictEqual(ordinalOfFragment(xray, "c2-s2-w3"), 6)
    assert.strictEqual(ordinalOfFragment(xray, "c2-s9"), null)
  })

  void it("finds the sentence holding an exact amount of text", () => {
    // Chapter c1 has sentences of 10, 10, 20 and 10 characters.
    assert.strictEqual(ordinalAtTextOffset(xray, 0, 0), 0)
    assert.strictEqual(ordinalAtTextOffset(xray, 0, 9), 0)
    assert.strictEqual(ordinalAtTextOffset(xray, 0, 10), 1)
    assert.strictEqual(ordinalAtTextOffset(xray, 0, 39), 2)
    assert.strictEqual(ordinalAtTextOffset(xray, 0, 400), 3)
    assert.strictEqual(ordinalAtTextOffset(xray, 1, 10), 5)
  })

  void it("finds the sentence under a point in a chapter", () => {
    assert.strictEqual(ordinalAtProgression(xray, 0, 0), 0)
    assert.strictEqual(ordinalAtProgression(xray, 0, 0.5), 2)
    assert.strictEqual(ordinalAtProgression(xray, 0, 1), 3)
  })
})

void describe("AliasMatcher", () => {
  const matcher = new AliasMatcher([
    ["Hook", "hook"],
    ["Mr. Darling", "father"],
    ["Darling", "family"],
    ["pixie dust", "dust"],
  ])
  const found = (text: string) => matcher.find(text).map((m) => m.value)

  void it("prefers the longest name at a position", () => {
    assert.deepStrictEqual(found("Mr. Darling sat down."), ["father"])
    assert.deepStrictEqual(found("The Darling children slept."), ["family"])
  })

  void it("keeps a capitalised name apart from the common word", () => {
    assert.deepStrictEqual(found("Hook raised his hook."), ["hook"])
    assert.deepStrictEqual(found("HOOK OR ME THIS TIME"), ["hook"])
  })

  void it("finds a Korean name before its particle", () => {
    const korean = new AliasMatcher([["철수", "cheolsu"]])
    assert.strictEqual(
      korean.find("철수는 학교에 갔다. 철수가 웃었다.").length,
      2,
    )
  })

  void it("finds an accented name however the text encodes it", () => {
    const zoe = new AliasMatcher([["Zoë".normalize("NFC"), "zoe"]])
    assert.strictEqual(zoe.find("Then Zoë laughed.".normalize("NFD")).length, 1)
  })

  void it("matches whole words, through possessives and quotes", () => {
    assert.deepStrictEqual(found("Hooks and Hooked"), [])
    assert.deepStrictEqual(found("Hook’s ship. Pixie dust!"), ["hook", "dust"])
  })
})
