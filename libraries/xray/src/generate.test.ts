import assert from "node:assert"
import { join } from "node:path"

import { describe, it } from "vitest"

import { readBookSource } from "./epub.ts"
import {
  type CallModel,
  type GenerationState,
  STALE_STATE_MESSAGE,
  UnansweredError,
  generateXray,
} from "./generate.ts"
import type { SegmentOutput } from "./registry.ts"
import { type BookText, flattenBook, segmentBook } from "./segments.ts"

const epubPath = join(
  import.meta.dirname,
  "..",
  "..",
  "align",
  "src",
  "__fixtures__",
  "moby-dick-small.epub",
)

/** The numbered sentences of the passage in a prompt. */
function passageOf(prompt: string): string[] {
  const passage = prompt.slice(prompt.indexOf("\nPassage:\n"))
  return [...passage.matchAll(/^\[\d+\] (.*)$/gm)].map(
    (match) => match[1] ?? "",
  )
}

/** A model that reports Ishmael wherever the passage names him. */
function createFakeModel(prompts: string[], failOnCall?: number): CallModel {
  return ({ user }) => {
    if (prompts.length === failOnCall) {
      return Promise.reject(new Error("model unavailable"))
    }
    prompts.push(user)
    const sentence =
      passageOf(user).findIndex((text) => text.includes("Ishmael")) + 1
    const output: SegmentOutput = {
      summary: `Passage ${prompts.length}`,
      entities: sentence
        ? [
            {
              id: null,
              type: "character",
              name: "Ishmael",
              aliases: [],
              description: "The narrator.",
              facts: [{ sentence, text: "Asks to be called Ishmael." }],
            },
          ]
        : [],
    }
    return Promise.resolve({ output, inputTokens: 10, outputTokens: 5 })
  }
}

describe("generateXray", () => {
  it("shows the model the book in order, one passage at a time", async () => {
    const source = await readBookSource(epubPath)
    const book = flattenBook(source.chapters)
    const prompts: string[] = []

    const { xray } = await generateXray(source, {
      model: "fake",
      callModel: createFakeModel(prompts),
      maxSegmentTokens: 600,
    })

    // Each prompt holds exactly its own passage, so no call can see ahead.
    const sent = xray.segments.filter((segment) => segment.summary !== null)
    assert.ok(sent.length > 3)
    assert.deepStrictEqual(
      prompts.map(passageOf),
      sent.map((segment) => book.sentences.slice(segment.start, segment.end)),
    )

    const ishmael = xray.entities[0]
    assert.strictEqual(ishmael?.names[0]?.text, "Ishmael")
    for (const [ordinal] of ishmael.mentions) {
      assert.match(xray.sentences[ordinal] ?? "", /Ishmael|ISHMAEL/)
    }
    assert.strictEqual(ishmael.mentions[0]?.[0], ishmael.names[0].at)
    assert.strictEqual(xray.generator.version, 2)
  })

  it("resumes an interrupted run without rereading", async () => {
    const source = await readBookSource(epubPath)
    const whole = await generateXray(source, {
      model: "fake",
      callModel: createFakeModel([]),
      maxSegmentTokens: 600,
    })

    let saved: GenerationState | undefined
    const prompts: string[] = []
    await assert.rejects(
      generateXray(source, {
        model: "fake",
        callModel: createFakeModel(prompts, 2),
        maxSegmentTokens: 600,
        onCheckpoint: (state) => {
          saved = structuredClone(state)
        },
      }),
      /model unavailable/,
    )
    assert.ok(saved)

    const resumed = await generateXray(source, {
      model: "fake",
      callModel: createFakeModel(prompts),
      maxSegmentTokens: 600,
      resume: saved,
    })

    assert.deepStrictEqual(resumed.xray, whole.xray)
    assert.strictEqual(resumed.inputTokens, whole.inputTokens)
  })
})

describe("generateXray failures", () => {
  it("skips a passage the model cannot answer and reads on", async () => {
    const source = await readBookSource(epubPath)
    const prompts: string[] = []
    const fake = createFakeModel(prompts)
    let calls = 0

    const { xray, skippedSegments } = await generateXray(source, {
      model: "fake",
      callModel: (request) =>
        ++calls === 2
          ? Promise.reject(new UnansweredError("declined", 7, 3))
          : fake(request),
      maxSegmentTokens: 600,
    })

    assert.strictEqual(skippedSegments, 1)
    assert.ok(prompts.length > 2)
    assert.strictEqual(
      xray.segments.filter((segment) => segment.summary !== null).length,
      prompts.length,
    )
  })

  it("refuses progress saved for a differently numbered book", async () => {
    const source = await readBookSource(epubPath)
    let saved: GenerationState | undefined
    await generateXray(source, {
      model: "fake",
      callModel: createFakeModel([]),
      maxSegmentTokens: 600,
      maxSegments: 1,
      onCheckpoint: (state) => {
        saved = structuredClone(state)
      },
    })
    assert.ok(saved)

    // The same file read with different sentence boundaries.
    const renumbered = {
      ...source,
      chapters: source.chapters.map((chapter) => ({
        ...chapter,
        sentences: chapter.sentences.slice(1),
      })),
    }

    await assert.rejects(
      generateXray(renumbered, {
        model: "fake",
        callModel: createFakeModel([]),
        maxSegmentTokens: 600,
        resume: saved,
      }),
      { message: STALE_STATE_MESSAGE },
    )
  })
})

describe("segmentBook", () => {
  const sentence = "word ".repeat(40).trim()
  const book: BookText = {
    chapters: [
      {
        id: "a",
        href: "a.xhtml",
        start: 0,
        lengths: Array<number>(3).fill(199),
      },
      {
        id: "b",
        href: "b.xhtml",
        start: 3,
        lengths: Array<number>(9).fill(199),
      },
    ],
    sentences: Array<string>(12).fill(sentence),
    // In chapter b, paragraphs end after its 4th and 9th sentences.
    endsBlock: [
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      true,
    ],
  }

  it("never lets a passage cross a chapter", () => {
    const segments = segmentBook(book, { maxTokens: 10_000 })

    assert.deepStrictEqual(segments, [
      { start: 0, end: 3 },
      { start: 3, end: 12 },
    ])
  })

  it("joins a sliver at the end of a chapter to the passage before", () => {
    // Three sentences fill the first passage. What is left is too small to
    // be sent on its own, so without joining it the chapter's closing lines
    // would never be read.
    const withTail: BookText = {
      chapters: [
        {
          id: "a",
          href: "a.xhtml",
          start: 0,
          lengths: [199, 199, 199, 199, 8],
        },
      ],
      sentences: [sentence, sentence, sentence, sentence, "The end."],
      endsBlock: [true, true, true, true, true],
    }

    assert.deepStrictEqual(segmentBook(withTail, { maxTokens: 110 }), [
      { start: 0, end: 5 },
    ])
  })

  it("cuts a long chapter at a paragraph break", () => {
    // Chapter b is 450 tokens, so two passages of about 225 each. The even
    // cut falls after its 5th sentence; the paragraph ends one before that
    // and one well after, so the cut waits for neither past the slack.
    const segments = segmentBook(book, { maxTokens: 250 })

    assert.deepStrictEqual(segments, [
      { start: 0, end: 3 },
      { start: 3, end: 9 },
      { start: 9, end: 12 },
    ])
  })
})
