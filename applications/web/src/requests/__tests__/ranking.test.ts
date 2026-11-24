import assert from "node:assert"

import { describe, it } from "vitest"

import {
  type RankingContext,
  rankReleases,
  recommendPair,
} from "@/requests/ranking"
import { type Release } from "@/requests/types"

import recorded from "./fixtures/searchResults.json"

const releases = recorded.releases as Release[]
const context: RankingContext = {
  work: recorded.work,
  editionNarrators: recorded.editionNarrators,
}

describe("ranking recorded search results", () => {
  const audio = rankReleases(releases, "audio", context)
  const ebooks = rankReleases(releases, "ebook", context)

  it("puts the reader's narrator, unabridged, single M4B first, and drops dead releases", () => {
    assert.deepStrictEqual(
      audio.map((release) => release.id),
      [
        "a-farley-m4b",
        "a-farley-mp3",
        "a-abridged",
        "a-popular-unverified",
        "a-pack",
        "a-german",
        "a-thin",
      ],
    )
  })

  it("lists packs, thin audio and other languages, but never recommends them", () => {
    const excluded = Object.fromEntries(
      audio.map((release) => [release.id, release.excluded]),
    )
    assert.strictEqual(excluded["a-pack"], "Contains more than one book")
    assert.strictEqual(excluded["a-thin"], "Audio at 32 kbps")
    assert.strictEqual(excluded["a-german"], "In another language (de)")
    assert.strictEqual(excluded["a-farley-m4b"], null)
  })

  it("only trusts a narrator from a structured field", () => {
    const popular = audio.find(
      (release) => release.id === "a-popular-unverified",
    )
    assert.ok(popular?.flags.includes("narrator-unverified"))
  })

  it("rejects ebooks without an EPUB and flags other books", () => {
    assert.deepStrictEqual(
      ebooks.map((release) => [release.id, release.excluded, release.flags]),
      [
        ["e-epub", null, ["few-seeders"]],
        ["e-other-book", null, ["title-differs"]],
        ["e-mobi", "No EPUB file", []],
      ],
    )
  })

  it("recommends a pair with the reasons that decided it", () => {
    const pair = recommendPair(ebooks, audio, context)
    assert.strictEqual(pair.ebook?.id, "e-epub")
    assert.strictEqual(pair.audio?.id, "a-farley-m4b")
    assert.deepStrictEqual(pair.reasons, [
      "Same narrator as your other books in this series",
      "Unabridged",
      "One chaptered file",
      "14 seeders",
      "Ebook: 2 seeders",
    ])
  })

  it("recommends nothing rather than a pack or the wrong book", () => {
    const onlyBad = rankReleases(
      releases.filter((release) =>
        ["a-pack", "e-other-book"].includes(release.id),
      ),
      "audio",
      context,
    )
    const ebookOnlyBad = rankReleases(
      releases.filter((release) => release.id === "e-other-book"),
      "ebook",
      context,
    )
    const pair = recommendPair(ebookOnlyBad, onlyBad, context)
    assert.strictEqual(pair.audio, null)
    assert.strictEqual(pair.ebook, null)
  })
})
