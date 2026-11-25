import { describe, expect, it } from "vitest"

import {
  authorKey,
  mainTitle,
  normalizeText,
  sameWork,
  workIdentity,
} from "@/catalog/normalize"

describe("work identity", () => {
  it("folds accents, punctuation, conjunctions, articles, and whitespace", () => {
    expect(normalizeText("  Thé  Présence  &  The FUTURE! ")).toBe(
      "presence and the future",
    )
    expect(mainTitle("The Post Captain (Aubrey/Maturin, #2)")).toBe(
      "post captain",
    )
    expect(mainTitle("Post Captain: A Novel")).toBe("post captain")
    expect(mainTitle("Post Captain; An Adventure")).toBe("post captain")
    expect(mainTitle("Master & Commander")).toBe(
      mainTitle("Master and Commander"),
    )
  })

  it("matches reordered names without conflating authors who share a surname", () => {
    expect(authorKey("O'Brian, Patrick")).toBe(authorKey("Patrick O’Brian"))
    expect(authorKey("O'Brian, Patrick")).not.toBe(authorKey("John O'Brian"))
    expect(authorKey("A. Doe")).not.toBe(authorKey("Doe"))
    expect(
      workIdentity("Post Captain (Aubrey/Maturin, #2)", [
        "O'Brian, Patrick",
        "Other Author",
      ]),
    ).toBe("post captain|patrick obrian")
  })

  it("requires nonempty titles and any shared author", () => {
    const work = { title: "Post Captain", authors: ["Patrick O'Brian"] }
    expect(
      sameWork(work, {
        title: "The Post Captain",
        authors: ["Other Author", "O'Brian, Patrick"],
      }),
    ).toBe(true)
    expect(sameWork(work, { ...work, title: "Master and Commander" })).toBe(
      false,
    )
    expect(sameWork(work, { ...work, authors: [] })).toBe(false)
    expect(sameWork(work, { ...work, authors: ["John O'Brian"] })).toBe(false)
    expect(sameWork({ ...work, title: "The" }, { ...work, title: "A" })).toBe(
      false,
    )
    expect(
      sameWork({ ...work, authors: [""] }, { ...work, authors: [" "] }),
    ).toBe(false)
  })
})
