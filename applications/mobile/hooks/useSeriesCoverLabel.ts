import { seriesCoverLabel } from "@/components/seriesLabel"
import { type BookWithRelations } from "@/database/books"
import { useListBooksQuery } from "@/store/localApi"
import { withoutPeriodicals } from "@/store/periodicals"
import { type SeriesProgress, getSeriesProgress } from "@/store/seriesProgress"

const EMPTY_BOOKS: BookWithRelations[] = []

// Every cover on screen asks for its label; work out series progress once per
// book list rather than once per cover.
const progressByList = new WeakMap<
  readonly BookWithRelations[],
  SeriesProgress[]
>()

function progressFor(books: readonly BookWithRelations[]) {
  let progress = progressByList.get(books)
  if (!progress) {
    progress = getSeriesProgress(withoutPeriodicals(books))
    progressByList.set(books, progress)
  }
  return progress
}

/** "Sharpe #21 · 3 ahead" for a book in a series, otherwise null. */
export function useSeriesCoverLabel(book: BookWithRelations) {
  const { data: books = EMPTY_BOOKS } = useListBooksQuery()
  if (!book.series.length) return null
  return seriesCoverLabel(book, progressFor(books))
}
