import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import { setImmediate } from "node:timers/promises"

import { NextRequest } from "next/server"

import { DEFAULT_XRAY_MODEL } from "@storyteller-platform/xray"

import { GET, HEAD, POST } from "@/app/api/v2/books/[bookId]/xray/route"
import { setEbookImportHandler } from "@/assets/library/scanner/ebook-import"
import { canonicalizePath } from "@/assets/library/scanner/folder"
import { replaceBookAsset } from "@/assets/library/scanner/replaceAsset"
import { filepathFolder, scan } from "@/assets/library/scanner/scan"
import {
  getInternalBookDirectory,
  getXrayFilepath,
  getXrayStateFilepath,
} from "@/assets/paths"
import { deleteBook, getBook, updateBook } from "@/database/books"
import {
  createJob,
  getActiveJobForBook,
  getJobs,
  updateJob,
} from "@/database/jobs"
import { getSetting } from "@/database/settings"
import { createAdminUser } from "@/database/users"
import { XRAY_DIR } from "@/directories"
import { encryptSecret } from "@/secrets"
import type { UUID } from "@/uuid"

import { seedBooks, setupTestDb } from "./harness/testDb"

async function setupXrayBook(
  options: {
    ebook?: boolean
    fileExists?: boolean
    apiKey?: boolean
  } = {},
) {
  const ctx = setupTestDb()
  const folder = await mkdtemp(join(tmpdir(), "storyteller-xray-test-"))
  const ebookPath = join(folder, "book.epub")
  if (options.fileExists !== false) await writeFile(ebookPath, "test ebook")
  const bookUuid = seedBooks(ctx, [
    {
      title: "X-Ray test book",
      ...(options.ebook !== false && { ebook: ebookPath }),
    },
  ])[0]! as UUID

  await createAdminUser("xray-test", "X-Ray", "xray@example.com", "unused")
  const user = await ctx.db
    .selectFrom("user")
    .selectAll()
    .executeTakeFirstOrThrow()
  const token = randomUUID()
  await ctx.db
    .insertInto("session")
    .values({
      userId: user.id,
      sessionToken: token,
      expires: new Date(Date.now() + 60_000),
    })
    .execute()

  if (options.apiKey) {
    const encrypted = await encryptSecret("sk-ant-test-only")
    ctx.sqlite
      .prepare(
        "UPDATE settings SET value = ? WHERE name = 'xrayAnthropicApiKey'",
      )
      .run(JSON.stringify(encrypted))
  }

  // HTTP tests only exercise queuing; reserve the lane so no provider is called.
  const reservation = randomUUID()
  assert.ok(globalThis.xrayJobControllers)
  globalThis.xrayJobControllers.set(reservation, new AbortController())

  return {
    ctx,
    bookUuid,
    folder,
    async request(
      method: "GET" | "HEAD" | "POST",
      headers: HeadersInit = {},
      bookId: UUID = bookUuid,
    ) {
      const requestHeaders = new Headers(headers)
      requestHeaders.set("Authorization", `Bearer ${token}`)
      const handler = { GET, HEAD, POST }[method]
      const response = await handler(
        new NextRequest(`http://localhost:8001/api/v2/books/${bookId}/xray`, {
          method,
          headers: requestHeaders,
        }),
        { params: Promise.resolve({ bookId }) },
      )
      assert.ok(response instanceof Response)
      return response
    },
    async writeXray(contents = '{"trusted":"file"}') {
      await mkdir(XRAY_DIR, { recursive: true })
      await writeFile(getXrayFilepath(bookUuid), contents)
    },
    async [Symbol.asyncDispose]() {
      const book = await getBook(bookUuid)
      if (book) {
        await rm(getInternalBookDirectory(book), {
          recursive: true,
          force: true,
        })
      }
      await rm(getXrayFilepath(bookUuid), { force: true })
      await rm(getXrayStateFilepath(bookUuid), { force: true })
      await rm(folder, { recursive: true, force: true })
      await ctx.db.deleteFrom("job").where("bookUuid", "=", bookUuid).execute()
      globalThis.xrayJobControllers?.delete(reservation)
      ctx[Symbol.dispose]()
    },
  }
}

void describe("X-Ray storage and settings", () => {
  void it("inserts default settings without replacing existing values", async () => {
    using ctx = setupTestDb()
    ctx.sqlite.prepare("DELETE FROM settings WHERE name LIKE 'xray%'").run()
    const migration = await readFile(
      "migrations/114_xray_settings.sql",
      "utf-8",
    )
    ctx.sqlite.exec(migration)

    assert.equal(await getSetting("xrayAnthropicApiKey"), null)
    assert.equal(await getSetting("xrayModel"), DEFAULT_XRAY_MODEL)
    assert.equal(await getSetting("xrayAutoGenerate"), false)

    ctx.sqlite
      .prepare("UPDATE settings SET value = ? WHERE name = 'xrayModel'")
      .run(JSON.stringify("custom-model"))
    ctx.sqlite.exec(migration)
    assert.equal(await getSetting("xrayModel"), "custom-model")
  })

  void it("removes the file and saved state when deleting a book", async () => {
    await using fixture = await setupXrayBook()
    await fixture.writeXray()
    await writeFile(getXrayStateFilepath(fixture.bookUuid), "{}")

    await deleteBook(fixture.bookUuid)

    await assert.rejects(stat(getXrayFilepath(fixture.bookUuid)), {
      code: "ENOENT",
    })
    await assert.rejects(stat(getXrayStateFilepath(fixture.bookUuid)), {
      code: "ENOENT",
    })
  })

  void it("does not fail a committed deletion when derived-file cleanup fails", async () => {
    await using fixture = await setupXrayBook()
    await mkdir(getXrayFilepath(fixture.bookUuid), { recursive: true })
    await writeFile(getXrayStateFilepath(fixture.bookUuid), "{}")
    try {
      await assert.doesNotReject(deleteBook(fixture.bookUuid))
      assert.equal(await getBook(fixture.bookUuid), null)
      await assert.rejects(stat(getXrayStateFilepath(fixture.bookUuid)), {
        code: "ENOENT",
      })
    } finally {
      await rm(getXrayFilepath(fixture.bookUuid), {
        recursive: true,
        force: true,
      })
    }
  })

  void it("does not remove files inside a caller's transaction that rolls back", async () => {
    await using fixture = await setupXrayBook()
    await fixture.writeXray()
    await writeFile(getXrayStateFilepath(fixture.bookUuid), "{}")
    await assert.rejects(
      fixture.ctx.db.transaction().execute(async (tr) => {
        await deleteBook(fixture.bookUuid, undefined, tr)
        throw new Error("test rollback")
      }),
      /test rollback/,
    )
    assert.ok(await getBook(fixture.bookUuid))
    assert.equal(
      await readFile(getXrayFilepath(fixture.bookUuid), "utf-8"),
      '{"trusted":"file"}',
    )
    assert.equal(
      await readFile(getXrayStateFilepath(fixture.bookUuid), "utf-8"),
      "{}",
    )
  })

  void it("moves X-Ray and saved progress with an ebook after a merge commits", async () => {
    await using fixture = await setupXrayBook()
    const target = seedBooks(fixture.ctx, [
      { title: "Merge target" },
    ])[0]! as UUID
    await fixture.writeXray()
    await writeFile(
      getXrayStateFilepath(fixture.bookUuid),
      '{"saved":"progress"}',
    )
    try {
      const merged = await updateBook(target, null, {
        books: [fixture.bookUuid],
      })
      assert.ok(merged.ebook)
      assert.equal(await getBook(fixture.bookUuid), null)
      assert.equal(
        await readFile(getXrayFilepath(target), "utf-8"),
        '{"trusted":"file"}',
      )
      assert.equal(
        await readFile(getXrayStateFilepath(target), "utf-8"),
        '{"saved":"progress"}',
      )
      await assert.rejects(stat(getXrayFilepath(fixture.bookUuid)), {
        code: "ENOENT",
      })
      await assert.rejects(stat(getXrayStateFilepath(fixture.bookUuid)), {
        code: "ENOENT",
      })
    } finally {
      await deleteBook(target)
    }
  })

  void it("keeps the merge target's existing X-Ray instead of replacing it", async () => {
    await using fixture = await setupXrayBook()
    const target = seedBooks(fixture.ctx, [
      { title: "Merge target" },
    ])[0]! as UUID
    await fixture.writeXray()
    await writeFile(getXrayStateFilepath(fixture.bookUuid), "{}")
    await writeFile(getXrayFilepath(target), '{"existing":"index"}')
    try {
      await updateBook(target, null, { books: [fixture.bookUuid] })
      assert.equal(
        await readFile(getXrayFilepath(target), "utf-8"),
        '{"existing":"index"}',
      )
      await assert.rejects(stat(getXrayFilepath(fixture.bookUuid)), {
        code: "ENOENT",
      })
      await assert.rejects(stat(getXrayStateFilepath(fixture.bookUuid)), {
        code: "ENOENT",
      })
    } finally {
      await deleteBook(target)
    }
  })

  void it("does not roll back a merge when moving its derived files fails", async () => {
    await using fixture = await setupXrayBook()
    const target = seedBooks(fixture.ctx, [
      { title: "Merge target" },
    ])[0]! as UUID
    await fixture.writeXray()
    await mkdir(getXrayFilepath(target))
    try {
      const merged = await updateBook(target, null, {
        books: [fixture.bookUuid],
      })
      assert.ok(merged.ebook)
      assert.equal(await getBook(fixture.bookUuid), null)
    } finally {
      await rm(getXrayFilepath(target), { recursive: true, force: true })
      await deleteBook(target)
    }
  })

  void it("invalidates old X-Ray before replacing an ebook from a server path", async () => {
    await using fixture = await setupXrayBook()
    const book = await getBook(fixture.bookUuid)
    assert.ok(book)
    const replacement = join(fixture.folder, "replacement.epub")
    await cp(
      "src/__fixtures__/books/ebooks/moby-dick/moby-dick.epub",
      replacement,
    )
    await fixture.writeXray()
    await writeFile(getXrayStateFilepath(fixture.bookUuid), "{}")
    const replaced = await replaceBookAsset({
      book,
      filepath: replacement,
      format: "ebook",
      importMode: "reference",
      signal: AbortSignal.timeout(10_000),
    })
    assert.equal(replaced.ebook?.filepath, await canonicalizePath(replacement))
    await assert.rejects(stat(getXrayFilepath(fixture.bookUuid)), {
      code: "ENOENT",
    })
    await assert.rejects(stat(getXrayStateFilepath(fixture.bookUuid)), {
      code: "ENOENT",
    })
  })

  void it("invalidates a re-imported ebook even when optional background work fails", async () => {
    await using fixture = await setupXrayBook()
    const book = await getBook(fixture.bookUuid)
    assert.ok(book)
    const replacement = join(fixture.folder, "replacement.epub")
    await cp(
      "src/__fixtures__/books/ebooks/moby-dick/moby-dick.epub",
      replacement,
    )
    await fixture.writeXray()
    await writeFile(getXrayStateFilepath(fixture.bookUuid), "{}")
    const previous = globalThis.ebookImportHandler
    try {
      setEbookImportHandler(() =>
        Promise.reject(new Error("test settings failure")),
      )
      await scan({
        source: "api",
        request: {
          kind: "candidates",
          candidates: [
            {
              folder: filepathFolder(replacement),
              filepath: replacement,
              format: "ebook",
              existingBook: book,
              importMode: "reference",
            },
          ],
        },
        options: { force: true, importMode: "reference" },
        signal: AbortSignal.timeout(10_000),
      })
      assert.equal(
        (await getBook(book.uuid))?.ebook?.filepath,
        await canonicalizePath(replacement),
      )
      await assert.rejects(stat(getXrayFilepath(book.uuid)), { code: "ENOENT" })
      await assert.rejects(stat(getXrayStateFilepath(book.uuid)), {
        code: "ENOENT",
      })
    } finally {
      setEbookImportHandler(previous)
    }
  })

  void it("keeps alignment and X-Ray jobs separate for the same book", async () => {
    await using fixture = await setupXrayBook()
    const xray = await createJob({
      type: "book_xray",
      bookUuid: fixture.bookUuid,
      restart: false,
      config: null,
      position: 0,
    })
    assert.equal(
      await getActiveJobForBook(fixture.bookUuid, "book_align"),
      null,
    )
    assert.equal((await getBook(fixture.bookUuid))?.processingJob, null)
    assert.deepEqual(
      await getJobs({ type: "book_align", statuses: ["QUEUED"] }),
      [],
    )

    const alignment = await createJob({
      type: "book_align",
      bookUuid: fixture.bookUuid,
      restart: false,
      config: null,
      position: 1,
    })
    assert.equal(
      (await getActiveJobForBook(fixture.bookUuid, "book_xray"))?.uuid,
      xray.uuid,
    )
    assert.equal(
      (await getActiveJobForBook(fixture.bookUuid, "book_align"))?.uuid,
      alignment.uuid,
    )
    assert.equal(
      (await getBook(fixture.bookUuid))?.processingJob?.uuid,
      alignment.uuid,
    )
  })
})

void describe("GET book X-Ray", () => {
  void it("serves a trusted file placed on disk without a job record", async () => {
    await using fixture = await setupXrayBook()
    const contents = '{"schemaVersion":1,"from":"batch"}'
    await fixture.writeXray(contents)

    const response = await fixture.request("GET")
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("Content-Type"), "application/json")
    assert.equal(
      response.headers.get("Content-Length"),
      String(Buffer.byteLength(contents)),
    )
    assert.ok(response.headers.get("ETag"))
    assert.equal(
      response.headers.get("Last-Modified"),
      (await stat(getXrayFilepath(fixture.bookUuid))).mtime.toUTCString(),
    )
    assert.equal(await response.text(), contents)
    assert.deepEqual(await getJobs(), [])
  })

  void it("returns 304 for strong, weak, list, and wildcard ETags", async () => {
    await using fixture = await setupXrayBook()
    await fixture.writeXray()
    const first = await fixture.request("GET")
    const etag = first.headers.get("ETag")
    assert.ok(etag)
    await first.text()

    for (const value of [etag, `W/${etag}`, `"unrelated", ${etag}`, "*"]) {
      const response = await fixture.request("GET", { "If-None-Match": value })
      assert.equal(response.status, 304)
      assert.equal(response.headers.get("ETag"), etag)
      assert.equal(await response.text(), "")
    }
  })

  void it("changes its ETag when the file changes", async () => {
    await using fixture = await setupXrayBook()
    await fixture.writeXray()
    const first = await fixture.request("GET")
    const etag = first.headers.get("ETag")
    assert.ok(etag)
    await first.text()
    await fixture.writeXray(
      '{"trusted":"replacement file with different contents"}',
    )

    const response = await fixture.request("GET", { "If-None-Match": etag })
    assert.equal(response.status, 200)
    assert.notEqual(response.headers.get("ETag"), etag)
    await response.text()
  })

  void it("returns 404 for an absent file or unknown book", async () => {
    await using fixture = await setupXrayBook()
    assert.equal((await fixture.request("GET")).status, 404)
    assert.equal((await fixture.request("GET", {}, randomUUID())).status, 404)
  })

  void it("treats an empty file as missing, even with If-None-Match", async () => {
    await using fixture = await setupXrayBook()
    await fixture.writeXray("")
    assert.equal((await fixture.request("GET")).status, 404)
    assert.equal(
      (await fixture.request("GET", { "If-None-Match": "*" })).status,
      404,
    )
  })

  void it("handles cancellation mid-download without an uncaught stream error", async () => {
    await using fixture = await setupXrayBook()
    await fixture.writeXray(`{"large":"${"x".repeat(512 * 1024)}"}`)
    const uncaught: unknown[] = []
    const onUncaught = (error: unknown) => uncaught.push(error)
    process.on("uncaughtExceptionMonitor", onUncaught)
    try {
      const response = await fixture.request("GET")
      const reader = response.body?.getReader()
      assert.ok(reader)
      const first = await reader.read()
      assert.ok(first.value)
      assert.ok(first.value.byteLength < 512 * 1024)
      const reason = new Error("client left the page")
      reason.name = "ResponseAborted"
      await reader.cancel(reason)
      await setImmediate()
      assert.deepEqual(uncaught, [])
    } finally {
      process.off("uncaughtExceptionMonitor", onUncaught)
    }
  })

  void it("requires read permission", async () => {
    await using fixture = await setupXrayBook()
    await fixture.writeXray()
    fixture.ctx.sqlite.prepare("UPDATE user_permission SET book_read = 0").run()
    assert.equal((await fixture.request("GET")).status, 403)
  })
})

void describe("HEAD book X-Ray", () => {
  void it("returns GET's file metadata without a response body", async () => {
    await using fixture = await setupXrayBook()
    await fixture.writeXray()
    const get = await fixture.request("GET")
    await get.text()
    const head = await fixture.request("HEAD")
    assert.equal(head.status, get.status)
    assert.equal(head.body, null)
    assert.equal(await head.text(), "")
    for (const header of [
      "ETag",
      "Last-Modified",
      "Content-Type",
      "Content-Length",
    ]) {
      assert.ok(head.headers.get(header))
      assert.equal(head.headers.get(header), get.headers.get(header))
    }
  })

  void it("returns 304 with the same ETag and Last-Modified as GET", async () => {
    await using fixture = await setupXrayBook()
    await fixture.writeXray()
    const first = await fixture.request("HEAD")
    const etag = first.headers.get("ETag")
    assert.ok(etag)
    for (const value of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
      const headers = { "If-None-Match": value }
      const get = await fixture.request("GET", headers)
      const head = await fixture.request("HEAD", headers)
      assert.equal(get.status, 304)
      assert.equal(head.status, get.status)
      assert.equal(head.headers.get("ETag"), etag)
      assert.equal(
        head.headers.get("Last-Modified"),
        first.headers.get("Last-Modified"),
      )
      assert.equal(
        head.headers.get("Last-Modified"),
        get.headers.get("Last-Modified"),
      )
      assert.equal(head.body, null)
    }
  })

  void it("returns a bodyless 404 for missing, unknown, and empty files", async () => {
    await using fixture = await setupXrayBook()
    for (const bookId of [fixture.bookUuid, randomUUID()]) {
      const get = await fixture.request("GET", {}, bookId)
      const head = await fixture.request("HEAD", {}, bookId)
      assert.equal(head.status, 404)
      assert.equal(head.status, get.status)
      assert.equal(head.body, null)
      assert.equal(await head.text(), "")
    }
    await fixture.writeXray("")
    const get = await fixture.request("GET", { "If-None-Match": "*" })
    const head = await fixture.request("HEAD", { "If-None-Match": "*" })
    assert.equal(head.status, 404)
    assert.equal(head.status, get.status)
    assert.equal(head.headers.get("ETag"), null)
    assert.equal(head.headers.get("Last-Modified"), null)
    assert.equal(head.body, null)
  })

  void it("uses GET's read permission checks without returning an error body", async () => {
    await using fixture = await setupXrayBook()
    await fixture.writeXray()
    fixture.ctx.sqlite.prepare("UPDATE user_permission SET book_read = 0").run()
    const head = await fixture.request("HEAD")
    assert.equal(head.status, (await fixture.request("GET")).status)
    assert.equal(head.status, 403)
    assert.equal(head.body, null)
  })
})

void describe("POST book X-Ray", () => {
  void it("requires an Anthropic key and leaves no queued job when absent", async () => {
    await using fixture = await setupXrayBook()
    const response = await fixture.request("POST")
    assert.equal(response.status, 409)
    assert.match(await response.text(), /Anthropic API key/)
    assert.deepEqual(await getJobs(), [])
  })

  void it("returns 404 for unknown books and absent ebook files", async () => {
    await using noEbook = await setupXrayBook({ ebook: false, apiKey: true })
    assert.equal((await noEbook.request("POST")).status, 404)
    assert.equal((await noEbook.request("POST", {}, randomUUID())).status, 404)
  })

  void it("returns 404 when the ebook path no longer exists", async () => {
    await using fixture = await setupXrayBook({
      fileExists: false,
      apiKey: true,
    })
    assert.equal((await fixture.request("POST")).status, 404)
    assert.deepEqual(await getJobs(), [])
  })

  void it("durably queues X-Ray without storing the API key and deduplicates active requests", async () => {
    await using fixture = await setupXrayBook({ apiKey: true })
    assert.equal((await fixture.request("POST")).status, 204)
    assert.equal((await fixture.request("POST")).status, 204)
    const jobs = await getJobs({ type: "book_xray" })
    assert.equal(jobs.length, 1)
    const job = jobs[0]
    assert.ok(job)
    assert.equal(job.bookUuid, fixture.bookUuid)
    assert.equal(job.status, "QUEUED")
    assert.equal(job.config, null)
    assert.equal((await getBook(fixture.bookUuid))?.readaloud, null)

    await updateJob(job.uuid, { status: "DONE" })
    assert.equal((await fixture.request("POST")).status, 204)
    assert.equal((await getJobs({ type: "book_xray" })).length, 2)
  })

  void it("returns a clear conflict instead of claiming a paused job was queued", async () => {
    await using fixture = await setupXrayBook({ apiKey: true })
    await fixture.request("POST")
    const job = (await getJobs({ type: "book_xray" }))[0]!
    await updateJob(job.uuid, { status: "PAUSED" })
    const response = await fixture.request("POST")
    assert.equal(response.status, 409)
    assert.match(await response.text(), /Resume it from the queue/)
    assert.equal(
      (await getActiveJobForBook(fixture.bookUuid, "book_xray"))?.status,
      "PAUSED",
    )
    assert.equal((await getJobs({ type: "book_xray" })).length, 1)
  })

  void it("returns a clear conflict while a running job finishes a pause or cancellation", async () => {
    await using fixture = await setupXrayBook({ apiKey: true })
    await fixture.request("POST")
    const job = (await getJobs({ type: "book_xray" }))[0]!
    await updateJob(job.uuid, { status: "RUNNING" })
    assert.ok(globalThis.jobAbortIntents)
    for (const intent of ["pause", "cancel"] as const) {
      try {
        globalThis.jobAbortIntents.set(job.uuid, intent)
        const response = await fixture.request("POST")
        assert.equal(response.status, 409)
        assert.match(await response.text(), /Try again in a moment/)
        assert.equal((await getJobs({ type: "book_xray" })).length, 1)
      } finally {
        globalThis.jobAbortIntents.delete(job.uuid)
      }
    }
  })

  void it("requires processing permission", async () => {
    await using fixture = await setupXrayBook({ apiKey: true })
    fixture.ctx.sqlite
      .prepare("UPDATE user_permission SET book_process = 0")
      .run()
    assert.equal((await fixture.request("POST")).status, 403)
    assert.deepEqual(await getJobs(), [])
  })
})
