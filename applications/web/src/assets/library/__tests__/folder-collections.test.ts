import assert from "node:assert"

import { describe, it } from "vitest"

import { setupTestDb } from "@/__tests__/harness/testDb"
import { createTestLibrary } from "@/__tests__/harness/testFs"
import { canonicalizePath } from "@/assets/library/scanner/folder"
import { scanLibrary } from "@/assets/library/scanner/scan"
import { getBooks } from "@/database/books"
import { createCollection } from "@/database/collections"
import { createImportRule } from "@/database/importRules"

describe("folder-named collections", () => {
  it("files a new book into the collection its import folder is named after", async () => {
    using _db = setupTestDb()
    await using library = await createTestLibrary("folder-collections")

    const shelf = await createCollection({
      name: "Shley's Bookshelf",
      public: true,
    })
    await createCollection({ name: "David", public: true })

    await library.createBookFolder("shley's bookshelf/Moby Dick", {
      ebook: "moby-dick",
    })
    await createImportRule({
      kind: "watch",
      path: await canonicalizePath(library.root),
      importMode: "reference",
    })

    await scanLibrary({
      source: "manual",
      signal: new AbortController().signal,
    })

    const [book] = await getBooks()
    assert.ok(book)
    assert.deepStrictEqual(
      book.collections.map((collection) => collection.uuid),
      [shelf.uuid],
    )
  })

  it("leaves books in other folders out of every collection", async () => {
    using _db = setupTestDb()
    await using library = await createTestLibrary("folder-collections-none")

    await createCollection({ name: "David", public: true })
    await library.createBookFolder("Moby Dick", { ebook: "moby-dick" })
    await createImportRule({
      kind: "watch",
      path: await canonicalizePath(library.root),
      importMode: "reference",
    })

    await scanLibrary({
      source: "manual",
      signal: new AbortController().signal,
    })

    const [book] = await getBooks()
    assert.ok(book)
    assert.deepStrictEqual(book.collections, [])
  })
})
