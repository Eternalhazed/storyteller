import { useMemo } from "react"

import type { BookWithRelations } from "@/database/books"
import { useListBooksQuery } from "@/store/localApi"
import { withoutPeriodicals } from "@/store/periodicals"
import { getSeriesProgress } from "@/store/seriesProgress"

const EMPTY_BOOKS: BookWithRelations[] = []

export function useSeriesProgress() {
  const { data: books = EMPTY_BOOKS } = useListBooksQuery()
  return useMemo(() => getSeriesProgress(withoutPeriodicals(books)), [books])
}
