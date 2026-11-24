import assert from "node:assert"
import { randomUUID } from "node:crypto"
import { join } from "node:path"

import { describe, it } from "vitest"

import { setupTestDb } from "@/__tests__/harness/testDb"
import { createTestLibrary } from "@/__tests__/harness/testFs"
import { scan } from "@/assets/library/scanner/scan"
import { type Candidate } from "@/assets/library/scanner/types"
import { getBook } from "@/database/books"

async function importEbook(candidate: Candidate) {
  await scan({
    source: "api",
    request: { kind: "candidates", candidates: [candidate] },
    options: { force: true },
    signal: new AbortController().signal,
  })
}

describe("attach if missing", () => {
  it("leaves a format the book already has, and creates the book once", async () => {
    using _db = setupTestDb()
    await using library = await createTestLibrary("attach-if-missing")
    const first = await library.createBookFolder("first", {
      ebook: "moby-dick",
    })
    const second = await library.createBookFolder("second", {
      ebook: "moby-dick",
    })
    const bookUuid = randomUUID()
    const candidate = (folder: string): Candidate => ({
      folder,
      format: "ebook",
      filepath: join(folder, "moby-dick.epub"),
      bookUuidHint: bookUuid,
      attachIfMissing: true,
      importMode: "reference",
    })

    await importEbook(candidate(first.path))
    const created = await getBook(bookUuid)
    assert.strictEqual(
      created?.ebook?.filepath,
      join(first.path, "moby-dick.epub"),
    )

    // a repeat with other files must not replace the ebook
    await importEbook(candidate(second.path))
    const after = await getBook(bookUuid)
    assert.strictEqual(after?.ebook?.filepath, created.ebook.filepath)
  })
})
