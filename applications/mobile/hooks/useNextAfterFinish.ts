import { useMemo } from "react"

import { type BookWithRelations } from "@/database/books"
import { useListBooksQuery } from "@/store/localApi"
import { getFeaturedSeries, nextInSeriesAfter } from "@/store/seriesProgress"
import { type UUID } from "@/uuid"

import { useShortlist } from "./useShortlist"

export type NextAfterFinish = {
  book: BookWithRelations
  /** Why this book: the next one in its series, or the top of the Shortlist. */
  reason: "series" | "shortlist"
  /** Short label for the prompt, e.g. "Sharpe #21" or the book's title. */
  label: string
}

const EMPTY_BOOKS: BookWithRelations[] = []

/**
 * The book to offer after finishing `bookUuid`: the next book in its series,
 * otherwise the top of the Shortlist.
 */
export function useNextAfterFinish(bookUuid: UUID): NextAfterFinish | null {
  const { data: books = EMPTY_BOOKS } = useListBooksQuery()
  const { bookUuids: shortlist } = useShortlist()

  return useMemo(() => {
    const inSeries = nextInSeriesAfter(books, bookUuid)
    if (inSeries) {
      const series = getFeaturedSeries(inSeries)
      const label =
        series?.name && series.position !== null
          ? `${series.name} #${series.position}`
          : inSeries.title
      return { book: inSeries, reason: "series", label }
    }

    const top = shortlist
      .filter((uuid) => uuid !== bookUuid)
      .map((uuid) => books.find((book) => book.uuid === uuid))
      .find((book) => book && book.status?.name !== "Read")
    return top ? { book: top, reason: "shortlist", label: top.title } : null
  }, [books, bookUuid, shortlist])
}
