import { randomUUID } from "node:crypto"

import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { callStructured } from "@storyteller/xray"

import {
  type TestDbContext,
  seedUser,
  setupTestDb,
} from "@/__tests__/harness/testDb"
import { GET as importStatus } from "@/app/api/v2/history/imports/[uuid]/route"
import { POST as importHistory } from "@/app/api/v2/history/imports/route"
import { PUT as matchHistory } from "@/app/api/v2/history/items/[uuid]/match/route"
import {
  GET as listLibraryReads,
  POST as markLibraryReads,
} from "@/app/api/v2/history/library-reads/route"
import {
  DELETE as deleteHistory,
  GET as listHistory,
} from "@/app/api/v2/history/route"
import { GET as listUnmatched } from "@/app/api/v2/history/unmatched/route"
import { setCatalogForTests } from "@/catalog"
import { type Catalog, type CatalogWork } from "@/catalog/types"
import {
  createImportJob,
  getHistoryItems,
  getImportJob,
  setItemMatch,
  upsertManualItem,
} from "@/database/readingHistory"
import { resumeHistoryImports, runHistoryImport } from "@/history/importer"
import { type ImportJobView, type ParsedHistoryItem } from "@/history/types"
import { historyChanged } from "@/recommendations/triggers"
import { type UUID } from "@/uuid"

vi.mock("@/recommendations/triggers", () => ({
  historyChanged: vi.fn(() => Promise.resolve()),
}))
vi.mock(import("@storyteller/xray"), async (importOriginal) => ({
  ...(await importOriginal()),
  callStructured: vi.fn(),
}))

const ctxParams = <T>(value: T) => ({ params: Promise.resolve(value) })
const noParams = ctxParams({})
const resolve = vi.fn<Catalog["resolve"]>()
const search = vi.fn<Catalog["search"]>()
const getWorks = vi.fn<Catalog["getWorks"]>()
const findByIsbn = vi.fn<Catalog["findByIsbn"]>()
let ctx: TestDbContext
let readerA: UUID
let readerB: UUID
let tokenA: string
let tokenB: string

function catalogWork(
  title: string,
  authors = ["A. Writer"],
  key = `ol:${title}`,
): CatalogWork {
  return {
    key,
    title,
    authors,
    subtitle: null,
    narrators: [],
    series: [],
    releaseDate: "2020-01-01",
    language: "en",
    runtimeMinutes: null,
    pages: 100,
    abridged: null,
    subjects: ["Adventure"],
    description: null,
    coverUrl: null,
    ids: {},
  }
}

function item(title: string): ParsedHistoryItem {
  return {
    sourceId: title,
    title,
    authors: ["A. Writer"],
    status: "read",
    explicit: true,
  }
}

async function session(userId: UUID) {
  seedUser(ctx, userId)
  ctx.sqlite
    .prepare(
      `UPDATE user_permission SET book_read = 1 WHERE uuid = (SELECT user_permission_uuid FROM "user" WHERE id = ?)`,
    )
    .run(userId)
  const sessionToken = randomUUID()
  await ctx.db
    .insertInto("session")
    .values({ userId, sessionToken, expires: new Date(Date.now() + 60_000) })
    .execute()
  return sessionToken
}

type RequestOptions = Pick<RequestInit, "method" | "headers" | "body">

function request(token: string, path = "", options?: RequestOptions) {
  const headers = new Headers(options?.headers)
  headers.set("authorization", `Bearer ${token}`)
  return new NextRequest(`http://localhost/api/v2/history${path}`, {
    ...options,
    headers,
  })
}

async function responseBody(response: unknown): Promise<unknown> {
  if (!(response instanceof Response))
    throw new Error("Expected a route response")
  const body: unknown = await response.json()
  return body
}

function upload(
  token: string,
  source: string,
  filename: string,
  contents: string,
) {
  const body = new FormData()
  body.set("source", source)
  body.set("file", new File([contents], filename))
  return importHistory(
    request(token, "/imports", { method: "POST", body }),
    noParams,
  )
}

function json(method: string, data: object): RequestOptions {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  }
}

async function createBook(title: string, owner?: UUID) {
  const { uuid } = await ctx.db
    .insertInto("book")
    .values({ title, assetDir: title })
    .returning("uuid")
    .executeTakeFirstOrThrow()
  const creator = await ctx.db
    .insertInto("creator")
    .values({ name: "A. Writer", fileAs: "Writer, A." })
    .onConflict((oc) => oc.column("name").doUpdateSet({ fileAs: "Writer, A." }))
    .returning("uuid")
    .executeTakeFirstOrThrow()
  await ctx.db
    .insertInto("bookToCreator")
    .values({ bookUuid: uuid, creatorUuid: creator.uuid, role: "aut" })
    .execute()
  if (owner) {
    const collection = await ctx.db
      .insertInto("collection")
      .values({ name: `Private ${title}`, public: false })
      .returning("uuid")
      .executeTakeFirstOrThrow()
    await ctx.db
      .insertInto("collectionToUser")
      .values({ collectionUuid: collection.uuid, userId: owner })
      .execute()
    await ctx.db
      .insertInto("bookToCollection")
      .values({ bookUuid: uuid, collectionUuid: collection.uuid })
      .execute()
  }
  return uuid
}

beforeEach(async () => {
  ctx = setupTestDb()
  readerA = randomUUID()
  readerB = randomUUID()
  tokenA = await session(readerA)
  tokenB = await session(readerB)
  resolve.mockReset().mockImplementation(({ title }) =>
    Promise.resolve({
      work: catalogWork(title),
      matchedBy: "title",
    }),
  )
  search.mockReset().mockResolvedValue([])
  getWorks.mockReset().mockResolvedValue(new Map())
  findByIsbn.mockReset().mockResolvedValue(new Map())
  setCatalogForTests({
    resolve,
    search,
    getWorks,
    findByIsbn,
    getSeries: () => Promise.resolve(new Map()),
    worksByAuthor: () => Promise.resolve([]),
    similar: () => Promise.resolve([]),
  })
  vi.mocked(callStructured).mockReset()
  vi.mocked(historyChanged).mockClear()
})

afterEach(() => {
  setCatalogForTests(null)
  ctx[Symbol.dispose]()
})

describe("reading history API", () => {
  it("imports 30 synthetic Goodreads rows via multipart and matches at least 95%", async () => {
    resolve.mockImplementation(({ title }) =>
      Promise.resolve(
        title === "Book 29"
          ? null
          : { work: catalogWork(title), matchedBy: "title" },
      ),
    )
    findByIsbn.mockResolvedValue(
      new Map([["9780385340024", catalogWork("Book 0")]]),
    )
    const csv = [
      "Book Id,Title,Author,ISBN13,Original Publication Year,Date Read,Exclusive Shelf",
      ...Array.from(
        { length: 30 },
        (_, index) =>
          `${index},Book ${index},A. Writer,${index === 0 ? '="9780385340024"' : ""},1990,2025/02/02,read`,
      ),
    ].join("\r\n")
    const accepted = await upload(
      tokenA,
      "goodreads",
      "goodreads_library_export.csv",
      csv,
    )
    expect(accepted?.status).toBe(202)
    const job = (await responseBody(accepted)) as ImportJobView
    expect(job).toMatchObject({ status: "running", total: 30, processed: 0 })
    const path = `/imports/${job.uuid}`
    const finished = await vi.waitFor(async () => {
      const response = await importStatus(
        request(tokenA, path),
        ctxParams({ uuid: job.uuid }),
      )
      expect(response?.status).toBe(200)
      const current = (await responseBody(response)) as ImportJobView
      expect(current.status).toBe("done")
      return current
    })
    expect(finished.total).toBe(30)
    expect(finished.processed).toBe(30)
    expect(finished.matched / finished.total).toBeGreaterThanOrEqual(0.95)
    expect(finished.unmatched).toBe(1)
    expect(findByIsbn).toHaveBeenCalledWith(["9780385340024"])
    const fromIsbn = (await getHistoryItems(readerA)).find(
      ({ title }) => title === "Book 0",
    )
    expect(fromIsbn).toMatchObject({
      title: "Book 0",
      matchedBy: "isbn",
      publishedYear: 1990,
      finishedAt: "2025-02-02 00:00:00",
    })
    expect(fromIsbn?.work?.key).toBe("ol:Book 0")
    expect(historyChanged).toHaveBeenCalledExactlyOnceWith(readerA, "import")
  })

  it("rejects an unknown source or malformed export without replacing existing history", async () => {
    await createImportJob(readerA, "goodreads", [item("Kept")])
    const unknown = await upload(
      tokenA,
      "unknown",
      "export.csv",
      "doesn't matter",
    )
    expect(unknown?.status).toBe(400)
    expect(await responseBody(unknown)).toMatchObject({
      code: "unknown-source",
    })
    const malformed = await upload(
      tokenA,
      "goodreads",
      "export.csv",
      'Book Id,Title,Author,Exclusive Shelf\r\n1,"broken',
    )
    expect(malformed?.status).toBe(400)
    const invalid = (await responseBody(malformed)) as {
      code: string
      message: string
    }
    expect(invalid.code).toBe("invalid-export")
    expect(invalid.message).toContain("unclosed")
    expect((await getHistoryItems(readerA)).map(({ title }) => title)).toEqual([
      "Kept",
    ])
    const oversize = await importHistory(
      request(tokenA, "/imports", {
        method: "POST",
        headers: { "content-length": String(51 * 1024 * 1024) },
      }),
      noParams,
    )
    expect(oversize?.status).toBe(413)
  })

  it("keeps jobs, unmatched items, and source deletion scoped to the reader", async () => {
    const jobA = await createImportJob(readerA, "goodreads", [
      item("Reader A entry"),
    ])
    const jobB = await createImportJob(readerB, "goodreads", [
      item("Reader B entry"),
      item("Ignore this"),
    ])
    const [entryA] = await getHistoryItems(readerA)
    const otherEntries = await getHistoryItems(readerB)
    const entryB = otherEntries.find(({ title }) => title === "Reader B entry")!
    const ignore = otherEntries.find(({ title }) => title === "Ignore this")!
    for (const entry of [entryA!, entryB, ignore]) {
      await setItemMatch(
        entry.userId,
        entry.uuid,
        { matchStatus: "unmatched" },
        "pending",
      )
    }
    search.mockResolvedValue(
      ["First", "Second", "Third", "Fourth"].map((title) => catalogWork(title)),
    )
    getWorks.mockResolvedValue(new Map([["ol:First", catalogWork("First")]]))
    const list = await listUnmatched(request(tokenA, "/unmatched"), noParams)
    expect(await responseBody(list)).toEqual({
      items: [
        expect.objectContaining({
          uuid: entryA!.uuid,
          candidates: [
            expect.objectContaining({ key: "ol:First" }),
            expect.objectContaining({ key: "ol:Second" }),
            expect.objectContaining({ key: "ol:Third" }),
          ],
        }),
      ],
    })
    expect(search).toHaveBeenCalledExactlyOnceWith({
      title: "Reader A entry",
      author: "A. Writer",
      limit: 3,
    })
    const hiddenJob = await importStatus(
      request(tokenA, `/imports/${jobB.uuid}`),
      ctxParams({ uuid: jobB.uuid }),
    )
    expect(hiddenJob?.status).toBe(404)
    const hiddenItem = await matchHistory(
      request(
        tokenA,
        `/items/${entryB.uuid}/match`,
        json("PUT", { key: "ol:First" }),
      ),
      ctxParams({ uuid: entryB.uuid }),
    )
    expect(hiddenItem?.status).toBe(404)
    expect(getWorks).not.toHaveBeenCalled()
    const matched = await matchHistory(
      request(
        tokenB,
        `/items/${entryB.uuid}/match`,
        json("PUT", { key: "ol:First" }),
      ),
      ctxParams({ uuid: entryB.uuid }),
    )
    expect(matched?.status).toBe(204)
    expect(historyChanged).toHaveBeenCalledWith(readerB, "match")
    const ignored = await matchHistory(
      request(
        tokenB,
        `/items/${ignore.uuid}/match`,
        json("PUT", { ignore: true }),
      ),
      ctxParams({ uuid: ignore.uuid }),
    )
    expect(ignored?.status).toBe(204)
    const deleted = await deleteHistory(
      request(tokenA, "?source=goodreads", { method: "DELETE" }),
      noParams,
    )
    expect(deleted?.status).toBe(204)
    expect(await getHistoryItems(readerA)).toEqual([])
    expect(await getImportJob(readerA, jobA.uuid)).toBeNull()
    expect(await getImportJob(readerB, jobB.uuid)).not.toBeNull()
    expect(await getHistoryItems(readerB)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uuid: entryB.uuid,
          matchedBy: "reader",
          matchStatus: "matched",
        }),
        expect.objectContaining({ uuid: ignore.uuid, matchStatus: "ignored" }),
      ]),
    )
    const summary = await listHistory(request(tokenA), noParams)
    expect(await responseBody(summary)).toMatchObject({
      sources: [
        expect.objectContaining({
          source: "goodreads",
          items: 0,
          lastImport: null,
        }),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      ],
    })
    expect(historyChanged).toHaveBeenCalledWith(readerA, "delete")
  })

  it("links only visible books and offers imported definite reads without starting a recommendation round", async () => {
    const visible = await createBook("Visible Book", readerA)
    const hidden = await createBook("Hidden Book", readerB)
    const probably = await createBook("Soft Read", readerA)
    const goodreads = await createImportJob(readerA, "goodreads", [
      item("Visible Book"),
      item("Hidden Book"),
    ])
    await runHistoryImport(goodreads)
    const kindle = await createImportJob(readerA, "kindle", [
      {
        ...item("Soft Read"),
        explicit: false,
        status: "reading",
        pageFlips: 90,
      },
    ])
    await runHistoryImport(kindle)
    expect(await getHistoryItems(readerA)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Visible Book", bookUuid: visible }),
        expect.objectContaining({ title: "Hidden Book", bookUuid: null }),
        expect.objectContaining({
          title: "Soft Read",
          bookUuid: probably,
          status: "probably_read",
          explicit: false,
        }),
      ]),
    )
    expect(
      await ctx.db
        .selectFrom("bookToStatus")
        .selectAll()
        .where("userId", "=", readerA)
        .execute(),
    ).toEqual([])
    const list = await listLibraryReads(
      request(tokenA, "/library-reads"),
      noParams,
    )
    expect(await responseBody(list)).toEqual({
      books: [{ title: "Visible Book", bookUuid: visible }],
    })
    const inaccessible = await markLibraryReads(
      request(
        tokenA,
        "/library-reads",
        json("POST", { bookUuids: [visible, hidden, probably] }),
      ),
      noParams,
    )
    expect(inaccessible?.status).toBe(404)
    const wrongUser = await markLibraryReads(
      request(tokenB, "/library-reads", json("POST", { bookUuids: [visible] })),
      noParams,
    )
    expect(wrongUser?.status).toBe(404)
    vi.mocked(historyChanged).mockClear()
    const marked = await markLibraryReads(
      request(tokenA, "/library-reads", json("POST", { bookUuids: [visible] })),
      noParams,
    )
    expect(marked?.status).toBe(204)
    expect(historyChanged).not.toHaveBeenCalled()
    const statuses = await ctx.db
      .selectFrom("bookToStatus")
      .innerJoin("status", "status.uuid", "bookToStatus.statusUuid")
      .select(["userId", "bookUuid", "status.name"])
      .execute()
    expect(statuses).toEqual([
      { userId: readerA, bookUuid: visible, name: "Read" },
    ])
    const after = await listLibraryReads(
      request(tokenA, "/library-reads"),
      noParams,
    )
    expect(await responseBody(after)).toEqual({ books: [] })
  })
})

describe("history import worker", () => {
  it("tries model guesses in one batch, and rejects unverified or wrong-author guesses", async () => {
    await ctx.db
      .updateTable("settings")
      .set({ value: JSON.stringify("fake-test-key") })
      .where("name", "=", "xrayAnthropicApiKey")
      .execute()
    resolve.mockImplementation(({ title }) => {
      if (title === "Verified")
        return Promise.resolve({ work: catalogWork(title), matchedBy: "title" })
      if (title === "Wrong Author")
        return Promise.resolve({
          work: catalogWork(title, ["Wrong Person"]),
          matchedBy: "title",
        })
      return Promise.resolve(null)
    })
    vi.mocked(callStructured).mockImplementation(({ user }) => {
      const rows = JSON.parse(user) as { row: number; title: string }[]
      return Promise.resolve({
        output: {
          rows: rows.map(({ row, title }) => ({
            row,
            guesses:
              title === "Needs Correction"
                ? [
                    { title: "Wrong Author", author: "A. Writer" },
                    { title: "Other Writer", author: "Wrong Person" },
                    { title: "Verified", author: "Writer, A." },
                  ]
                : [{ title: "Wrong Author", author: "A. Writer" }],
          })),
        },
        usage: {
          inputTokens: 10,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      })
    })
    const job = await createImportJob(readerA, "goodreads", [
      item("Needs Correction"),
      item("Unverifiable"),
    ])
    await runHistoryImport(job)
    expect(callStructured).toHaveBeenCalledTimes(1)
    expect(callStructured).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-haiku-5-5" }),
    )
    expect(resolve).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Other Writer" }),
    )
    const rows = await getHistoryItems(readerA)
    const corrected = rows.find(({ title }) => title === "Needs Correction")
    expect(corrected).toMatchObject({
      matchStatus: "matched",
      matchedBy: "model",
    })
    expect(corrected?.work?.title).toBe("Verified")
    expect(rows.find(({ title }) => title === "Unverifiable")).toMatchObject({
      matchStatus: "unmatched",
      work: null,
    })
  })

  it("resumes pending rows and reconciles stale counters without doing matched work again", async () => {
    const job = await createImportJob(readerA, "goodreads", [
      item("Already Matched"),
      item("Pending Match"),
    ])
    const rows = await getHistoryItems(readerA)
    await setItemMatch(
      readerA,
      rows.find(({ title }) => title === "Already Matched")!.uuid,
      {
        matchStatus: "matched",
        work: catalogWork("Already Matched"),
        matchedBy: "title",
      },
      "pending",
    )
    expect((await getImportJob(readerA, job.uuid))?.processed).toBe(0)
    await resumeHistoryImports()
    expect(await getImportJob(readerA, job.uuid)).toMatchObject({
      status: "done",
      total: 2,
      processed: 2,
      matched: 2,
      unmatched: 0,
    })
    expect(resolve).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ title: "Pending Match" }),
    )
    expect(historyChanged).toHaveBeenCalledExactlyOnceWith(readerA, "import")
  })

  it("keeps manual rows on re-import, counts duplicates once, and deletes only the selected source", async () => {
    await upsertManualItem(readerA, catalogWork("Manual Book"), 4)
    const previous = await createImportJob(readerA, "goodreads", [
      item("Old Entry"),
    ])
    await createImportJob(readerA, "audible", [item("Audible Entry")])
    const fresh = await createImportJob(readerA, "goodreads", [
      item("New Entry"),
      item("New Entry"),
    ])
    expect((await getImportJob(readerA, previous.uuid))?.status).toBe("failed")
    expect(fresh.total).toBe(1)
    await runHistoryImport(fresh)
    expect(await getImportJob(readerA, fresh.uuid)).toMatchObject({
      status: "done",
      total: 1,
      processed: 1,
      matched: 1,
    })
    expect(
      (await getHistoryItems(readerA)).map(({ title }) => title).sort(),
    ).toEqual(["Audible Entry", "Manual Book", "New Entry"])
    await deleteHistory(
      request(tokenA, "?source=goodreads", { method: "DELETE" }),
      noParams,
    )
    expect(
      (await getHistoryItems(readerA)).map(({ title }) => title).sort(),
    ).toEqual(["Audible Entry", "Manual Book"])
  })

  it("records catalog errors without exposing private row data", async () => {
    resolve.mockRejectedValue(new Error("Sensitive fixture title"))
    const job = await createImportJob(readerA, "goodreads", [
      item("Sensitive fixture title"),
    ])
    await runHistoryImport(job)
    const failed = await getImportJob(readerA, job.uuid)
    expect(failed?.status).toBe("failed")
    expect(failed?.error).not.toContain("Sensitive fixture title")
    expect(historyChanged).not.toHaveBeenCalled()
  })
})
