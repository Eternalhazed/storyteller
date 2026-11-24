import assert from "node:assert"
import { randomUUID } from "node:crypto"
import { join, resolve } from "node:path"

import { describe, it, vi } from "vitest"

import { type TestDbContext, setupTestDb } from "@/__tests__/harness/testDb"
import { DeliveryError } from "@/assets/library/deliver"
import {
  type BookRequest,
  getBookRequest,
  getBookRequestEvents,
} from "@/database/bookRequests"
import { type AcquisitionAdapter } from "@/requests/adapter"
import { RequestEngine, STALL_MS, deliverySource } from "@/requests/engine"
import {
  HOUSEHOLD_DAILY_DOWNLOADS,
  RequestError,
  createRequest,
  getOwnRequest,
  setRequestCollection,
} from "@/requests/service"
import {
  type Milestone,
  type Release,
  type TorrentStatus,
} from "@/requests/types"
import { type UUID } from "@/uuid"

vi.mock("@/work/seriesLookup", () => ({
  lookUpSeriesForNewBook: () => Promise.resolve(),
}))

const SEED = resolve("/seed")

function release(id: string, kind: Release["kind"], seeders = 5): Release {
  return {
    source: "src",
    id,
    kind,
    title: id,
    authors: [],
    seeders,
    size: 100,
    infohash: id
      .padEnd(40, "0")
      .slice(0, 40)
      .replace(/[^0-9a-f]/g, "0"),
    files: null,
    facts: {
      narrators: null,
      abridged: null,
      dramatized: null,
      language: null,
      fileTypes: null,
      bitrateKbps: null,
      durationSeconds: null,
      pack: null,
      series: null,
      publishedYear: null,
    },
  }
}

/** A download client held in memory; tests set each torrent's state. */
class MemoryAdapter implements AcquisitionAdapter {
  releases = new Map<string, Release>()
  torrents = new Map<string, TorrentStatus>()
  added: string[] = []

  constructor(releases: Release[]) {
    for (const each of releases) this.releases.set(each.id, each)
  }

  search() {
    return Promise.resolve([...this.releases.values()])
  }

  inspect(ref: { id: string }) {
    const found = this.releases.get(ref.id)
    if (!found) throw new Error("unknown release")
    return Promise.resolve(found)
  }

  add(_ref: unknown, infohash: string, folder: string) {
    const alreadyPresent = this.torrents.has(infohash)
    this.added.push(infohash)
    this.torrents.set(infohash, {
      infohash,
      progress: 0,
      bytesDone: 0,
      seedersConnected: 0,
      state: "downloading",
      folder,
      files: [],
    })
    return Promise.resolve({ infohash, alreadyPresent })
  }

  status(infohashes: string[]) {
    return Promise.resolve(
      infohashes.flatMap((hash) => {
        const torrent = this.torrents.get(hash)
        return torrent ? [torrent] : []
      }),
    )
  }
}

function household(ctx: TestDbContext) {
  const users = [randomUUID(), randomUUID()] as [UUID, UUID]
  for (const userId of users) {
    const permission = randomUUID()
    ctx.sqlite
      .prepare(`INSERT INTO user_permission (uuid, book_read) VALUES (?, 1)`)
      .run(permission)
    ctx.sqlite
      .prepare(
        `INSERT INTO "user" (id, user_permission_uuid, email) VALUES (?, ?, ?)`,
      )
      .run(userId, permission, `${userId}@example.com`)
  }
  return users
}

function giveShelf(ctx: TestDbContext, userId: UUID, isPublic = false) {
  const shelf = randomUUID()
  ctx.sqlite
    .prepare(`INSERT INTO collection (uuid, name, public) VALUES (?, ?, ?)`)
    .run(shelf, `Shelf ${shelf}`, isPublic ? 1 : 0)
  ctx.sqlite
    .prepare(
      `INSERT INTO collection_to_user (user_id, collection_uuid) VALUES (?, ?)`,
    )
    .run(userId, shelf)
  return shelf
}

function engine(adapter: AcquisitionAdapter, clock: { now: number }) {
  const sent: Milestone[] = []
  return {
    sent,
    engine: new RequestEngine({
      adapter,
      seedDir: SEED,
      notify: (_request: BookRequest, milestone: Milestone) => {
        sent.push(milestone)
        return Promise.resolve()
      },
      now: () => clock.now,
    }),
  }
}

async function requestEbook(
  userId: UUID,
  adapter: AcquisitionAdapter,
  id = "e1",
) {
  return await createRequest(
    userId,
    {
      kind: "title",
      input: { text: "Book" },
      work: { title: "Book", authors: [] },
      ebook: { source: "src", id, kind: "ebook" },
    },
    adapter,
  )
}

describe("requests", () => {
  it("need a private shelf the reader belongs to", async () => {
    using ctx = setupTestDb()
    const [reader, other] = household(ctx)
    const theirs = giveShelf(ctx, other)
    const open = giveShelf(ctx, reader, true)
    const adapter = new MemoryAdapter([release("e1", "ebook")])

    await assert.rejects(requestEbook(reader, adapter), {
      code: "no-collection",
    })
    await assert.rejects(setRequestCollection(reader, theirs), {
      code: "invalid-collection",
    })
    await assert.rejects(setRequestCollection(reader, open), {
      code: "invalid-collection",
    })
  })

  it("refuse a release nobody is sharing", async () => {
    using ctx = setupTestDb()
    const [reader] = household(ctx)
    await setRequestCollection(reader, giveShelf(ctx, reader))
    const adapter = new MemoryAdapter([release("e1", "ebook", 0)])
    await assert.rejects(requestEbook(reader, adapter), {
      code: "no-seeders-ebook",
    })
  })

  it("stop at the household's daily downloads, counting reused ones free", async () => {
    using ctx = setupTestDb()
    const [reader, other] = household(ctx)
    await setRequestCollection(reader, giveShelf(ctx, reader))
    await setRequestCollection(other, giveShelf(ctx, other))
    const ids = Array.from({ length: HOUSEHOLD_DAILY_DOWNLOADS + 1 }, (_, i) =>
      `${i}`.padStart(2, "0"),
    )
    const adapter = new MemoryAdapter(ids.map((id) => release(id, "ebook")))

    for (const id of ids.slice(0, HOUSEHOLD_DAILY_DOWNLOADS)) {
      await requestEbook(reader, adapter, id)
    }
    await assert.rejects(requestEbook(other, adapter, ids.at(-1)), {
      code: "daily-limit",
    })
    // the same download for the other reader costs nothing
    await requestEbook(other, adapter, ids[0])
  })

  it("are private to the reader who made them", async () => {
    using ctx = setupTestDb()
    const [reader, other] = household(ctx)
    await setRequestCollection(reader, giveShelf(ctx, reader))
    const request = await requestEbook(
      reader,
      new MemoryAdapter([release("e1", "ebook")]),
    )
    await assert.rejects(getOwnRequest(other, request.uuid), (error) => {
      assert.ok(error instanceof RequestError)
      assert.strictEqual(error.status, 403)
      assert.doesNotMatch(error.message, /Book/)
      return true
    })
  })
})

describe("delivery engine", () => {
  it("re-checks seeders right before adding, and asks for another pick at 0", async () => {
    using ctx = setupTestDb()
    const [reader] = household(ctx)
    await setRequestCollection(reader, giveShelf(ctx, reader))
    const adapter = new MemoryAdapter([release("e1", "ebook")])
    const request = await requestEbook(reader, adapter)

    adapter.releases.set("e1", release("e1", "ebook", 0))
    const { engine: run, sent } = engine(adapter, { now: 0 })
    await run.tick()

    const stored = await getBookRequest(request.uuid)
    assert.strictEqual(stored?.ebookStatus, "choosing")
    assert.deepStrictEqual(adapter.added, [])
    assert.deepStrictEqual(sent, ["ebook-choosing"])
  })

  it("adds a download once, even when the tick runs again", async () => {
    using ctx = setupTestDb()
    const [reader] = household(ctx)
    await setRequestCollection(reader, giveShelf(ctx, reader))
    const adapter = new MemoryAdapter([release("e1", "ebook")])
    const request = await requestEbook(reader, adapter)
    const { engine: run } = engine(adapter, { now: 0 })

    await run.tick()
    await run.tick()
    assert.deepStrictEqual(adapter.added, [request.ebookInfohash])
    const stored = await getBookRequest(request.uuid)
    assert.strictEqual(
      stored?.ebookAddedAt,
      0,
      "the hash was recorded before adding and the add after it",
    )
  })

  it("marks a download stalled after 30 minutes without data, once", async () => {
    using ctx = setupTestDb()
    const [reader] = household(ctx)
    await setRequestCollection(reader, giveShelf(ctx, reader))
    const adapter = new MemoryAdapter([release("e1", "ebook")])
    const request = await requestEbook(reader, adapter)
    const clock = { now: 1_000 }
    const { engine: run, sent } = engine(adapter, clock)
    const hash = request.ebookInfohash!

    await run.tick() // added
    clock.now += STALL_MS - 1
    await run.tick()
    assert.strictEqual(
      (await getBookRequest(request.uuid))?.ebookStatus,
      "downloading",
    )

    clock.now += 1
    await run.tick()
    await run.tick()
    assert.strictEqual(
      (await getBookRequest(request.uuid))?.ebookStatus,
      "stalled",
    )
    assert.deepStrictEqual(sent, ["ebook-stalled"])

    // a seeder comes back: it picks up again, and the torrent was never re-added
    const torrent = adapter.torrents.get(hash)!
    adapter.torrents.set(hash, { ...torrent, bytesDone: 10, progress: 0.1 })
    await run.tick()
    const stored = await getBookRequest(request.uuid)
    assert.strictEqual(stored?.ebookStatus, "downloading")
    assert.strictEqual(stored.ebookProgress, 0.1)
    assert.deepStrictEqual(adapter.added, [hash])
    const events = await getBookRequestEvents(request.uuid)
    assert.deepStrictEqual(
      events.map((event) => event.kind),
      ["requested", "ebook-added", "ebook-stalled", "ebook-resumed"],
    )
  })

  it("fails a download whose files are outside the seed folder", async () => {
    using ctx = setupTestDb()
    const [reader] = household(ctx)
    await setRequestCollection(reader, giveShelf(ctx, reader))
    const adapter = new MemoryAdapter([release("e1", "ebook")])
    const request = await requestEbook(reader, adapter)
    const hash = request.ebookInfohash!
    adapter.torrents.set(hash, {
      infohash: hash,
      progress: 1,
      bytesDone: 100,
      seedersConnected: 1,
      state: "seeding",
      folder: "../elsewhere",
      files: [{ path: "book.epub", size: 100 }],
    })
    const { engine: run, sent } = engine(adapter, { now: 0 })
    await run.tick()

    const stored = await getBookRequest(request.uuid)
    assert.strictEqual(stored?.ebookStatus, "failed")
    assert.match(stored.ebookError ?? "", /outside the seed folder/)
    assert.deepStrictEqual(sent, ["ebook-failed"])
  })
})

describe("deliverySource", () => {
  const torrent = (folder: string | null, paths: string[]): TorrentStatus => ({
    infohash: "0".repeat(40),
    progress: 1,
    bytesDone: 1,
    seedersConnected: 1,
    state: "seeding",
    folder,
    files: paths.map((path) => ({ path, size: 1 })),
  })

  it("takes the folder holding every disc of an audiobook", () => {
    assert.strictEqual(
      deliverySource(
        SEED,
        "audio",
        torrent("src/h", [
          "Book/CD1/01.mp3",
          "Book/CD2/01.mp3",
          "Book/cover.jpg",
        ]),
      ),
      join(SEED, "src", "h", "Book"),
    )
  })

  it("takes the largest EPUB", () => {
    const status = torrent("src/h", [])
    status.files = [
      { path: "small.epub", size: 1 },
      { path: "Book/book.epub", size: 9 },
    ]
    assert.strictEqual(
      deliverySource(SEED, "ebook", status),
      join(SEED, "src", "h", "Book", "book.epub"),
    )
  })

  it("refuses paths that leave the seed folder", () => {
    for (const status of [
      torrent("../../etc", ["passwd.epub"]),
      torrent("src/h", ["../../../outside.epub"]),
      torrent(null, ["book.epub"]),
    ]) {
      assert.throws(
        () => deliverySource(SEED, "ebook", status),
        (error) => error instanceof DeliveryError && !error.retryable,
      )
    }
  })
})
