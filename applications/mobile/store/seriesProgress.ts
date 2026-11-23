import type { BookWithRelations } from "@/database/books"

export type SeriesMembership = {
  uuid: string
  name?: string
  position: number | null
  featured?: "true" | "false" | boolean
}

export type SeriesProgressBook = {
  status: { name: string } | null
  series: readonly SeriesMembership[]
  position?: {
    timestamp: number
    locator: { locations?: { totalProgression?: number } }
  } | null
}

export type SeriesState = "notStarted" | "inProgress" | "caughtUp"

export type SeriesProgress<
  Book extends SeriesProgressBook = BookWithRelations,
> = {
  uuid: string
  name: string
  books: Book[]
  furthestRead: number | null
  ahead: Book[]
  behind: Book[]
  next: Book | null
  missing: number[]
  nextMissing: number | null
  state: SeriesState
  lastActivity: number
  owned: number
}

export function getFeaturedSeries<Book extends SeriesProgressBook>(book: Book) {
  return (
    book.series.find(
      (series) => series.featured === "true" || series.featured === true,
    ) ??
    book.series[0] ??
    null
  )
}

/** Finished means Read, even when the reader has skipped earlier volumes. */
export function getSeriesProgress<Book extends SeriesProgressBook>(
  books: readonly Book[],
): SeriesProgress<Book>[] {
  const grouped = new Map<
    string,
    { name: string; entries: { book: Book; position: number | null }[] }
  >()
  for (const book of books) {
    for (const series of book.series) {
      let group = grouped.get(series.uuid)
      if (!group) {
        group = { name: series.name ?? "", entries: [] }
        grouped.set(series.uuid, group)
      }
      group.entries.push({ book, position: series.position })
    }
  }

  return Array.from(grouped, ([uuid, { name, entries }]) => {
    entries.sort((a, b) => {
      if (a.position === null) return b.position === null ? 0 : 1
      if (b.position === null) return -1
      return a.position - b.position
    })

    let furthestRead: number | null = null
    let started = false
    let lastActivity = 0
    let highestInteger = 0
    const ownedPositions = new Set<number>()
    for (const { book, position } of entries) {
      const finished = book.status?.name === "Read"
      if (
        finished ||
        book.status?.name === "Reading" ||
        (book.position?.locator.locations?.totalProgression ?? 0) > 0
      ) {
        started = true
      }
      lastActivity = Math.max(lastActivity, book.position?.timestamp ?? 0)
      if (position === null) continue
      ownedPositions.add(position)
      if (Number.isInteger(position))
        highestInteger = Math.max(highestInteger, position)
      if (finished && (furthestRead === null || position > furthestRead)) {
        furthestRead = position
      }
    }

    const ahead: Book[] = []
    const behind: Book[] = []
    for (const { book, position } of entries) {
      if (position === null || book.status?.name === "Read") continue
      if (furthestRead === null || position > furthestRead) ahead.push(book)
      else if (position < furthestRead) behind.push(book)
    }

    const missing: number[] = []
    for (let position = 1; position <= highestInteger; position++) {
      if (!ownedPositions.has(position)) missing.push(position)
    }
    const following = furthestRead === null ? null : furthestRead + 1
    const nextMissing =
      ahead.length === 0 &&
      following !== null &&
      Number.isInteger(following) &&
      !ownedPositions.has(following)
        ? following
        : null

    return {
      uuid,
      name,
      books: entries.map(({ book }) => book),
      furthestRead,
      ahead,
      behind,
      next: ahead[0] ?? null,
      missing,
      nextMissing,
      state: !started ? "notStarted" : ahead.length ? "inProgress" : "caughtUp",
      lastActivity,
      owned: entries.length,
    }
  })
}

export function getSeriesProgressByUuid<Book extends SeriesProgressBook>(
  books: readonly Book[],
  seriesUuid: string,
): SeriesProgress<Book> | null {
  return (
    getSeriesProgress(books).find((series) => series.uuid === seriesUuid) ??
    null
  )
}

/** Continue this book's featured series, rather than an unrelated later-read series. */
export function nextInSeriesAfter<
  Book extends SeriesProgressBook & { uuid: string },
>(books: readonly Book[], bookUuid: string): Book | null {
  const book = books.find((candidate) => candidate.uuid === bookUuid)
  if (!book) return null
  const series = getFeaturedSeries(book)
  if (!series || series.position === null) return null
  const currentPosition = series.position
  return (
    getSeriesProgressByUuid(books, series.uuid)?.books.find((candidate) => {
      const position = candidate.series.find(
        (entry) => entry.uuid === series.uuid,
      )?.position
      return (
        position !== null &&
        position !== undefined &&
        position > currentPosition &&
        candidate.status?.name !== "Read"
      )
    }) ?? null
  )
}
