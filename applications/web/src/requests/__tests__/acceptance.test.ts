/**
 * The first acceptance test for book requests: one EPUB and one multi-track
 * audiobook in a disposable read-only seed folder, requested by one reader.
 * The delivering server process is killed right after the ebook import commits,
 * then a restarted server finishes the job. Passes only with one book, one
 * sync job, every track, unchanged source files, and nothing visible to or
 * sent to the other reader in the household.
 */
import assert from "node:assert"
import { execFile } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
} from "node:fs/promises"
import { join, relative } from "node:path"
import { cwd } from "node:process"
import { type MessagePort } from "node:worker_threads"

import Db from "better-sqlite3"
import { afterAll, beforeAll, describe, it, vi } from "vitest"

import { Epub, MemoryAdapter } from "@storyteller/epub"

import { getAudiobookTracks } from "@/assets/audiobooks"
import {
  type BookRequest,
  getBookRequest,
  getBookRequestEvents,
  getBookRequestsForUser,
} from "@/database/bookRequests"
import { getBook, getBooks } from "@/database/books"
import { replaceDatabase } from "@/database/connection"
import { createKyselyDb } from "@/database/factory"
import { type DisplayJob, getJobs } from "@/database/jobs"
import { migrate } from "@/database/migrate"
import { subscribeToJobEvents } from "@/jobEvents"
import { type JobStatus } from "@/jobStatuses"
import { RequestEngine } from "@/requests/engine"
import { toRequestView } from "@/requests/http"
import { findLibraryCopies } from "@/requests/library"
import {
  createRequest,
  dismissRequest,
  setRequestCollection,
} from "@/requests/service"
import { type Milestone } from "@/requests/types"
import { createAudiobookManifest } from "@/utils/audioManifest"
import { type UUID } from "@/uuid"
import { pump, recoverInterruptedAlignJobs } from "@/work/distributor"

import {
  AUDIO_HASH,
  EBOOK_HASH,
  FileStateAdapter,
  SOURCE,
  testReleases,
} from "./fixtures/fakeAdapter"

// A disposable data directory, set before any server module reads it.
const { dataDir } = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const dataDir = mkdtempSync(join(tmpdir(), "storyteller-request-data-"))
  process.env["STORYTELLER_DATA_DIR"] = dataDir
  return { dataDir }
})

// Metadata lookups go online; not part of delivery.
vi.mock("@/work/seriesLookup", () => ({
  lookUpSeriesForNewBook: () => Promise.resolve(),
}))

type SyncRun = {
  bookUuid: string
  finish: (readaloud: string) => Promise<void>
}

// The sync worker is replaced by one that runs until the test finishes it,
// then reports the read-along through the port as the real worker does.
const sync = vi.hoisted(() => ({ runs: [] as SyncRun[] }))
vi.mock("piscina", () => ({
  default: class {
    run(
      task: { bookUuid: string; port: MessagePort },
      options: { signal: AbortSignal },
    ) {
      const run = Promise.withResolvers<undefined>()
      options.signal.addEventListener("abort", () => {
        run.reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
      })
      sync.runs.push({
        bookUuid: task.bookUuid,
        finish: (readaloud) => {
          const acknowledged = Promise.withResolvers<undefined>()
          task.port.once("message", () => {
            run.resolve(undefined)
            acknowledged.resolve(undefined)
          })
          task.port.postMessage({
            requestId: randomUUID(),
            update: null,
            relations: {
              readaloud: {
                filepath: readaloud,
                status: "ALIGNED",
                currentStage: "SYNC_CHAPTERS",
              },
            },
          })
          return acknowledged.promise
        },
      })
      return run.promise
    }
  },
}))

type Tree = Record<string, { sha256: string; mtimeMs: number }>

const FIXTURES = join(cwd(), "src", "__fixtures__", "books")
const seedDir = join(dataDir, "seed")
const stateFile = join(dataDir, "adapter-state.json")
const dbFile = join(dataDir, "storyteller.db")

const requester = randomUUID()
const housemate = randomUUID()
const requesterShelf = randomUUID()
const housemateShelf = randomUUID()

const sent: { requestUuid: UUID; userId: UUID; milestone: Milestone }[] = []
function notify(request: BookRequest, milestone: Milestone) {
  sent.push({ requestUuid: request.uuid, userId: request.userId, milestone })
  return Promise.resolve()
}

/** Resolves on the first job event that shows a job reaching `status`. */
function jobReaches(status: JobStatus): Promise<DisplayJob> {
  const reached = Promise.withResolvers<DisplayJob>()
  const unsubscribe = subscribeToJobEvents((event) => {
    if (event.type === "jobDeleted" || event.payload.status !== status) return
    unsubscribe()
    reached.resolve(event.payload)
  })
  return reached.promise
}

async function listTree(root: string): Promise<Tree> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  const files: Tree = {}
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    files[relative(root, path)] = {
      sha256: createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
      mtimeMs: (await stat(path)).mtimeMs,
    }
  }
  return files
}

function openDatabase() {
  const sqlite = new Db(dbFile)
  sqlite.function("uuid", () => randomUUID())
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("busy_timeout = 5000")
  sqlite.pragma("foreign_keys = ON")
  replaceDatabase(createKyselyDb(sqlite))
  return sqlite
}

function seedHousehold(sqlite: Db.Database) {
  for (const [userId, shelf, name] of [
    [requester, requesterShelf, "Requester"],
    [housemate, housemateShelf, "Housemate's shelf"],
  ] as const) {
    const permission = randomUUID()
    sqlite
      .prepare(
        `INSERT INTO user_permission (uuid, book_list, book_read) VALUES (?, 1, 1)`,
      )
      .run(permission)
    sqlite
      .prepare(
        `INSERT INTO "user" (id, user_permission_uuid, email) VALUES (?, ?, ?)`,
      )
      .run(userId, permission, `${userId}@example.com`)
    sqlite
      .prepare(`INSERT INTO collection (uuid, name, public) VALUES (?, ?, 0)`)
      .run(shelf, name)
    sqlite
      .prepare(
        `INSERT INTO collection_to_user (user_id, collection_uuid) VALUES (?, ?)`,
      )
      .run(userId, shelf)
  }
  // A collection of the housemate's named like a folder on the seed path: a plain
  // import would file the book into it as well.
  const trap = randomUUID()
  sqlite
    .prepare(`INSERT INTO collection (uuid, name, public) VALUES (?, ?, 0)`)
    .run(trap, SOURCE)
  sqlite
    .prepare(
      `INSERT INTO collection_to_user (user_id, collection_uuid) VALUES (?, ?)`,
    )
    .run(housemate, trap)
  sqlite
    .prepare(
      `UPDATE settings SET value = 'true' WHERE name = 'syncNarrationAutomatically'`,
    )
    .run()
}

/** Runs delivery in a separate server process that dies mid-way. */
function runCrashingDelivery(): Promise<{
  code: number | string | null
  out: string
}> {
  const exited = Promise.withResolvers<{
    code: number | string | null
    out: string
  }>()
  execFile(
    process.execPath,
    [
      join(cwd(), "..", "..", "node_modules", "tsx", "dist", "cli.mjs"),
      "--conditions=@storyteller",
      join(
        cwd(),
        "src",
        "requests",
        "__tests__",
        "fixtures",
        "deliveryCrashChild.ts",
      ),
      stateFile,
      seedDir,
    ],
    {
      cwd: cwd(),
      env: {
        ...process.env,
        STORYTELLER_DATA_DIR: dataDir,
        STORYTELLER_TEST_DB: "",
        STORYTELLER_LOG_LEVEL: "error",
        NODE_ENV: "test",
      },
      timeout: 300_000,
    },
    (error, stdout, stderr) => {
      exited.resolve({
        code: error ? (error.code ?? null) : 0,
        out: `${stdout}${stderr}`,
      })
    },
  )
  return exited.promise
}

describe("book request delivery survives a crash after the ebook import", () => {
  let sqlite: Db.Database
  let seedBefore: Tree
  let adapter: FileStateAdapter
  let request: BookRequest

  beforeAll(async () => {
    // The seed folder: one folder per download, the audiobook split over two
    // disc folders, every file read-only.
    const ebookFolder = join(seedDir, SOURCE, EBOOK_HASH)
    const audioFolder = join(seedDir, SOURCE, AUDIO_HASH)
    await mkdir(ebookFolder, { recursive: true })
    await mkdir(join(audioFolder, "CD1"), { recursive: true })
    await mkdir(join(audioFolder, "CD2"), { recursive: true })
    await copyFile(
      join(FIXTURES, "ebooks", "moby-dick", "moby-dick.epub"),
      join(ebookFolder, "Moby Dick.epub"),
    )
    await copyFile(
      join(
        FIXTURES,
        "audiobooks",
        "moby-dick",
        "mobydick_001_002_melville.mp3",
      ),
      join(audioFolder, "CD1", "01 Chapter 1.mp3"),
    )
    await copyFile(
      join(
        FIXTURES,
        "audiobooks",
        "moby-dick",
        "mobydick_001_003_melville.mp3",
      ),
      join(audioFolder, "CD2", "01 Chapter 2.mp3"),
    )
    const filesIn = async (folder: string) =>
      Object.keys(await listTree(folder)).map((path) => ({
        path: path.replaceAll("\\", "/"),
        size: 1,
      }))
    const ebookFiles = await filesIn(ebookFolder)
    const audioFiles = await filesIn(audioFolder)
    for (const file of ebookFiles)
      await chmod(join(ebookFolder, file.path), 0o444)
    for (const file of audioFiles)
      await chmod(join(audioFolder, file.path), 0o444)
    seedBefore = await listTree(seedDir)

    adapter = FileStateAdapter.create(
      stateFile,
      testReleases({ ebook: ebookFiles, audio: audioFiles }),
    )

    sqlite = openDatabase()
    await migrate()
    seedHousehold(sqlite)
    await setRequestCollection(requester, requesterShelf)
    await setRequestCollection(housemate, housemateShelf)
  }, 120_000)

  afterAll(() => {
    sqlite.close()
  })

  it("requests the pair", async () => {
    request = await createRequest(
      requester,
      {
        kind: "title",
        input: { text: "Moby Dick" },
        work: { title: "Moby Dick", authors: ["Herman Melville"] },
        ebook: { source: SOURCE, id: "ebook-1", kind: "ebook" },
        audio: { source: SOURCE, id: "audio-1", kind: "audio" },
      },
      adapter,
    )
    assert.strictEqual(request.ebookInfohash, EBOOK_HASH)
    assert.strictEqual(request.audioInfohash, AUDIO_HASH)
    assert.strictEqual(request.ebookStatus, "downloading")
    // the book id is reserved before anything is imported
    assert.strictEqual(await getBook(request.bookUuid), null)
  })

  it("kills the delivering server right after the ebook import", async () => {
    // The other process is the only one using the database, as on a server.
    sqlite.close()
    const { code, out } = await runCrashingDelivery()
    assert.match(out, /crashed-after-import/, out)
    assert.strictEqual(code, 137, out)

    sqlite = openDatabase()
    const book = await getBook(request.bookUuid)
    assert.ok(book?.ebook?.filepath, "the ebook import committed")
    assert.strictEqual(book.audiobook, null)

    const stored = await getBookRequest(request.uuid)
    assert.strictEqual(
      stored?.ebookStatus,
      "importing",
      "the request never learned that the import finished",
    )
    assert.strictEqual(adapter.read().calls.add, 2)
  }, 300_000)

  it("finishes delivery after the restart without a second book or sync", async () => {
    // Start-up, as the restarted server runs it.
    await import("@/work/autoSync")
    await recoverInterruptedAlignJobs()
    void pump()

    const engine = new RequestEngine({ adapter, seedDir, notify })
    const syncStarted = jobReaches("RUNNING")
    await engine.tick()
    const job = await syncStarted
    await engine.tick()

    const delivered = await getBookRequest(request.uuid)
    assert.ok(delivered)
    assert.strictEqual(delivered.ebookStatus, "ready")
    assert.strictEqual(delivered.audioStatus, "ready")
    assert.strictEqual(delivered.bookUuid, request.bookUuid)
    assert.strictEqual(delivered.alignStatus, "syncing")
    assert.strictEqual(delivered.alignJobUuid, job.uuid)

    // one book, filed only on the requester's shelf
    const books = await getBooks()
    assert.strictEqual(books.length, 1)
    const [book] = books
    assert.ok(book?.audiobook && book.ebook)
    assert.deepStrictEqual(
      book.collections.map((collection) => collection.uuid),
      [requesterShelf],
    )

    // every track, with the disc folders kept, in the library's own copy
    const audioDir = book.audiobook.filepath
    const tracks = await getAudiobookTracks(audioDir)
    assert.deepStrictEqual(
      tracks.map((track) => relative(audioDir, track).replaceAll("\\", "/")),
      ["CD1/01 Chapter 1.mp3", "CD2/01 Chapter 2.mp3"],
    )
    assert.ok(!audioDir.startsWith(seedDir))
    assert.ok(!book.ebook.filepath.startsWith(seedDir))
    // the reader apps get every track, disc folders included
    const manifest = await createAudiobookManifest(audioDir, {
      bookId: book.uuid,
      title: book.title,
      updatedAt: new Date(),
    })
    assert.deepStrictEqual(
      manifest.readingOrder.items.map((link) => link.href),
      ["CD1/01 Chapter 1.mp3", "CD2/01 Chapter 2.mp3"],
    )
    using epub = await Epub.using(MemoryAdapter).from(book.ebook.filepath)
    assert.ok(await epub.getTitle())
    assert.ok((await stat(book.ebook.filepath)).mode & 0o200)

    // nothing added to the download client twice
    assert.strictEqual(adapter.read().calls.add, 2)

    // two triggers (the scan that attached the audio, and the request)
    // queued one sync, and the worker started it once
    const jobs = await getJobs({ type: "book_align" })
    assert.deepStrictEqual(
      jobs.map((each) => each.uuid),
      [job.uuid],
    )
    assert.strictEqual(sync.runs.length, 1)
  }, 300_000)

  it("tells the requester when the read-along is ready", async () => {
    const readaloud = join(dataDir, "moby-dick-readaloud.epub")
    await copyFile(
      join(FIXTURES, "readalouds", "moby-dick", "moby-dick-small.epub"),
      readaloud,
    )
    const syncDone = jobReaches("DONE")
    await sync.runs[0]?.finish(readaloud)
    await syncDone

    const engine = new RequestEngine({ adapter, seedDir, notify })
    await engine.tick()
    await engine.tick()
    const done = await getBookRequest(request.uuid)
    assert.ok(done)
    assert.strictEqual(done.alignStatus, "done")
    // it stays on the Home card, as "Open read-along", until opened
    assert.strictEqual(done.closedAt, null)
    assert.strictEqual((await toRequestView(done)).complete, true)
    assert.deepStrictEqual(
      sent.map(({ milestone }) => milestone),
      ["readable", "synced"],
    )
    const dismissed = await dismissRequest(requester, request.uuid)
    assert.ok(dismissed.closedAt)
  })

  it("leaves the seed folder exactly as it was", async () => {
    assert.deepStrictEqual(await listTree(seedDir), seedBefore)
  })

  it("shows and sends the housemate nothing", async () => {
    assert.deepStrictEqual(await getBooks(null, housemate), [])
    assert.deepStrictEqual(await getBookRequestsForUser(housemate), [])
    assert.ok(sent.every(({ userId }) => userId === requester))
    assert.strictEqual((await getBooks(null, requester)).length, 1)
  })

  it("tells each reader in the picker where the book already is", async () => {
    // the catalog title has no subtitle; the book's file does
    const work = { title: "Moby Dick", authors: ["Herman Melville"] }
    const mine = await findLibraryCopies(work, requester)
    assert.deepStrictEqual(
      mine.mine.map((copy) => copy.bookUuid),
      [request.bookUuid],
    )
    const theirs = await findLibraryCopies(work, housemate)
    assert.deepStrictEqual(theirs.mine, [])
    assert.deepStrictEqual(
      theirs.elsewhere.map((copy) => copy.bookUuid),
      [request.bookUuid],
    )
  })

  it("puts the same book on the housemate's shelf when they request it too", async () => {
    const theirs = await createRequest(
      housemate,
      {
        kind: "title",
        input: { text: "Moby Dick" },
        work: { title: "Moby Dick", authors: ["Herman Melville"] },
        ebook: { source: SOURCE, id: "ebook-1", kind: "ebook" },
        audio: { source: SOURCE, id: "audio-1", kind: "audio" },
      },
      adapter,
    )
    const engine = new RequestEngine({ adapter, seedDir, notify })
    await engine.tick()
    await engine.tick()

    const finished = await getBookRequest(theirs.uuid)
    assert.strictEqual(finished?.ebookStatus, "ready")
    assert.strictEqual(finished.audioStatus, "ready")
    assert.strictEqual(finished.bookUuid, request.bookUuid)
    assert.strictEqual(finished.alignStatus, "done")

    // no second book, new download or sync
    assert.strictEqual((await getBooks()).length, 1)
    assert.ok(finished.ebookReused && finished.audioReused)
    assert.strictEqual((await getJobs({ type: "book_align" })).length, 1)

    const book = await getBook(request.bookUuid, housemate)
    assert.ok(book, "the housemate sees the book now")
    // the requester's shelf is theirs: its name stays out of the housemate's view
    assert.deepStrictEqual(
      book.collections.map((collection) => collection.uuid),
      [housemateShelf],
    )
    const events = await getBookRequestEvents(theirs.uuid)
    assert.ok(
      events.some((event) => event.message.includes("added to your shelf")),
      JSON.stringify(events),
    )
  })
})
