import { type UUID } from "@/uuid"

import { isPeriodical, isPeriodicalsCollection } from "./periodicals"

const DAY = 24 * 60 * 60 * 1000

/** Opened this recently: a book you're actively going between. */
export const JUMP_BACK_IN_DAYS = 14
export const JUMP_BACK_IN_LIMIT = 6
/** Untouched this long: the book is paused rather than in progress. */
export const PAUSED_DAYS = 60
export const NEARLY_DONE_FROM = 0.5
export const NEARLY_DONE_IDLE_DAYS = 14
export const NEW_READALOUD_DAYS = 30

export type HomeBook = {
  uuid: UUID
  title: string
  createdAt: string
  alignedAt: string | null
  status: { name: string } | null
  position: {
    timestamp: number
    locator: { locations?: { totalProgression?: number } }
  } | null
  series: readonly { uuid: string; position: number | null }[]
  collections: readonly { uuid: string; name: string }[]
  readaloud: { status?: string } | null
}

export type HomeItem<Book> = { book: Book; reason: string | null }

export type HomeSection<Book> = {
  /** A built-in section id, `collection:<uuid>`, or `shelf:<uuid>`. */
  id: string
  /** The preference id that shows, hides and orders this section. */
  preferenceId: string
  title: string
  items: HomeItem<Book>[]
  viewAll: { pathname: string; params?: Record<string, string> } | null
}

export type HomeInputs<Book extends HomeBook> = {
  books: readonly Book[]
  now: number
  /** The book on the Continue card, claimed before any row. */
  continueBookUuid: UUID | null
  shortlist: readonly UUID[]
  /** Next unfinished book per started series, most recently active first. */
  seriesNext: readonly { bookUuid: UUID; reason: string }[]
  /** The first owned book of each series not started yet. */
  seriesStarts: readonly { bookUuid: UUID; reason: string }[]
  /** The account's shelves from the web app, other than the Shortlist. */
  shelves: readonly { uuid: string; name: string; bookUuids: readonly UUID[] }[]
  collections: readonly { uuid: string; name: string }[]
  order: readonly string[]
  hidden: readonly string[]
  /** Show each book once, in the first section that claims it. */
  dedupe: boolean
}

/** Sections whose books are suggestions, so a book appears in only one. */
const DEDUPED: Record<string, true> = {
  continue: true,
  jumpBackIn: true,
  shortlist: true,
  nextInSeries: true,
  nearlyDone: true,
  startSeries: true,
  newReadalouds: true,
  toRead: true,
  recentlyAdded: true,
}

export function progressOf(book: HomeBook) {
  const progress = book.position?.locator.locations?.totalProgression
  return typeof progress === "number" && Number.isFinite(progress)
    ? Math.min(1, Math.max(0, progress))
    : 0
}

export function percent(progress: number) {
  return `${Math.round(progress * 100)}%`
}

export function timeAgo(then: number, now: number) {
  const days = Math.floor((now - then) / DAY)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 60) return `${days} days ago`
  const months = Math.round(days / 30)
  return months < 12 ? `${months} months ago` : "over a year ago"
}

function isFinished(book: HomeBook) {
  return book.status?.name === "Read"
}

/** Started and not finished: a "Reading" status or any progress. */
export function isInProgress(book: HomeBook) {
  return (
    !isFinished(book) &&
    (book.status?.name === "Reading" || progressOf(book) > 0)
  )
}

function lastOpened(book: HomeBook) {
  return book.position?.timestamp ?? 0
}

function byNewest(a: HomeBook, b: HomeBook) {
  return new Date(b.createdAt).valueOf() - new Date(a.createdAt).valueOf()
}

export function isPaused(book: HomeBook, now: number) {
  return isInProgress(book) && now - lastOpened(book) > PAUSED_DAYS * DAY
}

/**
 * Every Home section for these inputs, in the reader's order, without the
 * hidden ones. With `dedupe`, a book shown by an earlier suggestion section
 * is left out of later ones; collections and web shelves are never deduped.
 */
export function buildHomeSections<Book extends HomeBook>(
  inputs: HomeInputs<Book>,
): HomeSection<Book>[] {
  const { books, now } = inputs
  const byUuid = new Map(books.map((book) => [book.uuid, book]))
  const lookup = (uuids: readonly UUID[]) =>
    uuids.flatMap((uuid) => {
      const book = byUuid.get(uuid)
      return book ? [book] : []
    })
  const plain = (list: readonly Book[]) =>
    list.map((book) => ({ book, reason: null }))
  const reading = books.filter((book) => !isPeriodical(book))

  const build: Record<string, () => HomeSection<Book>[]> = {
    continue: () => {
      const book = inputs.continueBookUuid
        ? byUuid.get(inputs.continueBookUuid)
        : undefined
      return [
        {
          id: "continue",
          preferenceId: "continue",
          title: "Continue",
          items: book ? [{ book, reason: null }] : [],
          viewAll: null,
        },
      ]
    },
    jumpBackIn: () => [
      {
        id: "jumpBackIn",
        preferenceId: "jumpBackIn",
        title: "Jump back in",
        items: reading
          .filter(
            (book) =>
              isInProgress(book) &&
              now - lastOpened(book) <= JUMP_BACK_IN_DAYS * DAY,
          )
          .sort((a, b) => lastOpened(b) - lastOpened(a))
          .map((book) => {
            const opened = timeAgo(lastOpened(book), now)
            const progress = progressOf(book)
            return {
              book,
              reason:
                progress > 0
                  ? `${opened[0]!.toUpperCase()}${opened.slice(1)} · ${percent(progress)}`
                  : `Opened ${opened}`,
            }
          }),
        viewAll: {
          pathname: "/shelf/[type]",
          params: { type: "jump-back-in" },
        },
      },
    ],
    shortlist: () => [
      {
        id: "shortlist",
        preferenceId: "shortlist",
        title: "Shortlist",
        items: lookup(inputs.shortlist)
          .filter((book) => !isFinished(book))
          .map((book) => {
            const progress = progressOf(book)
            return { book, reason: progress > 0 ? percent(progress) : null }
          }),
        viewAll: { pathname: "/shortlist" },
      },
    ],
    nextInSeries: () => [
      {
        id: "nextInSeries",
        preferenceId: "nextInSeries",
        title: "Next in your series",
        items: inputs.seriesNext.flatMap(({ bookUuid, reason }) => {
          const book = byUuid.get(bookUuid)
          return book && !isFinished(book) ? [{ book, reason }] : []
        }),
        viewAll: { pathname: "/series" },
      },
    ],
    forYou: () => [
      {
        id: "forYou",
        preferenceId: "forYou",
        title: "For you",
        items: [],
        viewAll: null,
      },
    ],
    nearlyDone: () => [
      {
        id: "nearlyDone",
        preferenceId: "nearlyDone",
        title: "Nearly done",
        items: reading
          .filter(
            (book) =>
              isInProgress(book) &&
              progressOf(book) >= NEARLY_DONE_FROM &&
              now - lastOpened(book) > NEARLY_DONE_IDLE_DAYS * DAY,
          )
          .sort((a, b) => progressOf(b) - progressOf(a))
          .map((book) => ({
            book,
            reason: `${percent(progressOf(book))} · last opened ${timeAgo(lastOpened(book), now)}`,
          })),
        viewAll: { pathname: "/shelf/[type]", params: { type: "nearly-done" } },
      },
    ],
    startSeries: () => [
      {
        id: "startSeries",
        preferenceId: "startSeries",
        title: "Start a new series",
        items: inputs.seriesStarts.flatMap(({ bookUuid, reason }) => {
          const book = byUuid.get(bookUuid)
          return book && !isInProgress(book) && !isFinished(book)
            ? [{ book, reason }]
            : []
        }),
        viewAll: { pathname: "/series", params: { filter: "notStarted" } },
      },
    ],
    newReadalouds: () => [
      {
        id: "newReadalouds",
        preferenceId: "newReadalouds",
        title: "New read-alongs",
        items: reading
          .filter((book) => {
            if (book.readaloud?.status !== "ALIGNED") return false
            if (isInProgress(book) || isFinished(book)) return false
            const ready = new Date(book.alignedAt ?? book.createdAt).valueOf()
            return now - ready <= NEW_READALOUD_DAYS * DAY
          })
          .sort(
            (a, b) =>
              new Date(b.alignedAt ?? b.createdAt).valueOf() -
              new Date(a.alignedAt ?? a.createdAt).valueOf(),
          )
          .map((book) => ({
            book,
            reason: `Ready ${timeAgo(new Date(book.alignedAt ?? book.createdAt).valueOf(), now)}`,
          })),
        viewAll: {
          pathname: "/shelf/[type]",
          params: { type: "new-readalouds" },
        },
      },
    ],
    toRead: () => [
      {
        id: "toRead",
        preferenceId: "toRead",
        title: "To read",
        // Books in a series are offered by the series sections instead.
        items: plain(
          reading
            .filter(
              (book) =>
                book.status?.name === "To read" &&
                !isInProgress(book) &&
                !book.series.some((series) => series.position !== null),
            )
            .sort(byNewest),
        ),
        viewAll: { pathname: "/shelf/[type]", params: { type: "to-read" } },
      },
    ],
    recentlyAdded: () => [
      {
        id: "recentlyAdded",
        preferenceId: "recentlyAdded",
        title: "Recently added",
        items: plain([...reading].sort(byNewest)),
        viewAll: {
          pathname: "/shelf/[type]",
          params: { type: "recently-added" },
        },
      },
    ],
    magazines: () =>
      inputs.collections
        .filter(isPeriodicalsCollection)
        .map((collection) => collectionSection(collection, "magazines")),
    collections: () =>
      inputs.collections
        .filter((collection) => !isPeriodicalsCollection(collection))
        .map((collection) => collectionSection(collection, "collections")),
    paused: () => [
      {
        id: "paused",
        preferenceId: "paused",
        title: "Paused",
        items: reading
          .filter((book) => isPaused(book, now))
          .sort((a, b) => lastOpened(b) - lastOpened(a))
          .map((book) => ({
            book,
            reason: book.position
              ? `${percent(progressOf(book))} · last opened ${timeAgo(lastOpened(book), now)}`
              : null,
          })),
        viewAll: { pathname: "/shelf/[type]", params: { type: "paused" } },
      },
    ],
  }

  function collectionSection(
    collection: { uuid: string; name: string },
    preferenceId: string,
  ): HomeSection<Book> {
    return {
      id: `collection:${collection.uuid}`,
      preferenceId,
      title: collection.name,
      items: plain(
        books
          .filter((book) =>
            book.collections.some(({ uuid }) => uuid === collection.uuid),
          )
          .sort(byNewest),
      ),
      viewAll: {
        pathname: "/collection/[uuid]",
        params: { uuid: collection.uuid },
      },
    }
  }

  for (const shelf of inputs.shelves) {
    build[`shelf:${shelf.uuid}`] = () => [
      {
        id: `shelf:${shelf.uuid}`,
        preferenceId: `shelf:${shelf.uuid}`,
        title: shelf.name,
        items: plain(lookup(shelf.bookUuids)),
        viewAll: {
          pathname: "/shelf/[type]",
          params: { type: "shelf", uuid: shelf.uuid },
        },
      },
    ]
  }

  const claimed = new Set<UUID>()
  return resolveOrder(inputs.order, Object.keys(build))
    .filter((id) => !inputs.hidden.includes(id))
    .flatMap((id) => build[id]?.() ?? [])
    .map((section) => {
      if (!inputs.dedupe || !DEDUPED[section.preferenceId]) return section
      const items = section.items.filter(({ book }) => !claimed.has(book.uuid))
      const limit =
        section.preferenceId === "jumpBackIn" ? JUMP_BACK_IN_LIMIT : Infinity
      const shown = items.slice(0, limit)
      for (const { book } of shown) claimed.add(book.uuid)
      return { ...section, items: shown }
    })
}

/**
 * The reader's saved order, with sections it doesn't mention yet (a new
 * built-in, or a shelf just made on the web) placed where they belong by
 * default: For you after Next in your series, shelves before To read.
 */
export function resolveOrder(
  saved: readonly string[],
  available: readonly string[],
): string[] {
  const order = saved.filter((id) => available.includes(id))
  for (const id of available) {
    if (id === "forYou") continue
    if (order.includes(id)) continue
    const before = id.startsWith("shelf:") ? order.indexOf("toRead") : -1
    if (before === -1) order.push(id)
    else order.splice(before, 0, id)
  }
  if (available.includes("forYou") && !order.includes("forYou")) {
    const next = order.indexOf("nextInSeries")
    if (next === -1) order.push("forYou")
    else order.splice(next + 1, 0, "forYou")
  }
  return order
}
