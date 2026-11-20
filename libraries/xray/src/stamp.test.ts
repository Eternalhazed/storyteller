import assert from "node:assert"
import { describe, it } from "node:test"

import { buildIndex } from "./generate.ts"
import type { DraftEntity } from "./registry.ts"
import { stampEntities } from "./stamp.ts"
import { findEntity, viewXray } from "./view.ts"

/** Two passages: sentences 0 to 9, and 10 to 19. */
const segments = [
  { start: 0, end: 10 },
  { start: 10, end: 20 },
]

function draft(
  id: number,
  name: string,
  aliases: [text: string, at: number][],
  facts: [text: string, at: number][] = [],
): DraftEntity {
  return {
    id,
    type: "character",
    names: [{ text: name, at: 0 }],
    aliases: aliases.map(([text, at]) => ({ text, at })),
    descriptions: [],
    facts: facts.map(([text, at]) => ({ text, at })),
    lastSeen: 0,
  }
}

const stampsOf = (entity: { aliases: { text: string; at: number }[] }) =>
  Object.fromEntries(entity.aliases.map((alias) => [alias.text, alias.at]))

void describe("stampEntities", () => {
  void it("shows the name an entity enters under where it appears", () => {
    const [strider] = stampEntities(
      [draft(0, "Strider", [["Strider", 2]])],
      segments,
    )

    assert.deepStrictEqual(stampsOf(strider!), { Strider: 2 })
    assert.deepStrictEqual(strider!.names, [{ text: "Strider", at: 2 }])
  })

  void it("holds an unrelated second name until its passage ends", () => {
    // "Aragorn" is first written at 13, but only the passage as a whole
    // (10 to 19) says that he is Strider.
    const [strider] = stampEntities(
      [
        {
          ...draft(0, "Strider", [
            ["Strider", 2],
            ["Aragorn", 13],
          ]),
          names: [
            { text: "Strider", at: 2 },
            { text: "Aragorn", at: 13 },
          ],
        },
      ],
      segments,
    )

    assert.deepStrictEqual(stampsOf(strider!), { Strider: 2, Aragorn: 19 })
    assert.deepStrictEqual(strider!.names, [
      { text: "Strider", at: 2 },
      { text: "Aragorn", at: 19 },
    ])
  })

  void it("shows a fuller or shorter form of a known name at once", () => {
    const [hook] = stampEntities(
      [
        draft(0, "Hook", [
          ["James Hook", 3],
          ["Hook", 4],
          ["Captain Hook", 12],
        ]),
      ],
      segments,
    )

    assert.deepStrictEqual(stampsOf(hook!), {
      "James Hook": 3,
      Hook: 4,
      "Captain Hook": 12,
    })
  })

  void it("does not let a shared title tie two names together", () => {
    const [nemo] = stampEntities(
      [
        draft(0, "Captain Smith", [
          ["Captain Smith", 1],
          ["Captain Nemo", 12],
        ]),
        draft(1, "Captain Hook", [["Captain Hook", 5]]),
      ],
      segments,
    )

    assert.deepStrictEqual(stampsOf(nemo!), {
      "Captain Smith": 1,
      "Captain Nemo": 19,
    })
  })

  void it("keeps a fact's sentence but holds it to the end of its passage", () => {
    const [strider] = stampEntities(
      [draft(0, "Strider", [["Strider", 2]], [["Sits in the corner.", 2]])],
      segments,
    )

    assert.deepStrictEqual(strider!.facts, [
      { text: "Sits in the corner.", sentence: 2, at: 9 },
    ])
  })
})

void describe("buildIndex", () => {
  const sentences = new Map([
    [2, "Strider sat in the corner."],
    [13, "Gandalf had written of one called Aragorn."],
    [16, "“I am Aragorn,” said Strider."],
  ])
  const index = buildIndex(
    [
      draft(0, "Strider", [
        ["Strider", 2],
        ["Aragorn", 13],
      ]),
    ],
    segments,
    sentences,
  )
  const xray = {
    schemaVersion: 1 as const,
    generator: { version: 1, model: "test" },
    source: { sha256: "" },
    chapters: [],
    segments: segments.map((segment) => ({ ...segment, summary: null })),
    ...index,
  }

  void it("does not reveal a name before the passage that ties it ends", () => {
    const view = viewXray(xray, 16)[0]

    assert.deepStrictEqual(view?.aliases, ["Strider"])
    assert.strictEqual(findEntity(viewXray(xray, 16), "Aragorn"), null)
    assert.strictEqual(findEntity(viewXray(xray, 19), "Aragorn")?.id, 0)
  })

  void it("counts a sentence as soon as the reader knows one of its names", () => {
    // Sentence 16 uses both names. It is a mention of Strider at once, not
    // only when "Aragorn" becomes visible at 19.
    assert.deepStrictEqual(viewXray(xray, 16)[0]?.mentions, [2, 16])
    assert.deepStrictEqual(viewXray(xray, 19)[0]?.mentions, [2, 13, 16])
  })
})
