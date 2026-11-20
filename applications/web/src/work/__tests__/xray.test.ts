import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { on } from "node:events"
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, it } from "vitest"

import {
  type BookSource,
  type CallModel,
  type GenerationState,
  UnansweredError,
  XRAY_GENERATOR_VERSION,
  xraySchema,
} from "@storyteller/xray"

import { seedBooks, seedUser, setupTestDb } from "@/__tests__/harness/testDb"
import {
  notifyEbookImported,
  setEbookImportHandler,
} from "@/assets/library/scanner/ebook-import"
import { getXrayFilepath, getXrayStateFilepath } from "@/assets/paths"
import { deleteBook, getBook } from "@/database/books"
import {
  type JobType,
  createJob,
  getJob,
  getJobs,
  updateJob,
} from "@/database/jobs"
import { XRAY_DIR } from "@/directories"
import { JobEvents } from "@/jobEvents"
import { encryptSecret } from "@/secrets"
import type { UUID } from "@/uuid"
import {
  backfillXray,
  cancelJob,
  maybeEnqueueBookXray,
  pauseJob,
  pump,
  reorderJobs,
  resumeJob,
} from "@/work/distributor"
import { type XraySourceReader, runXrayJob } from "@/work/xray"

const source: BookSource = {
  sha256: "test-source-fingerprint",
  chapters: [
    {
      id: "first",
      href: "first.xhtml",
      sentences: [
        {
          text: "A sailor walks across the deck and watches the sea. ".repeat(
            25,
          ),
          endsBlock: true,
        },
      ],
    },
    {
      id: "second",
      href: "second.xhtml",
      sentences: [
        {
          text: "The crew prepares the ship and sets out on its voyage. ".repeat(
            25,
          ),
          endsBlock: true,
        },
      ],
    },
  ],
}

const fakeModel: CallModel = () =>
  Promise.resolve({
    output: { summary: "A passage has been read.", entities: [] },
    inputTokens: 10,
    outputTokens: 5,
  })

async function setupBook() {
  const ctx = setupTestDb()
  const folder = await mkdtemp(join(tmpdir(), "storyteller-xray-worker-test-"))
  const ebook = join(folder, "source.epub")
  await writeFile(ebook, "test-only source ebook")
  const bookUuid = seedBooks(ctx, [
    {
      title: "X-Ray worker test",
      ebook,
      // Deliberately not an EPUB: X-Ray must never read the readaloud path.
      readaloud: join(folder, "not-an-ebook.epub"),
    },
  ])[0]! as UUID
  await mkdir(XRAY_DIR, { recursive: true })

  return {
    ctx,
    bookUuid,
    readSource: ((task, signal) => {
      assert.equal(task.epubPath, ebook)
      signal?.throwIfAborted()
      return Promise.resolve(source)
    }) satisfies XraySourceReader,
    async job(type: JobType = "book_xray", queued = false) {
      const job = await createJob({
        type,
        bookUuid,
        restart: false,
        config: null,
        position: (await getJobs()).length,
      })
      if (queued) {
        const queuedJob = await getJob(job.uuid)
        assert.ok(queuedJob)
        return queuedJob
      }
      return updateJob(job.uuid, { status: "RUNNING" })
    },
    async [Symbol.asyncDispose]() {
      await rm(getXrayFilepath(bookUuid), { force: true })
      await rm(getXrayStateFilepath(bookUuid), { force: true })
      await rm(folder, { recursive: true, force: true })
      ctx[Symbol.dispose]()
    },
  }
}

async function waitForFinishedJob(
  uuid: UUID,
  expected: "DONE" | "ERROR" | "PAUSED" = "DONE",
) {
  const events = on(JobEvents, "message")
  try {
    for (
      let job = await getJob(uuid);
      job?.status !== expected;
      job = await getJob(uuid)
    ) {
      assert.ok(job, "X-Ray job disappeared")
      if (job.status === "ERROR" && expected !== "ERROR") {
        assert.fail(job.error ?? "X-Ray job failed")
      }
      await events.next()
    }
    // DONE is emitted just before the distributor releases its admission slot.
    while (globalThis.xrayJobControllers?.has(uuid)) await Promise.resolve()
  } finally {
    await events.return?.()
  }
}

describe("X-Ray generation jobs", () => {
  it("writes the source ebook's X-Ray atomically and removes saved state", async () => {
    await using fixture = await setupBook()
    const before = (await getBook(fixture.bookUuid))?.readaloud
    const job = await fixture.job()
    await runXrayJob(job, {
      callModel: fakeModel,
      readSource: fixture.readSource,
    })

    const result = xraySchema.parse(
      JSON.parse(await readFile(getXrayFilepath(fixture.bookUuid), "utf-8")),
    )
    assert.ok(result.chapters.length > 0)
    assert.equal((await getJob(job.uuid))?.status, "DONE")
    assert.equal((await getJob(job.uuid))?.progress, 1)
    await assert.rejects(stat(getXrayStateFilepath(fixture.bookUuid)), {
      code: "ENOENT",
    })
    assert.ok(
      !(await readdir(XRAY_DIR)).some(
        (name) =>
          name.startsWith(`${fixture.bookUuid}.`) && name.endsWith(".tmp"),
      ),
    )
    assert.deepEqual((await getBook(fixture.bookUuid))?.readaloud, before)
  })

  it("retains completed passages on failure and resumes without repeating them", async () => {
    await using fixture = await setupBook()
    const before = (await getBook(fixture.bookUuid))?.readaloud
    const finishedPrompts: string[] = []
    let failedPrompt = ""
    const first = await fixture.job()
    await runXrayJob(first, {
      readSource: fixture.readSource,
      callModel: (request) => {
        if (finishedPrompts.length === 1) {
          failedPrompt = request.user
          return Promise.reject(new Error("fake model unavailable"))
        }
        finishedPrompts.push(request.user)
        return fakeModel(request)
      },
    })
    assert.ok(failedPrompt, "fixture must contain more than one model passage")
    const state = JSON.parse(
      await readFile(getXrayStateFilepath(fixture.bookUuid), "utf-8"),
    ) as GenerationState
    assert.ok(state.nextSegment > 0)
    assert.equal((await getJob(first.uuid))?.status, "ERROR")
    assert.match(
      (await getJob(first.uuid))?.error ?? "",
      /fake model unavailable/,
    )

    const resumedPrompts: string[] = []
    const second = await fixture.job()
    await runXrayJob(second, {
      readSource: fixture.readSource,
      callModel: (request) => {
        resumedPrompts.push(request.user)
        return fakeModel(request)
      },
    })
    assert.equal((await getJob(second.uuid))?.status, "DONE")
    assert.equal(resumedPrompts[0], failedPrompt)
    assert.ok(!resumedPrompts.includes(finishedPrompts[0]!))
    await assert.rejects(stat(getXrayStateFilepath(fixture.bookUuid)), {
      code: "ENOENT",
    })
    assert.deepEqual((await getBook(fixture.bookUuid))?.readaloud, before)
  })

  it("discards incompatible saved progress and starts over", async () => {
    await using fixture = await setupBook()
    await writeFile(
      getXrayStateFilepath(fixture.bookUuid),
      JSON.stringify({
        sha256: "a-different-book",
        segmentCount: 0,
        nextSegment: 0,
        entities: [],
        summaries: [],
        inputTokens: 0,
        outputTokens: 0,
      }),
    )
    const job = await fixture.job()
    await runXrayJob(job, {
      callModel: fakeModel,
      readSource: fixture.readSource,
    })
    assert.equal((await getJob(job.uuid))?.status, "DONE")
    await assert.rejects(stat(getXrayStateFilepath(fixture.bookUuid)), {
      code: "ENOENT",
    })
  })

  it("checkpoints an in-flight passage before pausing", async () => {
    await using fixture = await setupBook()
    const controller = new AbortController()
    const job = await fixture.job()
    await runXrayJob(job, {
      readSource: fixture.readSource,
      signal: controller.signal,
      getAbortIntent: () => "pause",
      callModel: (request) => {
        controller.abort()
        return fakeModel(request)
      },
    })
    assert.equal((await getJob(job.uuid))?.status, "PAUSED")
    const state = JSON.parse(
      await readFile(getXrayStateFilepath(fixture.bookUuid), "utf-8"),
    ) as GenerationState
    assert.ok(state.nextSegment > 0)
    assert.ok(state.inputTokens > 0)
    await assert.rejects(stat(getXrayFilepath(fixture.bookUuid)), {
      code: "ENOENT",
    })
  })

  it("fails before reading or calling the model when X-Ray storage is not writable", async () => {
    await using fixture = await setupBook()
    const job = await fixture.job()
    const probe = join(XRAY_DIR, `${job.uuid}.write-test`)
    await mkdir(probe)
    let readSource = false
    let calledModel = false
    try {
      await runXrayJob(job, {
        readSource: () => {
          readSource = true
          return Promise.resolve(source)
        },
        callModel: (request) => {
          calledModel = true
          return fakeModel(request)
        },
      })
      assert.equal((await getJob(job.uuid))?.status, "ERROR")
      assert.match(
        (await getJob(job.uuid))?.error ?? "",
        /Cannot write to the X-Ray data directory/,
      )
      assert.equal(readSource, false)
      assert.equal(calledModel, false)
    } finally {
      await rm(probe, { recursive: true, force: true })
    }
  })

  it("finishes with an index when the model cannot answer a passage", async () => {
    await using fixture = await setupBook()
    const job = await fixture.job()
    await runXrayJob(job, {
      readSource: fixture.readSource,
      callModel: () =>
        Promise.reject(new UnansweredError("test passage cannot be answered")),
    })
    assert.equal((await getJob(job.uuid))?.status, "DONE")
    xraySchema.parse(
      JSON.parse(await readFile(getXrayFilepath(fixture.bookUuid), "utf-8")),
    )
    await assert.rejects(stat(getXrayStateFilepath(fixture.bookUuid)), {
      code: "ENOENT",
    })
  })
})

describe("independent X-Ray queue lane", { timeout: 30_000 }, () => {
  it("recovers a running X-Ray job while alignment is busy and admits only one X-Ray job", async () => {
    await using fixture = await setupBook()
    const alignment = await fixture.job("book_align")
    assert.ok(globalThis.jobControllers)
    globalThis.jobControllers.set(alignment.uuid, new AbortController())
    const interrupted = await fixture.job()
    const queued = await fixture.job("book_xray", true)
    const entered = Promise.withResolvers<null>()
    const release = Promise.withResolvers<null>()
    let held = false
    const model: CallModel = async (request) => {
      if (!held) {
        held = true
        entered.resolve(null)
        await release.promise
      }
      return fakeModel(request)
    }

    try {
      const running = pump(model, fixture.readSource)
      await entered.promise
      await pump(model, fixture.readSource)
      assert.equal((await getJob(alignment.uuid))?.status, "RUNNING")
      assert.equal((await getJob(interrupted.uuid))?.status, "RUNNING")
      assert.equal((await getJob(queued.uuid))?.status, "QUEUED")
      assert.equal(globalThis.xrayJobControllers?.size, 1)
      release.resolve(null)
      await running
      await waitForFinishedJob(interrupted.uuid)
      await waitForFinishedJob(queued.uuid)
    } finally {
      release.resolve(null)
      await updateJob(alignment.uuid, { status: "DONE" })
      globalThis.jobControllers.delete(alignment.uuid)
    }
  })

  it("fails cleanly and frees the lane when reading the source fails", async () => {
    await using fixture = await setupBook()
    const before = (await getBook(fixture.bookUuid))?.readaloud
    const failed = await fixture.job("book_xray", true)
    let calledModel = false
    await pump(
      (request) => {
        calledModel = true
        return fakeModel(request)
      },
      () => Promise.reject(new Error("source worker crashed")),
    )
    await waitForFinishedJob(failed.uuid, "ERROR")
    assert.match(
      (await getJob(failed.uuid))?.error ?? "",
      /source worker crashed/,
    )
    assert.equal(calledModel, false)
    assert.equal(globalThis.xrayJobControllers?.size, 0)
    assert.deepEqual((await getBook(fixture.bookUuid))?.readaloud, before)

    const next = await fixture.job("book_xray", true)
    await pump(fakeModel, fixture.readSource)
    await waitForFinishedJob(next.uuid)
    assert.equal((await getJob(next.uuid))?.status, "DONE")
  })

  it("pauses while the source worker is reading without calling the model", async () => {
    await using fixture = await setupBook()
    const job = await fixture.job("book_xray", true)
    const entered = Promise.withResolvers<null>()
    let calledModel = false
    const running = pump(
      (request) => {
        calledModel = true
        return fakeModel(request)
      },
      (_task, signal) => {
        assert.ok(signal)
        entered.resolve(null)
        const pending = Promise.withResolvers<BookSource>()
        signal.addEventListener(
          "abort",
          () => {
            pending.reject(new DOMException("Reading aborted", "AbortError"))
          },
          { once: true },
        )
        return pending.promise
      },
    )
    await entered.promise
    await pauseJob(job.uuid)
    await running
    await waitForFinishedJob(job.uuid, "PAUSED")
    assert.equal(calledModel, false)
    assert.equal(globalThis.xrayJobControllers?.size, 0)
    await assert.rejects(stat(getXrayStateFilepath(fixture.bookUuid)), {
      code: "ENOENT",
    })
  })

  it("pauses, resumes, reorders, and cancels queued X-Ray jobs without changing readaloud status", async () => {
    await using fixture = await setupBook()
    const before = (await getBook(fixture.bookUuid))?.readaloud
    const reservation = randomUUID()
    assert.ok(globalThis.xrayJobControllers)
    globalThis.xrayJobControllers.set(reservation, new AbortController())
    try {
      const first = await fixture.job("book_xray", true)
      const second = await fixture.job("book_xray", true)
      await pauseJob(first.uuid)
      assert.equal((await getJob(first.uuid))?.status, "PAUSED")
      await resumeJob(first.uuid)
      assert.equal((await getJob(first.uuid))?.status, "QUEUED")
      await reorderJobs([first.uuid, second.uuid])
      assert.deepEqual(
        (await getJobs({ type: "book_xray", statuses: ["QUEUED"] })).map(
          (job) => job.uuid,
        ),
        [first.uuid, second.uuid],
      )
      await cancelJob(first.uuid)
      assert.equal((await getJob(first.uuid))?.status, "CANCELED")
      assert.deepEqual((await getBook(fixture.bookUuid))?.readaloud, before)
      await cancelJob(second.uuid)
    } finally {
      globalThis.xrayJobControllers.delete(reservation)
    }
  })

  it("only auto-queues when configured and missing or outdated, and never duplicates active jobs", async () => {
    await using fixture = await setupBook()
    const reservation = randomUUID()
    assert.ok(globalThis.xrayJobControllers)
    globalThis.xrayJobControllers.set(reservation, new AbortController())
    try {
      await maybeEnqueueBookXray(fixture.bookUuid)
      assert.equal((await getJobs()).length, 0)
      fixture.ctx.sqlite
        .prepare(
          "UPDATE settings SET value = 'true' WHERE name = 'xrayAutoGenerate'",
        )
        .run()
      await maybeEnqueueBookXray(fixture.bookUuid)
      assert.equal((await getJobs()).length, 0)
      // The fake key is never used: this test reserves the X-Ray execution slot.
      fixture.ctx.sqlite
        .prepare(
          "UPDATE settings SET value = ? WHERE name = 'xrayAnthropicApiKey'",
        )
        .run(JSON.stringify(await encryptSecret("test-key")))
      await writeFile(
        getXrayFilepath(fixture.bookUuid),
        JSON.stringify({ generator: { version: XRAY_GENERATOR_VERSION } }),
      )
      await maybeEnqueueBookXray(fixture.bookUuid)
      assert.equal((await getJobs()).length, 0, "a current file is kept")
      await writeFile(
        getXrayFilepath(fixture.bookUuid),
        JSON.stringify({ generator: { version: XRAY_GENERATOR_VERSION - 1 } }),
      )
      await Promise.all([
        maybeEnqueueBookXray(fixture.bookUuid),
        maybeEnqueueBookXray(fixture.bookUuid),
      ])
      assert.equal(
        (await getJobs({ type: "book_xray" })).length,
        1,
        "an outdated file is regenerated, once",
      )
    } finally {
      await fixture.ctx.db
        .deleteFrom("job")
        .where("bookUuid", "=", fixture.bookUuid)
        .execute()
      globalThis.xrayJobControllers.delete(reservation)
    }
  })

  it("queues the library once per generator version at startup", async () => {
    await using fixture = await setupBook()
    const reservation = randomUUID()
    assert.ok(globalThis.xrayJobControllers)
    globalThis.xrayJobControllers.set(reservation, new AbortController())
    const marker = join(XRAY_DIR, "backfill-version")
    await rm(marker, { force: true })
    try {
      fixture.ctx.sqlite
        .prepare(
          "UPDATE settings SET value = 'true' WHERE name = 'xrayAutoGenerate'",
        )
        .run()
      fixture.ctx.sqlite
        .prepare(
          "UPDATE settings SET value = ? WHERE name = 'xrayAnthropicApiKey'",
        )
        .run(JSON.stringify(await encryptSecret("test-key")))
      await writeFile(
        getXrayFilepath(fixture.bookUuid),
        JSON.stringify({ generator: { version: XRAY_GENERATOR_VERSION - 1 } }),
      )

      await backfillXray()
      const queued = await getJobs({ type: "book_xray" })
      assert.equal(queued.length, 1, "the outdated book is queued")
      assert.equal(
        (await readFile(marker, "utf8")).trim(),
        String(XRAY_GENERATOR_VERSION),
      )

      // Once the pass has run, a book whose job did not finish is not queued
      // again at every restart.
      await cancelJob(queued[0]!.uuid)
      await backfillXray()
      assert.equal(
        (await getJobs({ type: "book_xray", statuses: ["QUEUED"] })).length,
        0,
      )
    } finally {
      await rm(marker, { force: true })
      await fixture.ctx.db
        .deleteFrom("job")
        .where("bookUuid", "=", fixture.bookUuid)
        .execute()
      globalThis.xrayJobControllers.delete(reservation)
    }
  })

  it("leaves books everyone has finished out of the startup pass", async () => {
    await using fixture = await setupBook()
    const reservation = randomUUID()
    assert.ok(globalThis.xrayJobControllers)
    globalThis.xrayJobControllers.set(reservation, new AbortController())
    const marker = join(XRAY_DIR, "backfill-version")
    await rm(marker, { force: true })
    const userId = randomUUID()
    seedUser(fixture.ctx, userId)
    const setStatus = (name: string) =>
      fixture.ctx.sqlite
        .prepare(
          `INSERT INTO book_to_status (book_uuid, status_uuid, user_id)
           VALUES (?, (SELECT uuid FROM status WHERE name = ?), ?)
           ON CONFLICT DO UPDATE SET status_uuid = excluded.status_uuid`,
        )
        .run(fixture.bookUuid, name, userId)
    try {
      fixture.ctx.sqlite
        .prepare(
          "UPDATE settings SET value = 'true' WHERE name = 'xrayAutoGenerate'",
        )
        .run()
      fixture.ctx.sqlite
        .prepare(
          "UPDATE settings SET value = ? WHERE name = 'xrayAnthropicApiKey'",
        )
        .run(JSON.stringify(await encryptSecret("test-key")))
      await writeFile(
        getXrayFilepath(fixture.bookUuid),
        JSON.stringify({ generator: { version: XRAY_GENERATOR_VERSION - 1 } }),
      )

      setStatus("Read")
      await backfillXray()
      assert.equal((await getJobs({ type: "book_xray" })).length, 0)

      await rm(marker, { force: true })
      setStatus("Reading")
      await backfillXray()
      assert.equal((await getJobs({ type: "book_xray" })).length, 1)
    } finally {
      await rm(marker, { force: true })
      await fixture.ctx.db
        .deleteFrom("job")
        .where("bookUuid", "=", fixture.bookUuid)
        .execute()
      globalThis.xrayJobControllers.delete(reservation)
    }
  })

  it("finishes and releases its slot when the book is deleted by an in-flight model call", async () => {
    await using fixture = await setupBook()
    const job = await fixture.job("book_xray", true)
    let calls = 0
    await assert.doesNotReject(
      pump(async (request) => {
        calls += 1
        await deleteBook(fixture.bookUuid)
        return fakeModel(request)
      }, fixture.readSource),
    )
    assert.equal(calls, 1)
    assert.ok(!(await getJob(job.uuid)))
    for (const filepath of [
      getXrayFilepath(fixture.bookUuid),
      getXrayStateFilepath(fixture.bookUuid),
    ]) {
      await assert.rejects(stat(filepath), { code: "ENOENT" })
    }
    assert.ok(
      !(await readdir(XRAY_DIR)).some(
        (name) => name.startsWith(fixture.bookUuid) && name.endsWith(".tmp"),
      ),
    )
    assert.equal(globalThis.xrayJobControllers?.size, 0)
  })

  it("still claims X-Ray when claiming alignment throws", async () => {
    await using fixture = await setupBook()
    const alignment = await fixture.job("book_align", true)
    const xray = await fixture.job("book_xray", true)
    fixture.ctx.sqlite.exec(`
      CREATE TRIGGER reject_alignment_claim BEFORE UPDATE OF status ON job
      WHEN NEW.type = 'book_align' AND NEW.status = 'RUNNING'
      BEGIN SELECT RAISE(FAIL, 'test alignment claim failed'); END;
    `)
    try {
      await pump(fakeModel, fixture.readSource)
      assert.equal((await getJob(xray.uuid))?.status, "DONE")
      assert.equal((await getJob(alignment.uuid))?.status, "QUEUED")
    } finally {
      await fixture.ctx.db
        .deleteFrom("job")
        .where("uuid", "=", alignment.uuid)
        .execute()
      fixture.ctx.sqlite.exec("DROP TRIGGER reject_alignment_claim")
    }
  })

  it("still claims alignment when claiming X-Ray throws and resets its start time", async () => {
    await using fixture = await setupBook()
    const alignment = await fixture.job("book_align")
    const xray = await fixture.job("book_xray", true)
    const oldStart = "2000-01-01T00:00:00.000Z"
    // An invalid alignment exits before opening a real alignment worker.
    await fixture.ctx.db
      .updateTable("job")
      .set({
        bookUuid: null,
        startedAt: oldStart,
      })
      .where("uuid", "=", alignment.uuid)
      .execute()
    fixture.ctx.sqlite.exec(`
      CREATE TRIGGER reject_xray_claim BEFORE UPDATE OF status ON job
      WHEN NEW.type = 'book_xray' AND NEW.status = 'RUNNING'
      BEGIN SELECT RAISE(FAIL, 'test X-Ray claim failed'); END;
    `)
    try {
      await pump(fakeModel, fixture.readSource)
      assert.equal((await getJob(alignment.uuid))?.status, "ERROR")
      assert.notEqual((await getJob(alignment.uuid))?.startedAt, oldStart)
      assert.equal((await getJob(xray.uuid))?.status, "QUEUED")
    } finally {
      await fixture.ctx.db
        .deleteFrom("job")
        .where("uuid", "=", xray.uuid)
        .execute()
      fixture.ctx.sqlite.exec("DROP TRIGGER reject_xray_claim")
    }
  })

  it("records a runner failure when its first final status write throws", async () => {
    await using fixture = await setupBook()
    const job = await fixture.job("book_xray", true)
    fixture.ctx.sqlite.exec(`
      CREATE TABLE xray_error_attempt (attempt INTEGER);
      CREATE TRIGGER reject_first_error BEFORE UPDATE OF status ON job
      WHEN NEW.status = 'ERROR' AND NOT EXISTS (SELECT 1 FROM xray_error_attempt)
      BEGIN
        INSERT INTO xray_error_attempt VALUES (1);
        SELECT RAISE(FAIL, 'test first final write failed');
      END;
    `)
    await pump(fakeModel, () =>
      Promise.reject(new Error("test source failure")),
    )
    assert.equal((await getJob(job.uuid))?.status, "ERROR")
    assert.match(
      (await getJob(job.uuid))?.error ?? "",
      /test first final write failed/,
    )
    assert.equal(globalThis.xrayJobControllers?.size, 0)
  })

  it("does not reclaim a RUNNING row when every final status write fails", async () => {
    await using fixture = await setupBook()
    const job = await fixture.job("book_xray", true)
    let reads = 0
    fixture.ctx.sqlite.exec(`
      CREATE TRIGGER reject_error BEFORE UPDATE OF status ON job
      WHEN NEW.status = 'ERROR'
      BEGIN SELECT RAISE(FAIL, 'test final write failed'); END;
    `)
    try {
      const readSource: XraySourceReader = () => {
        reads += 1
        return Promise.reject(new Error("test source failure"))
      }
      await pump(fakeModel, readSource)
      await pump(fakeModel, readSource)
      assert.equal(reads, 1)
      assert.equal((await getJob(job.uuid))?.status, "RUNNING")
      assert.equal(globalThis.xrayJobControllers?.size, 0)
    } finally {
      fixture.ctx.sqlite.exec("DROP TRIGGER reject_error")
      await cancelJob(job.uuid)
    }
  })

  it("never fails a completed import when optional background work fails", async () => {
    const previous = globalThis.ebookImportHandler
    try {
      setEbookImportHandler(() =>
        Promise.reject(new Error("test settings unavailable")),
      )
      await assert.doesNotReject(notifyEbookImported(randomUUID()))
    } finally {
      setEbookImportHandler(previous)
    }
  })
})
