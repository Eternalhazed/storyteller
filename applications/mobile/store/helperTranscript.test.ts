import { type HelperTurn } from "@storyteller/web/src/recommendations/helper"
import { describe, expect, test } from "vitest"

import { helperHistory } from "./helperTranscript"

const lookup: HelperTurn = {
  reply: "I'll look that up.",
  chips: [],
  result: {
    intent: "get",
    cards: [
      {
        work: {
          title: "The Gates of Rome",
          authors: ["Conn Iggulden"],
          series: { name: "Emperor", position: 1 },
          language: "en",
          ids: {},
          key: "audible:1",
          coverUrl: null,
          releaseDate: null,
          runtimeMinutes: null,
          pages: null,
          narrators: [],
          description: null,
        },
        series: null,
        state: "get",
        bookUuid: null,
      },
    ],
    questions: [],
    notFound: ["The Glass Lighthouse"],
  },
}

describe("helper history", () => {
  test("carries the books a reply showed, so a follow-up can name them", () => {
    const [, helper, reader] = helperHistory([
      { role: "reader", text: "Get me The Gates of Rome" },
      { role: "helper", text: lookup.reply, turn: lookup },
      { role: "reader", text: "No, the second one in that series" },
    ])
    expect(helper).toEqual({
      role: "helper",
      text: "I'll look that up.\n[Shown: The Gates of Rome by Conn Iggulden (Emperor #1), can be requested; not found: The Glass Lighthouse]",
    })
    expect(reader).toEqual({
      role: "reader",
      text: "No, the second one in that series",
    })
  })

  test("stays within the server's message limits", () => {
    const long = { ...lookup, reply: "x".repeat(990) }
    const entries = Array.from({ length: 30 }, () => ({
      role: "helper" as const,
      text: long.reply,
      turn: long,
    }))
    const history = helperHistory(entries)
    expect(history).toHaveLength(20)
    expect(Math.max(...history.map((each) => each.text.length))).toBe(1000)
  })
})
