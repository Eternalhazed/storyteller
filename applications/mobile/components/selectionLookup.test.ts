import assert from "node:assert/strict"
import { test } from "vitest"

import {
  MAX_LOOKUP_QUERY_LENGTH,
  type SelectionLookupUrlResult,
  buildSelectionLookupUrl,
  normalizeSelectionLookupText,
  openSelectionLookup,
} from "./selectionLookup"

function requireUrl(result: SelectionLookupUrlResult): string {
  if (!result.ok) throw new Error(`Expected URL, received ${result.reason}`)
  return result.url
}

test("normalizes selected text without losing Unicode", () => {
  assert.equal(
    normalizeSelectionLookupText("  cafe\u0301\n\t society  "),
    "café society",
  )
  assert.equal(normalizeSelectionLookupText(undefined), "")
})

test("builds exact fixed-provider lookup URLs", () => {
  assert.equal(
    requireUrl(buildSelectionLookupUrl("wikipedia", "Saxe-Weimar")),
    "https://en.wikipedia.org/wiki/Special:Search?search=Saxe-Weimar",
  )
  assert.equal(
    requireUrl(buildSelectionLookupUrl("google", "#hashtag? foo")),
    "https://www.google.com/search?q=%23hashtag%3F%20foo",
  )
  assert.equal(
    requireUrl(buildSelectionLookupUrl("wiktionary", "don't")),
    "https://en.wiktionary.org/wiki/Special:Search?search=don't",
  )
})

test("Google reads the expanded selection before closing the toolbar", async () => {
  let selectedText = "Moby"
  const opened: string[] = []
  const getSelectedText = async () => {
    await Promise.resolve()
    return selectedText
  }

  selectedText = "Moby\nDick & the whale"
  await openSelectionLookup("google", getSelectedText, {
    onOpen: () => {
      selectedText = ""
    },
    openUrl: async (url) => {
      opened.push(url)
    },
    openWikipediaApp: async () => assert.fail("Google should open its web URL"),
  })

  assert.equal(opened.length, 1)
  assert.ok(opened[0])
  assert.equal(
    new URL(opened[0]).searchParams.get("q"),
    "Moby Dick & the whale",
  )
})

test("Wikipedia gives its app the full query and falls back to the web when unavailable", async () => {
  for (const appAvailable of [true, false]) {
    const attempts: string[] = []
    await openSelectionLookup("wikipedia", async () => "résumé & café", {
      onOpen: () => {},
      openUrl: async (url) => {
        attempts.push(new URL(url).searchParams.get("search") ?? "")
      },
      openWikipediaApp: async (query) => {
        attempts.push(`app: ${query}`)
        return appAvailable
      },
    })

    assert.deepEqual(
      attempts,
      appAvailable
        ? ["app: résumé & café"]
        : ["app: résumé & café", "résumé & café"],
    )
  }
})

test("keeps URL-like selections inside the chosen origin", () => {
  const url = new URL(
    requireUrl(
      buildSelectionLookupUrl(
        "google",
        "https://malicious.example/?x=1&y=2#fragment",
      ),
    ),
  )

  assert.equal(url.protocol, "https:")
  assert.equal(url.hostname, "www.google.com")
  assert.equal(
    url.searchParams.get("q"),
    "https://malicious.example/?x=1&y=2#fragment",
  )
})

test("supports non-Latin and right-to-left selections", () => {
  const url = requireUrl(
    buildSelectionLookupUrl(
      "wikipedia",
      "\u65e5\u672c\u8a9e \u0643\u062a\u0627\u0628",
    ),
  )
  assert.equal(
    new URL(url).searchParams.get("search"),
    "\u65e5\u672c\u8a9e \u0643\u062a\u0627\u0628",
  )
})

test("rejects blank and overlong selections", () => {
  assert.deepEqual(buildSelectionLookupUrl("wikipedia", " \n\t "), {
    ok: false,
    reason: "empty",
  })
  assert.deepEqual(
    buildSelectionLookupUrl("google", "a".repeat(MAX_LOOKUP_QUERY_LENGTH + 1)),
    { ok: false, reason: "too-long" },
  )
  assert.deepEqual(buildSelectionLookupUrl("google", "\ud800"), {
    ok: false,
    reason: "invalid",
  })
})
