import { useCallback, useMemo } from "react"

import { seriesCardLabel, seriesCoverLabel } from "@/components/seriesLabel"
import { type BookWithRelations } from "@/database/books"
import { type UUID } from "@/uuid"
import { withoutPeriodicals } from "@/store/periodicals"
import { getSeriesProgress } from "@/store/seriesProgress"

function seriesNumber(book: BookWithRelations, seriesUuid: string) {
  return (
    book.series.find((series) => series.uuid === seriesUuid)?.position ?? null
  )
}

/** The series-driven inputs for Home: next books, series to start, labels. */
export function useHomeSeriesInputs(books: readonly BookWithRelations[]) {
  const progress = useMemo(
    () => getSeriesProgress(withoutPeriodicals(books)),
    [books],
  )

  const seriesNext = useMemo(
    () =>
      progress
        .filter((series) => series.state === "inProgress" && series.next)
        .sort((a, b) => b.lastActivity - a.lastActivity)
        .map((series) => ({
          bookUuid: series.next!.uuid as UUID,
          reason:
            series.furthestRead === null
              ? `Next in ${series.name} · ${seriesCardLabel(series)}`
              : `You finished ${series.name} #${series.furthestRead} · ${seriesCardLabel(series)}`,
        })),
    [progress],
  )

  const seriesStarts = useMemo(
    () =>
      progress
        .filter((series) => series.state === "notStarted")
        .flatMap((series) => {
          const first = series.books[0]
          return first ? [{ series, first }] : []
        })
        // The newest additions are usually the ones picked to start next.
        .sort(
          (a, b) =>
            new Date(b.first.createdAt).valueOf() -
            new Date(a.first.createdAt).valueOf(),
        )
        .map(({ series, first }) => {
          const number = seriesNumber(first, series.uuid)
          return {
            bookUuid: first.uuid as UUID,
            reason:
              number === null || number <= 1
                ? `First book of ${series.name}`
                : `First you own: ${series.name} #${number}`,
          }
        }),
    [progress],
  )

  const coverLabel = useCallback(
    (book: BookWithRelations) => seriesCoverLabel(book, progress),
    [progress],
  )

  return { progress, seriesNext, seriesStarts, coverLabel }
}
