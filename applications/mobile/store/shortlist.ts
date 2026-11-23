import { type Shelf } from "@/database/shelves"
import { type UUID } from "@/uuid"

export type ShortlistChange = "toggle" | "add" | "remove" | "up" | "down"

export function addToShortlist(bookUuids: UUID[], bookUuid: UUID): UUID[] {
  return bookUuids.includes(bookUuid) ? bookUuids : [...bookUuids, bookUuid]
}

export function removeFromShortlist(bookUuids: UUID[], bookUuid: UUID): UUID[] {
  return bookUuids.includes(bookUuid)
    ? bookUuids.filter((uuid) => uuid !== bookUuid)
    : bookUuids
}

export function toggleShortlist(bookUuids: UUID[], bookUuid: UUID): UUID[] {
  return bookUuids.includes(bookUuid)
    ? removeFromShortlist(bookUuids, bookUuid)
    : addToShortlist(bookUuids, bookUuid)
}

export function moveShortlistBook(
  bookUuids: UUID[],
  bookUuid: UUID,
  direction: "up" | "down",
): UUID[] {
  const index = bookUuids.indexOf(bookUuid)
  const destination = index + (direction === "up" ? -1 : 1)
  if (index === -1 || destination < 0 || destination >= bookUuids.length) {
    return bookUuids
  }
  const moved = [...bookUuids]
  const neighbour = moved[destination]!
  moved[destination] = moved[index]!
  moved[index] = neighbour
  return moved
}

export function applyShortlistChange(
  bookUuids: UUID[],
  bookUuid: UUID,
  change: ShortlistChange,
): UUID[] {
  switch (change) {
    case "add":
      return addToShortlist(bookUuids, bookUuid)
    case "remove":
      return removeFromShortlist(bookUuids, bookUuid)
    case "toggle":
      return toggleShortlist(bookUuids, bookUuid)
    case "up":
    case "down":
      return moveShortlistBook(bookUuids, bookUuid, change)
  }
}

export function isShortlistShelf(shelf: Pick<Shelf, "name" | "kind">): boolean {
  return shelf.kind === "manual" && shelf.name.toLowerCase() === "shortlist"
}

/** Use a pending first-use list until it is bound, then the oldest server shelf. */
export function getShortlists(shelves: readonly Shelf[]): Shelf[] {
  const byServer = new Map<UUID, Shelf>()
  for (const shelf of shelves) {
    if (!isShortlistShelf(shelf)) continue
    const previous = byServer.get(shelf.serverUuid)
    const pending = shelf.remoteUuid === null && shelf.dirty === "true"
    const previousPending =
      previous?.remoteUuid === null && previous.dirty === "true"
    if (
      !previous ||
      (pending && !previousPending) ||
      (pending === previousPending &&
        (shelf.createdAt < previous.createdAt ||
          (shelf.createdAt === previous.createdAt &&
            (shelf.remoteUuid ?? shelf.uuid) <
              (previous.remoteUuid ?? previous.uuid))))
    ) {
      byServer.set(shelf.serverUuid, shelf)
    }
  }
  return [...byServer.values()]
}

export function sameBookOrder(a: readonly UUID[], b: readonly UUID[]): boolean {
  return a.length === b.length && a.every((uuid, index) => uuid === b[index])
}

/** Keep offline edits and stable local ids; drop only clean, remotely deleted rows. */
export function mergePulledShelves(
  localShelves: readonly Shelf[],
  pulledShelves: readonly Shelf[],
): Shelf[] {
  const key = (shelf: Shelf) => `${shelf.serverUuid}:${shelf.remoteUuid}`
  const localByRemote = new Map(
    localShelves
      .filter((shelf) => shelf.remoteUuid !== null)
      .map((shelf) => [key(shelf), shelf]),
  )
  const pulledKeys = new Set(pulledShelves.map(key))
  const merged = pulledShelves.map((pulled) => {
    const local = localByRemote.get(key(pulled))
    return local?.dirty === "true"
      ? local
      : { ...pulled, uuid: local?.uuid ?? pulled.uuid }
  })
  for (const local of localShelves) {
    if (local.dirty === "true" && !pulledKeys.has(key(local))) {
      merged.push(local)
    }
  }
  return merged
}

export function shouldRemoveFromShortlist(
  statusName: string,
  removeWhen: "started" | "finished",
): boolean {
  return (
    statusName === "Read" ||
    (statusName === "Reading" && removeWhen === "started")
  )
}
