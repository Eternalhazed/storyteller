import assert from "node:assert"

import { describe, it, vi } from "vitest"

import {
  type TestDbContext,
  seedBooks,
  setupTestDb,
} from "@/__tests__/harness/testDb"
import { getBook } from "@/database/books"
import { getJobs } from "@/database/jobs"
import { type UUID } from "@/uuid"
import { getBooksToSync, syncNarrationAutomatically } from "@/work/autoSync"
import {
  enqueueBookAlign,
  recoverInterruptedAlignJobs,
} from "@/work/distributor"

// The sync worker never finishes in these tests.
vi.mock("piscina", () => ({
  default: class {
    run(_task: unknown, options: { signal: AbortSignal }) {
      const run = Promise.withResolvers<undefined>()
      options.signal.addEventListener("abort", () => {
        run.reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
      })
      return run.promise
    }
  },
}))

vi.mock("@/work/seriesLookup", () => ({
  lookUpSeriesForNewBook: () => Promise.resolve(),
}))

function insertJob(ctx: TestDbContext, bookUuid: string, status: string) {
  ctx.sqlite
    .prepare(
      `INSERT INTO job (type, status, book_uuid, started_at) VALUES ('book_align', ?, ?, CURRENT_TIMESTAMP)`,
    )
    .run(status, bookUuid)
}

describe("automatic narration sync", () => {
  it("picks books with both formats that were never synced", async () => {
    using ctx = setupTestDb()
    const [pair, ebookOnly, synced, failed, cancelled, paused, done, legacy] =
      seedBooks(ctx, [
        { title: "Pair", ebook: "/a.epub", audiobook: "/a" },
        { title: "Ebook only", ebook: "/b.epub" },
        {
          title: "Synced",
          ebook: "/c.epub",
          audiobook: "/c",
          readaloud: "/c-ra.epub",
        },
        { title: "Failed", ebook: "/d.epub", audiobook: "/d" },
        { title: "Cancelled", ebook: "/e.epub", audiobook: "/e" },
        { title: "Paused", ebook: "/f.epub", audiobook: "/f" },
        { title: "Done before", ebook: "/g.epub", audiobook: "/g" },
        { title: "Legacy failure", ebook: "/h.epub", audiobook: "/h" },
      ]) as UUID[]
    assert.ok(pair && ebookOnly && synced && failed && legacy)
    insertJob(ctx, failed, "ERROR")
    insertJob(ctx, cancelled!, "CANCELED")
    insertJob(ctx, paused!, "PAUSED")
    insertJob(ctx, done!, "DONE")
    ctx.sqlite
      .prepare(
        `INSERT INTO readaloud (book_uuid, status, current_stage) VALUES (?, 'ERROR', 'TRANSCRIBE_CHAPTERS')`,
      )
      .run(legacy)

    assert.deepStrictEqual(await getBooksToSync(), [pair])
    assert.deepStrictEqual(await getBooksToSync([ebookOnly, failed]), [])
  })

  it("leaves a book whose audiobook went missing", async () => {
    using ctx = setupTestDb()
    const [book] = seedBooks(ctx, [
      { title: "Pair", ebook: "/a.epub", audiobook: "/a" },
    ])
    ctx.sqlite
      .prepare(`UPDATE audiobook SET missing = 1 WHERE book_uuid = ?`)
      .run(book)
    assert.deepStrictEqual(await getBooksToSync(), [])
  })

  it("queues nothing while the setting is off", async () => {
    using ctx = setupTestDb()
    seedBooks(ctx, [{ title: "Pair", ebook: "/a.epub", audiobook: "/a" }])
    await syncNarrationAutomatically()
    assert.deepStrictEqual(await getJobs({ type: "book_align" }), [])
  })

  it("queues each due book once when it is on", async () => {
    using ctx = setupTestDb({ syncNarrationAutomatically: "true" })
    const [book] = seedBooks(ctx, [
      { title: "Pair", ebook: "/a.epub", audiobook: "/a" },
    ])
    await syncNarrationAutomatically()
    await syncNarrationAutomatically([book as UUID])
    const jobs = await getJobs({ type: "book_align" })
    assert.strictEqual(jobs.length, 1)
    assert.strictEqual(jobs[0]?.bookUuid, book)
  })
})

describe("sync queue", () => {
  it("queues one job when several triggers race", async () => {
    using ctx = setupTestDb()
    const [book] = seedBooks(ctx, [
      { title: "Pair", ebook: "/a.epub", audiobook: "/a" },
    ]) as UUID[]
    assert.ok(book)
    const jobs = await Promise.all(
      Array.from({ length: 5 }, () => enqueueBookAlign(book, false)),
    )
    assert.strictEqual(new Set(jobs.map((job) => job.uuid)).size, 1)
    assert.strictEqual((await getJobs({ type: "book_align" })).length, 1)
  })

  it("refuses a second active job for a book at the database", () => {
    using ctx = setupTestDb()
    const [book] = seedBooks(ctx, [{ title: "Pair" }])
    assert.ok(book)
    insertJob(ctx, book, "QUEUED")
    assert.throws(() => {
      insertJob(ctx, book, "PAUSED")
    }, /UNIQUE/)
    insertJob(ctx, book, "DONE")
  })
})

describe("restart recovery", () => {
  it("resumes a sync once, and fails it after a second restart", async () => {
    using ctx = setupTestDb()
    const [book] = seedBooks(ctx, [
      { title: "Pair", ebook: "/a.epub", audiobook: "/a" },
    ]) as UUID[]
    assert.ok(book)
    insertJob(ctx, book, "RUNNING")

    await recoverInterruptedAlignJobs()
    let [job] = await getJobs({ type: "book_align" })
    assert.strictEqual(job?.status, "RUNNING", "picked up again")
    assert.strictEqual(job.interruptedCount, 1)

    await recoverInterruptedAlignJobs()
    ;[job] = await getJobs({ type: "book_align" })
    assert.strictEqual(job?.status, "ERROR")
    assert.match(job.error ?? "", /2 server restarts/)
    assert.strictEqual((await getBook(book))?.readaloud?.status, "ERROR")

    // and it stays failed: automatic sync does not try it again
    assert.deepStrictEqual(await getBooksToSync(), [])
  })

  it("leaves queued and paused syncs as they are", async () => {
    using ctx = setupTestDb()
    const [queued, paused] = seedBooks(ctx, [
      { title: "Queued" },
      { title: "Paused" },
    ])
    insertJob(ctx, queued!, "QUEUED")
    insertJob(ctx, paused!, "PAUSED")
    await recoverInterruptedAlignJobs()
    const jobs = await getJobs({ type: "book_align" })
    assert.deepStrictEqual(
      jobs.map((job) => [job.status, job.interruptedCount]).sort(),
      [
        ["PAUSED", 0],
        ["QUEUED", 0],
      ],
    )
  })
})
