import assert from "node:assert"

import { describe, it } from "vitest"

import {
  type TestDbContext,
  seedBooks,
  seedUser,
  seedSeries,
  setupTestDb,
} from "@/__tests__/harness/testDb"
import { getNextUpInSeries } from "@/database/nextUp"
import { type UUID } from "@/uuid"

const userId = "11111111-1111-1111-1111-111111111111" as UUID

function setStatus(
  ctx: TestDbContext,
  bookUuid: string,
  statusName: string,
  readerId = userId,
  updatedAt: string | null = null,
) {
  ctx.sqlite
    .prepare(
      `INSERT INTO book_to_status (book_uuid, status_uuid, user_id, updated_at)
       VALUES (?, (SELECT uuid FROM status WHERE name = ?), ?, COALESCE(?, CURRENT_TIMESTAMP))`,
    )
    .run(bookUuid, statusName, readerId, updatedAt)
}

function setPosition(ctx: TestDbContext, bookUuid: string, timestamp: number) {
  ctx.sqlite
    .prepare(
      `INSERT INTO position (book_uuid, user_id, locator, timestamp) VALUES (?, ?, '{}', ?)`,
    )
    .run(bookUuid, userId, timestamp)
}

describe("getNextUpInSeries", () => {
  it("returns the lowest unread position above the highest read one", async () => {
    using ctx = setupTestDb()
    seedUser(ctx, userId)

    const [b1, b2, b3, b4] = seedBooks(ctx, [
      { title: "one" },
      { title: "two" },
      { title: "three" },
      { title: "four" },
    ]) as [string, string, string, string]
    seedSeries(ctx, "saga", [
      [b1, 1],
      [b2, 2],
      [b3, 3],
      [b4, 4],
    ])
    setStatus(ctx, b1, "Read")
    setStatus(ctx, b2, "Read")
    setStatus(ctx, b3, "To read")
    setStatus(ctx, b4, "To read")

    const books = await getNextUpInSeries(userId)
    assert.deepStrictEqual(
      books.map((b) => b.title),
      ["three"],
    )
  })

  it("keeps the first unfinished book eligible while it is being read", async () => {
    using ctx = setupTestDb()
    seedUser(ctx, userId)

    const [b1, b2, b3] = seedBooks(ctx, [
      { title: "one" },
      { title: "two" },
      { title: "three" },
    ]) as [string, string, string]
    seedSeries(ctx, "saga", [
      [b1, 1],
      [b2, 2],
      [b3, 3],
    ])
    setStatus(ctx, b1, "Read")
    setStatus(ctx, b2, "Reading")
    setStatus(ctx, b3, "To read")

    const books = await getNextUpInSeries(userId)
    assert.deepStrictEqual(
      books.map((b) => b.title),
      ["two"],
    )
  })

  it("does not surface untouched or fully read series", async () => {
    using ctx = setupTestDb()
    seedUser(ctx, userId)

    const [b1, b2, b3, b4] = seedBooks(ctx, [
      { title: "fresh 1" },
      { title: "fresh 2" },
      { title: "done 1" },
      { title: "done 2" },
    ]) as [string, string, string, string]
    seedSeries(ctx, "untouched", [
      [b1, 1],
      [b2, 2],
    ])
    seedSeries(ctx, "finished", [
      [b3, 1],
      [b4, 2],
    ])
    setStatus(ctx, b1, "To read")
    setStatus(ctx, b2, "To read")
    setStatus(ctx, b3, "Read")
    setStatus(ctx, b4, "Read")

    const books = await getNextUpInSeries(userId)
    assert.deepStrictEqual(books, [])
  })

  it("treats custom statuses as unfinished", async () => {
    using ctx = setupTestDb()
    seedUser(ctx, userId)
    ctx.sqlite
      .prepare(`INSERT INTO status (name, is_default) VALUES ('Abandoned', 0)`)
      .run()

    const [b1, b2, b3] = seedBooks(ctx, [
      { title: "one" },
      { title: "two" },
      { title: "three" },
    ]) as [string, string, string]
    seedSeries(ctx, "saga", [
      [b1, 1],
      [b2, 2],
      [b3, 3],
    ])
    setStatus(ctx, b1, "Read")
    setStatus(ctx, b2, "Abandoned")
    setStatus(ctx, b3, "To read")

    const books = await getNextUpInSeries(userId)
    assert.deepStrictEqual(
      books.map((b) => b.title),
      ["two"],
    )
  })

  it("treats a book with no personal status as unfinished", async () => {
    using ctx = setupTestDb()
    seedUser(ctx, userId)

    const [b1, b2, b3] = seedBooks(ctx, [
      { title: "one" },
      { title: "two" },
      { title: "three" },
    ]) as [string, string, string]
    seedSeries(ctx, "saga", [
      [b1, 1],
      [b2, 2],
      [b3, 3],
    ])
    setStatus(ctx, b1, "Read")
    setStatus(ctx, b3, "To read")

    const books = await getNextUpInSeries(userId)
    assert.deepStrictEqual(
      books.map((b) => b.title),
      ["two"],
    )
  })

  it("orders series by most recent reading activity", async () => {
    using ctx = setupTestDb()
    seedUser(ctx, userId)

    const [a1, a2, c1, c2] = seedBooks(ctx, [
      { title: "old series read" },
      { title: "old series next" },
      { title: "active series read" },
      { title: "active series next" },
    ]) as [string, string, string, string]
    seedSeries(ctx, "old", [
      [a1, 1],
      [a2, 2],
    ])
    seedSeries(ctx, "active", [
      [c1, 1],
      [c2, 2],
    ])
    setStatus(ctx, a1, "Read")
    setStatus(ctx, a2, "To read")
    setStatus(ctx, c1, "Read")
    setStatus(ctx, c2, "To read")
    setPosition(ctx, a1, 1_000)
    setPosition(ctx, c1, 2_000)

    const books = await getNextUpInSeries(userId)
    assert.deepStrictEqual(
      books.map((b) => b.title),
      ["active series next", "old series next"],
    )
  })

  it("breaks ties between books sharing a number by oldest added", async () => {
    using ctx = setupTestDb()
    seedUser(ctx, userId)

    // Seeded so both insertion order and title order disagree with
    // created_at order
    const [b1, newer, older] = seedBooks(ctx, [
      { title: "one" },
      { title: "Two (hardcover)" },
      { title: "two (paperback)" },
    ]) as [string, string, string]
    const setCreatedAt = ctx.sqlite.prepare(
      `UPDATE book SET created_at = ? WHERE uuid = ?`,
    )
    setCreatedAt.run("2021-01-01 00:00:00", newer)
    setCreatedAt.run("2020-01-01 00:00:00", older)
    seedSeries(ctx, "saga", [
      [b1, 1],
      [newer, 2],
      [older, 2],
    ])
    setStatus(ctx, b1, "Read")
    setStatus(ctx, newer, "To read")
    setStatus(ctx, older, "To read")

    const books = await getNextUpInSeries(userId)
    assert.deepStrictEqual(
      books.map((b) => b.title),
      ["two (paperback)"],
    )
  })

  it("returns a shared book once even when it is next in two series", async () => {
    using ctx = setupTestDb()
    seedUser(ctx, userId)

    const [b1, b2, shared] = seedBooks(ctx, [
      { title: "read one" },
      { title: "read two" },
      { title: "shared next" },
    ]) as [string, string, string]
    seedSeries(ctx, "first", [
      [b1, 1],
      [shared, 2],
    ])
    seedSeries(ctx, "second", [
      [b2, 1],
      [shared, 2],
    ])
    setStatus(ctx, b1, "Read")
    setStatus(ctx, b2, "Read")
    setStatus(ctx, shared, "To read")

    const books = await getNextUpInSeries(userId)
    assert.deepStrictEqual(
      books.map((b) => b.title),
      ["shared next"],
    )
  })

  it("uses Sharpe's highest finished volume despite earlier unfinished books", async () => {
    using ctx = setupTestDb()
    seedUser(ctx, userId)
    const positions = [
      3,
      ...Array.from({ length: 17 }, (_, index) => index + 6),
    ]
    const uuids = seedBooks(
      ctx,
      positions.map((position) => ({ title: `Sharpe ${position}` })),
    )
    seedSeries(
      ctx,
      "Sharpe",
      uuids.map((uuid, index) => [uuid, positions[index]!]),
    )
    const finished = new Set([6, 10, 11, 12, 14, 15, 16, 18, 19])
    const reading = new Set([3, 8, 9, 13, 17, 20, 22])
    for (const [index, uuid] of uuids.entries()) {
      const position = positions[index]!
      setStatus(
        ctx,
        uuid,
        finished.has(position)
          ? "Read"
          : reading.has(position)
            ? "Reading"
            : "To read",
      )
    }
    assert.deepStrictEqual(
      (await getNextUpInSeries(userId)).map((book) => book.title),
      ["Sharpe 20"],
    )
  })

  it("starts a Reading series without a finished volume at the first unfinished number", async () => {
    using ctx = setupTestDb()
    seedUser(ctx, userId)
    const [first, second, third] = seedBooks(ctx, [
      { title: "first" },
      { title: "second" },
      { title: "third" },
    ]) as [string, string, string]
    seedSeries(ctx, "started", [
      [third, 3],
      [second, 2],
      [first, 1],
    ])
    setStatus(ctx, second, "Reading")
    assert.deepStrictEqual(
      (await getNextUpInSeries(userId)).map((book) => book.uuid),
      [first],
    )
  })

  it("ignores null positions for both ordering and finished anchors", async () => {
    using ctx = setupTestDb()
    seedUser(ctx, userId)
    const [extra, first, second] = seedBooks(ctx, [
      { title: "unnumbered" },
      { title: "first" },
      { title: "second" },
    ]) as [string, string, string]
    seedSeries(ctx, "saga", [
      [extra, 0],
      [first, 1],
      [second, 2],
    ])
    ctx.sqlite
      .prepare(`UPDATE book_to_series SET position = NULL WHERE book_uuid = ?`)
      .run(extra)
    setStatus(ctx, extra, "Read")
    setStatus(ctx, first, "To read")
    assert.deepStrictEqual(
      (await getNextUpInSeries(userId)).map((book) => book.uuid),
      [first],
    )
    ctx.sqlite
      .prepare(
        `UPDATE book_to_status SET status_uuid = (SELECT uuid FROM status WHERE name = 'Read') WHERE book_uuid = ?`,
      )
      .run(first)
    setStatus(ctx, second, "Read")
    assert.deepStrictEqual(await getNextUpInSeries(userId), [])
  })

  it("orders decimal positions and never returns an unfinished book at the finished number", async () => {
    using ctx = setupTestDb()
    seedUser(ctx, userId)
    const [first, duplicate, novella, second] = seedBooks(ctx, [
      { title: "first" },
      { title: "duplicate" },
      { title: "novella" },
      { title: "second" },
    ]) as [string, string, string, string]
    seedSeries(ctx, "saga", [
      [second, 2],
      [duplicate, 1],
      [novella, 1.5],
      [first, 1],
    ])
    setStatus(ctx, first, "Read")
    assert.deepStrictEqual(
      (await getNextUpInSeries(userId)).map((book) => book.uuid),
      [novella],
    )
  })

  it("uses personal Read positions without borrowing another household member's status", async () => {
    using ctx = setupTestDb()
    seedUser(ctx, userId)
    const otherUserId = "22222222-2222-2222-2222-222222222222" as UUID
    seedUser(ctx, otherUserId)
    const [first, second, third] = seedBooks(ctx, [
      { title: "first" },
      { title: "second" },
      { title: "third" },
    ]) as [string, string, string]
    seedSeries(ctx, "saga", [
      [first, 1],
      [second, 2],
      [third, 3],
    ])
    setStatus(ctx, first, "Read")
    setStatus(ctx, second, "Read", otherUserId)
    assert.deepStrictEqual(
      (await getNextUpInSeries(userId)).map((book) => book.uuid),
      [second],
    )
    assert.deepStrictEqual(
      (await getNextUpInSeries(otherUserId)).map((book) => book.uuid),
      [third],
    )
  })

  it("keeps getBooks visibility checks when hydrating candidates", async () => {
    using ctx = setupTestDb()
    seedUser(ctx, userId)
    const [first, hidden] = seedBooks(ctx, [
      { title: "read" },
      { title: "private next" },
    ]) as [string, string]
    seedSeries(ctx, "saga", [
      [first, 1],
      [hidden, 2],
    ])
    setStatus(ctx, first, "Read")
    const collectionUuid = "33333333-3333-3333-3333-333333333333"
    ctx.sqlite
      .prepare(
        `INSERT INTO collection (uuid, name, public) VALUES (?, 'Private', 0)`,
      )
      .run(collectionUuid)
    ctx.sqlite
      .prepare(
        `INSERT INTO book_to_collection (book_uuid, collection_uuid) VALUES (?, ?)`,
      )
      .run(hidden, collectionUuid)
    assert.deepStrictEqual(await getNextUpInSeries(userId), [])
  })

  it("keeps the activity limit and uses status activity when reading timestamps tie", async () => {
    using ctx = setupTestDb()
    seedUser(ctx, userId)
    const [oldRead, oldNext, newRead, newNext] = seedBooks(ctx, [
      { title: "old read" },
      { title: "old next" },
      { title: "new read" },
      { title: "new next" },
    ]) as [string, string, string, string]
    seedSeries(ctx, "old", [
      [oldRead, 1],
      [oldNext, 2],
    ])
    seedSeries(ctx, "new", [
      [newRead, 1],
      [newNext, 2],
    ])
    setStatus(ctx, oldRead, "Read", userId, "2024-01-01 00:00:00")
    setStatus(ctx, newRead, "Read", userId, "2025-01-01 00:00:00")
    assert.deepStrictEqual(
      (await getNextUpInSeries(userId, 1)).map((book) => book.uuid),
      [newNext],
    )
  })
})
