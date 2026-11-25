import { describe, expect, it } from "vitest"

import {
  applyDiversity,
  lengthBucket,
  preferencePenalty,
} from "@/recommendations/weighting"

describe("series preferences", () => {
  it("weighs crossed preferences instead of filtering, and says so", () => {
    const prefs = {
      seriesShape: "series" as const,
      seriesLength: "long" as const,
      needsAudio: false,
    }
    expect(
      preferencePenalty({ seriesBooks: 14, hasAudio: true }, prefs),
    ).toEqual({ penalty: 0, label: null })
    expect(
      preferencePenalty({ seriesBooks: 6, hasAudio: true }, prefs),
    ).toEqual({
      penalty: 10,
      label: "Shorter: 6 books",
    })
    expect(
      preferencePenalty({ seriesBooks: 3, hasAudio: true }, prefs),
    ).toEqual({
      penalty: 25,
      label: "Shorter: 3 books",
    })
    expect(
      preferencePenalty({ seriesBooks: null, hasAudio: true }, prefs),
    ).toEqual({
      penalty: 15,
      label: "Standalone",
    })
  })

  it("applies nothing for Any and Either", () => {
    const prefs = {
      seriesShape: "either" as const,
      seriesLength: "any" as const,
      needsAudio: false,
    }
    expect(
      preferencePenalty({ seriesBooks: 3, hasAudio: true }, prefs).penalty,
    ).toBe(0)
    expect(
      preferencePenalty({ seriesBooks: null, hasAudio: false }, prefs).penalty,
    ).toBe(0)
  })

  it("marks books without an audiobook for a reader who listens", () => {
    const prefs = {
      seriesShape: "either" as const,
      seriesLength: "any" as const,
      needsAudio: true,
    }
    expect(
      preferencePenalty({ seriesBooks: null, hasAudio: false }, prefs),
    ).toEqual({
      penalty: 20,
      label: "Ebook only",
    })
  })

  it("buckets series by their main books", () => {
    expect([1, 2, 4, 5, 9, 10].map(lengthBucket)).toEqual([
      null,
      "short",
      "short",
      "medium",
      "medium",
      "long",
    ])
  })
})

describe("diversity", () => {
  it("allows two per author, one per series, one stretch, best first", () => {
    const item = (
      identity: string,
      author: string,
      score: number,
      extra = {},
    ) => ({
      identity,
      authors: [author],
      seriesKey: null as string | null,
      stretch: false,
      score,
      ...extra,
    })
    const kept = applyDiversity(
      [
        item("a1", "Ann", 90),
        item("a2", "Ann", 80),
        item("a3", "Ann", 95),
        item("s1", "Sam", 70, { seriesKey: "x" }),
        item("s2", "Sid", 85, { seriesKey: "x" }),
        item("t1", "Tom", 60, { stretch: true }),
        item("t2", "Tim", 65, { stretch: true }),
      ],
      10,
    )
    expect(kept.map((each) => each.identity)).toEqual(["a3", "a1", "s2", "t2"])
  })
})
