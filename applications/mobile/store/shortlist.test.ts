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
  pruneShelfBooks,
  rebaseShelfBooks,
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
    syncedBookUuids: [a, b],
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
    syncedBookUuids: [c, a],
    position: 4,
  })
  assert.deepEqual(mergePulledShelves([local], [pulled]), [
    { ...pulled, uuid: a },
  ])
  assert.deepEqual(local.bookUuids, [a, b])
})

test("pulling never overwrites dirty membership, order or metadata", () => {
  const local = shelf({ bookUuids: [c, a], dirty: "true" })
  const pulled = shelf({
    uuid: b,
    bookUuids: [],
    syncedBookUuids: [],
    name: "Changed on server",
  })
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

test("rebasing preserves remote additions while applying local additions", () => {
  assert.deepEqual(rebaseShelfBooks([a], [a, b], [a, c]), [a, c, b])
})

test("rebasing preserves remote removals instead of resurrecting unchanged local books", () => {
  assert.deepEqual(rebaseShelfBooks([a, b], [a, b, c], [a]), [a, c])
})

test("rebasing applies local removals without removing books added on the server", () => {
  assert.deepEqual(rebaseShelfBooks([a, b], [b], [c, a, b]), [c, b])
})

test("rebasing keeps server reordering when local membership changed but order did not", () => {
  assert.deepEqual(rebaseShelfBooks([a, b, c], [a, c], [c, b, a, server]), [
    c,
    a,
    server,
  ])
})

test("rebasing applies local reordering within kept slots without reordering remote-only books", () => {
  assert.deepEqual(
    rebaseShelfBooks([a, b, c], [c, a, b], [a, server, b, otherServer, c]),
    [c, server, a, otherServer, b],
  )
})

test("rebasing appends new local books once in local order even if another device also added them", () => {
  assert.deepEqual(rebaseShelfBooks([a], [c, a, b], [b, a, server, c]), [
    a,
    server,
    c,
    b,
  ])
})

test("rebasing an offline first-use list preserves the existing server shelf", () => {
  assert.deepEqual(rebaseShelfBooks([], [c], [a, b]), [a, b, c])
})

test("rebasing no-op edits preserves the remote order", () => {
  assert.deepEqual(rebaseShelfBooks([a, b], [a, b], [b, c, a]), [b, c, a])
})

test("rebasing concurrent removals can empty the shelf without restoring deleted entries", () => {
  assert.deepEqual(rebaseShelfBooks([a, b], [b], [a]), [])
})

test("rebasing a pruned local list removes deleted or foreign server-book ids", () => {
  const serverBooks = new Set<UUID>([a, c])
  const local = pruneShelfBooks([a, b, server], serverBooks)
  const remote = pruneShelfBooks([a, b, c], serverBooks)
  assert.deepEqual(rebaseShelfBooks([a, b], local, remote), [a, c])
})

test("rebasing retries the same offline intent without treating remote additions as local edits", () => {
  const base = [a]
  const local = [a, b]
  assert.deepEqual(rebaseShelfBooks(base, local, [a, c]), [a, c, b])
  assert.deepEqual(rebaseShelfBooks(base, local, [a]), [a, b])
})

test("acknowledgment rebasing preserves an edit made while a push was in flight", () => {
  const snapshot = [a, b]
  const latest = [b, server]
  const saved = [a, c, b]
  assert.deepEqual(rebaseShelfBooks(snapshot, latest, saved), [c, b, server])
})

test("acknowledgment rebasing accepts the server result unchanged when there were no in-flight edits", () => {
  const snapshot = [a, b]
  const saved = [a, c, b]
  assert.deepEqual(rebaseShelfBooks(snapshot, snapshot, saved), saved)
})

test("rebasing deduplicates inputs and never mutates snapshots", () => {
  const base = Object.freeze([a, a])
  const local = Object.freeze([a, b, b])
  const remote = Object.freeze([c, a, c, b])
  assert.deepEqual(rebaseShelfBooks(base, local, remote), [c, a, b])
  assert.deepEqual(base, [a, a])
  assert.deepEqual(local, [a, b, b])
  assert.deepEqual(remote, [c, a, c, b])
})

test("pruning preserves server-book order without mutating the cached list", () => {
  const cached = Object.freeze([c, a, b, server])
  assert.deepEqual(pruneShelfBooks(cached, new Set<UUID>([a, c])), [c, a])
  assert.deepEqual(cached, [c, a, b, server])
  assert.deepEqual(pruneShelfBooks(cached, new Set<UUID>()), [])
})

test("pruning retains fresh remote books that have not reached the local catalog", () => {
  const remote = [a, c]
  const knownServerBooks = new Set<UUID>([a, ...remote])
  const local = pruneShelfBooks([a, b, c], knownServerBooks)
  assert.deepEqual(local, [a, c])
  assert.deepEqual(rebaseShelfBooks([a, c], local, remote), [a, c])
})
