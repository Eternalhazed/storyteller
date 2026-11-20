import assert from "node:assert"
import { describe, it } from "node:test"

import {
  type DraftEntity,
  type SegmentOutput,
  applySegmentOutput,
  pruneSharedTitles,
} from "./registry.ts"

const sentences = [
  "Macro watched the recruits.",
  "The centurion was not impressed.",
  "Cato dropped his sword, and Macro sighed.",
  // second passage
  "Lucius Cornelius Macro had served for fourteen years.",
  "Cato knew none of this.",
]
const first = { start: 0, end: 3 }
const second = { start: 3, end: 5 }

function entity(
  overrides: Partial<SegmentOutput["entities"][number]>,
): SegmentOutput["entities"][number] {
  return {
    id: null,
    type: "character",
    name: "Macro",
    aliases: [],
    description: "A centurion.",
    facts: [],
    ...overrides,
  }
}

void describe("applySegmentOutput", () => {
  void it("stamps a new entity at the sentence that first names it", () => {
    const entities: DraftEntity[] = []
    const rejections = applySegmentOutput(
      entities,
      {
        summary: "",
        entities: [
          entity({ name: "Cato", facts: [{ sentence: 3, text: "Drops it." }] }),
        ],
      },
      first,
      0,
      sentences,
    )

    assert.deepStrictEqual(rejections, [])
    assert.deepStrictEqual(entities[0]?.names, [{ text: "Cato", at: 2 }])
    assert.deepStrictEqual(entities[0].facts, [{ text: "Drops it.", at: 2 }])
    // The description may draw on the whole passage, so it waits for its end.
    assert.deepStrictEqual(entities[0].descriptions, [
      { text: "A centurion.", at: 2 },
    ])
  })

  void it("stamps the listed name where the text first uses it", () => {
    const entities: DraftEntity[] = []
    applySegmentOutput(
      entities,
      {
        summary: "",
        entities: [entity({ name: "Aragorn", aliases: ["Strider"] })],
      },
      { start: 0, end: 3 },
      0,
      [
        "Strider sat in the corner.",
        "Aragorn rose.",
        "Aragorn spoke, and then Aragorn left.",
      ],
    )

    // A reader at the first sentence must not be shown "Aragorn".
    assert.deepStrictEqual(entities[0]?.names, [{ text: "Aragorn", at: 1 }])
    assert.deepStrictEqual(entities[0].aliases, [
      { text: "Aragorn", at: 1 },
      { text: "Strider", at: 0 },
    ])
  })

  void it("drops names the passage does not contain", () => {
    const entities: DraftEntity[] = []
    const rejections = applySegmentOutput(
      entities,
      {
        summary: "",
        entities: [
          entity({ aliases: ["Lucius Cornelius Macro"] }),
          entity({ name: "Vespasian" }),
        ],
      },
      first,
      0,
      sentences,
    )

    assert.deepStrictEqual(
      entities.map((e) => e.aliases.map((alias) => alias.text)),
      [["Macro"]],
    )
    assert.strictEqual(rejections.length, 3)
  })

  void it("drops descriptions offered as names", () => {
    const entities: DraftEntity[] = []
    applySegmentOutput(
      entities,
      { summary: "", entities: [entity({ aliases: ["centurion", "he"] })] },
      first,
      0,
      sentences,
    )

    assert.deepStrictEqual(
      entities[0]?.aliases.map((alias) => alias.text),
      ["Macro"],
    )
  })

  void it("folds a repeat of a known name into the known entity", () => {
    const entities: DraftEntity[] = []
    applySegmentOutput(
      entities,
      { summary: "", entities: [entity({})] },
      first,
      0,
      sentences,
    )
    applySegmentOutput(
      entities,
      {
        summary: "",
        entities: [
          entity({
            name: "Lucius Cornelius Macro",
            aliases: ["Macro"],
            description: "A centurion of fourteen years' service.",
          }),
        ],
      },
      second,
      1,
      sentences,
    )

    assert.strictEqual(entities.length, 1)
    assert.deepStrictEqual(entities[0]?.names, [
      { text: "Macro", at: 0 },
      { text: "Lucius Cornelius Macro", at: 3 },
    ])
    assert.deepStrictEqual(
      entities[0].descriptions.map((description) => description.at),
      [2, 4],
    )
  })

  void it("keeps the known name when no new name backs a change", () => {
    const entities: DraftEntity[] = []
    applySegmentOutput(
      entities,
      { summary: "", entities: [entity({}), entity({ name: "Cato" })] },
      first,
      0,
      sentences,
    )
    applySegmentOutput(
      entities,
      { summary: "", entities: [entity({ id: 0, name: "Cato" })] },
      second,
      1,
      sentences,
    )

    assert.deepStrictEqual(entities[0]?.names, [{ text: "Macro", at: 0 }])
    assert.deepStrictEqual(
      entities[1]?.aliases.map((alias) => alias.text),
      ["Cato"],
    )
  })

  void it("ignores notes whose id and name point at different entities", () => {
    const entities: DraftEntity[] = []
    applySegmentOutput(
      entities,
      { summary: "", entities: [entity({}), entity({ name: "Cato" })] },
      first,
      0,
      sentences,
    )
    const rejections = applySegmentOutput(
      entities,
      {
        summary: "",
        entities: [
          entity({
            id: 0,
            name: "Cato",
            aliases: ["Lucius Cornelius Macro"],
            description: "A clumsy recruit.",
            facts: [{ sentence: 2, text: "Knows none of this." }],
          }),
        ],
      },
      second,
      1,
      sentences,
    )

    // Nothing meant for Cato lands on Macro, or the other way about.
    assert.strictEqual(rejections.length, 1)
    assert.deepStrictEqual(
      entities.map((e) => [
        e.aliases.length,
        e.descriptions.length,
        e.facts.length,
      ]),
      [
        [1, 1, 0],
        [1, 1, 0],
      ],
    )
  })

  void it("drops facts that cite a sentence outside the passage", () => {
    const entities: DraftEntity[] = []
    const rejections = applySegmentOutput(
      entities,
      {
        summary: "",
        entities: [
          entity({
            facts: [
              { sentence: 0, text: "Before the passage." },
              { sentence: 4, text: "After the passage." },
              { sentence: 1, text: "Watches the recruits." },
            ],
          }),
        ],
      },
      first,
      0,
      sentences,
    )

    assert.deepStrictEqual(entities[0]?.facts, [
      { text: "Watches the recruits.", at: 0 },
    ])
    assert.strictEqual(rejections.length, 2)
  })
})

void describe("pruneSharedTitles", () => {
  const draft = (id: number, name: string, aliases: string[]): DraftEntity => ({
    id,
    type: "character",
    names: [{ text: name, at: 0 }],
    aliases: aliases.map((text) => ({ text, at: 0 })),
    descriptions: [],
    facts: [],
    lastSeen: 0,
  })
  const aliasesOf = (entities: DraftEntity[]) =>
    pruneSharedTitles(entities).map((entity) =>
      entity.aliases.map((alias) => alias.text),
    )

  void it("drops a bare title that another entity also carries", () => {
    assert.deepStrictEqual(
      aliasesOf([
        draft(0, "Caius", ["Caius", "Tribune", "Tribune Britannicus"]),
        draft(1, "Lucca", ["Lucca", "Tribune Lucca"]),
      ]),
      [
        ["Caius", "Tribune Britannicus"],
        ["Lucca", "Tribune Lucca"],
      ],
    )
  })

  void it("keeps a title only one entity carries", () => {
    assert.deepStrictEqual(
      aliasesOf([draft(0, "Alaric", ["Alaric", "Bishop", "Bishop Alaric"])]),
      [["Alaric", "Bishop", "Bishop Alaric"]],
    )
  })

  void it("never drops the name an entity is listed under", () => {
    assert.deepStrictEqual(
      aliasesOf([
        draft(0, "Tom", ["Tom"]),
        draft(1, "Tom Bombadil", ["Tom Bombadil"]),
      ]),
      [["Tom"], ["Tom Bombadil"]],
    )
  })
})
