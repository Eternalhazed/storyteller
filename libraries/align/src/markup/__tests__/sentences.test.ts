import assert from "node:assert"
import { describe, it } from "node:test"

import { Epub, type ParsedXml } from "@storyteller-platform/epub"

import { markupChapter } from "../markup.ts"
import { getChapterSentences } from "../sentences.ts"

const chapter = /* xml */ `
<?xml version="1.0" encoding="UTF-8"?>

<html>
  <head>
    <title>Loomings</title>
  </head>
  <body>
    <h1>Loomings</h1>
    <p>
        Call me Ishmael. Some years ago—never mind how long precisely—I
        thought I would sail about a little and see the watery part of the
        world.
    </p>
    <p>   </p>
    <p>This is my substitute for pistol and ball. I quietly take to the ship.</p>
  </body>
</html>
`

void describe("getChapterSentences", () => {
  void it("numbers sentences the way markupChapter ids them", async () => {
    const locale = new Intl.Locale("en-US")

    const sentences = await getChapterSentences(
      Epub.xhtmlParser.parse(chapter) as ParsedXml,
      locale,
    )
    const { markedUp } = await markupChapter(
      "ch1",
      Epub.xhtmlParser.parse(chapter) as ParsedXml,
      "sentence",
      locale,
    )

    const spans = [
      ...(Epub.xhtmlBuilder.build(markedUp) as string).matchAll(
        /<span id="ch1-s(\d+)">([^<]*)<\/span>/g,
      ),
    ]

    assert.strictEqual(sentences.length, 5)
    assert.deepStrictEqual(
      spans.map((span) => Number(span[1])),
      sentences.map((_, index) => index),
    )
    assert.deepStrictEqual(
      spans.map((span) => span[2]?.replace(/\s+/g, " ").trim()),
      sentences.map((sentence) => sentence.text.replace(/\s+/g, " ").trim()),
    )
  })

  void it("marks the sentence that closes each text block", async () => {
    const sentences = await getChapterSentences(
      Epub.xhtmlParser.parse(chapter) as ParsedXml,
      new Intl.Locale("en-US"),
    )

    assert.deepStrictEqual(
      sentences.map((sentence) => sentence.endsBlock),
      [true, false, true, false, true],
    )
  })
})
