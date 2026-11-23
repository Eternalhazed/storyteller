import assert from "node:assert/strict"
import { test } from "vitest"

import { type Shelf } from "@/database/shelves"
import { type UUID } from "@/uuid"

import {
  addToShortlist,
  applyShortlistChange,
  getShortlists,
  isShortlistShelf,
  mergePulledShelves,
  moveShortlistBook,
  removeFromShortlist,
  sameBookOrder,
  shouldRemoveFromShortlist,
  toggleShortlist,
} from "./shortlist"

const a: UUID = "00000000-0000-0000-0000-000000000001"
const b: UUID = "00000000-0000-0000-0000-000000000002"
const c: UUID = "00000000-0000-0000-0000-000000000003"
const server: UUID = "10000000-0000-0000-0000-000000000001"
const otherServer: UUID = "10000000-0000-0000-0000-000000000002"

function shelf(overrides: Partial<Shelf> = {}): Shelf {
  return {
    uuid: a,
    remoteUuid: b,
    serverUuid: server,
    name: "Shortlist",
    kind: "manual",
    position: 0,
    bookUuids: [a, b],
    dirty: "false",
    createdAt: "2026-01-01 00:00:00",
    updatedAt: "2026-01-01 00:00:00",
    ...overrides,
  }
}

test("adding appends only once without mutating the input", () => {
  const books = [a, b]
  assert.deepEqual(addToShortlist(books, c), [a, b, c])
  assert.equal(addToShortlist(books, a), books)
  assert.deepEqual(books, [a, b])
})

test("removing keeps the relative order and removes all duplicate entries", () => {
  const books = [a, b, a, c]
  assert.deepEqual(removeFromShortlist(books, a), [b, c])
  assert.equal(removeFromShortlist(books, server), books)
  assert.deepEqual(books, [a, b, a, c])
})

test("toggling removes an existing book or appends a new one", () => {
  assert.deepEqual(toggleShortlist([a, b], a), [b])
  assert.deepEqual(toggleShortlist([a, b], c), [a, b, c])
  assert.deepEqual(toggleShortlist([], a), [a])
})

test("moving swaps one neighbour and never mutates the original", () => {
  const books = [a, b, c]
  assert.deepEqual(moveShortlistBook(books, b, "up"), [b, a, c])
  assert.deepEqual(moveShortlistBook(books, b, "down"), [a, c, b])
  assert.deepEqual(books, [a, b, c])
})

test("moving at an edge or moving a missing book is a no-op", () => {
  const books = [a, b]
  assert.equal(moveShortlistBook(books, a, "up"), books)
  assert.equal(moveShortlistBook(books, b, "down"), books)
  assert.equal(moveShortlistBook(books, c, "up"), books)
  assert.deepEqual(moveShortlistBook([], a, "down"), [])
})

test("the mutation operations use the same ordering rules", () => {
  assert.deepEqual(applyShortlistChange([a], b, "add"), [a, b])
  assert.deepEqual(applyShortlistChange([a], a, "remove"), [])
  assert.deepEqual(applyShortlistChange([a], b, "toggle"), [a, b])
  assert.deepEqual(applyShortlistChange([a, b], b, "up"), [b, a])
  assert.deepEqual(applyShortlistChange([a, b], a, "down"), [b, a])
})

test("only a case-insensitive manual Shortlist is selected", () => {
  assert.equal(isShortlistShelf(shelf({ name: "SHORTlist" })), true)
  assert.equal(
    isShortlistShelf(shelf({ name: "Shortlist", kind: "smart" })),
    false,
  )
  assert.equal(isShortlistShelf(shelf({ name: "My Shortlist" })), false)
})

test("duplicate Shortlists use the oldest shelf separately for each server", () => {
  const newer = shelf({
    uuid: c,
    remoteUuid: c,
    createdAt: "2026-02-01 00:00:00",
  })
  const oldest = shelf({ name: "shortLIST" })
  const other = shelf({ uuid: b, serverUuid: otherServer })
  assert.deepEqual(getShortlists([newer, oldest, other]), [oldest, other])
})

test("equal creation times choose a stable remote uuid regardless of pull order", () => {
  const first = shelf({ uuid: b, remoteUuid: a })
  const second = shelf({ uuid: c, remoteUuid: b })
  assert.deepEqual(getShortlists([second, first]), [first])
  assert.deepEqual(getShortlists([first, second]), [first])
})

test("pulling clean shelves replaces membership, order and metadata but preserves local ids", () => {
  const local = shelf()
  const pulled = shelf({
    uuid: c,
    name: "Next",
    bookUuids: [c, a],
    position: 4,
  })
  assert.deepEqual(mergePulledShelves([local], [pulled]), [
    { ...pulled, uuid: a },
  ])
  assert.deepEqual(local.bookUuids, [a, b])
})

test("pulling never overwrites dirty membership, order or metadata", () => {
  const local = shelf({ bookUuids: [c, a], dirty: "true" })
  const pulled = shelf({ uuid: b, bookUuids: [], name: "Changed on server" })
  assert.equal(mergePulledShelves([local], [pulled])[0], local)
})

test("pulling deletes only clean missing shelves and retains pending and dirty shelves", () => {
  const clean = shelf()
  const dirty = shelf({ uuid: b, remoteUuid: c, dirty: "true" })
  const pending = shelf({ uuid: c, remoteUuid: null, dirty: "true" })
  assert.deepEqual(mergePulledShelves([clean, dirty, pending], []), [
    dirty,
    pending,
  ])
})

test("pulling keeps manual and evaluated smart shelf order as returned by the server", () => {
  const smart = shelf({
    uuid: c,
    remoteUuid: c,
    kind: "smart",
    bookUuids: [c, b, a],
  })
  const manual = shelf({ bookUuids: [b, a] })
  assert.deepEqual(mergePulledShelves([], [smart, manual]), [smart, manual])
})

test("remote shelf ids are scoped to the configured server", () => {
  const local = shelf({ dirty: "true" })
  const pulled = shelf({ uuid: c, serverUuid: otherServer, bookUuids: [c] })
  assert.deepEqual(mergePulledShelves([local], [pulled]), [pulled, local])
})

test("book order comparison detects in-flight changes including removals", () => {
  assert.equal(sameBookOrder([a, b], [a, b]), true)
  assert.equal(sameBookOrder([a, b], [b, a]), false)
  assert.equal(sameBookOrder([a], [a, b]), false)
  assert.equal(sameBookOrder([], []), true)
})

test("finished books always leave the Shortlist and starting follows the preference", () => {
  assert.equal(shouldRemoveFromShortlist("Read", "started"), true)
  assert.equal(shouldRemoveFromShortlist("Read", "finished"), true)
  assert.equal(shouldRemoveFromShortlist("Reading", "started"), true)
  assert.equal(shouldRemoveFromShortlist("Reading", "finished"), false)
  assert.equal(shouldRemoveFromShortlist("To read", "started"), false)
})

test("a pending offline list stays visible until it is adopted by the server shelf", () => {
  const pending = shelf({
    uuid: c,
    remoteUuid: null,
    dirty: "true",
    createdAt: "2026-03-01 00:00:00",
  })
  const remote = shelf()
  assert.deepEqual(getShortlists([remote, pending]), [pending])
  assert.deepEqual(getShortlists([pending, remote]), [pending])
})
