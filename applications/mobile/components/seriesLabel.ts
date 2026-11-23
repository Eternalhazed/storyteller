import {
  getFeaturedSeries,
  type SeriesProgress,
  type SeriesProgressBook,
} from "@/store/seriesProgress"

export function seriesCardLabel<Book extends SeriesProgressBook>(
  series: SeriesProgress<Book>,
): string {
  if (series.state === "notStarted") return `Not started · ${series.owned}`
  if (series.nextMissing !== null)
    return `#${series.nextMissing} not in library`
  if (series.state === "caughtUp") return "Caught up"
  return series.ahead.length === 1 ? "1 left" : `${series.ahead.length} ahead`
}

export function seriesCoverLabel<Book extends SeriesProgressBook>(
  book: Book,
  progress: readonly SeriesProgress<Book>[] = [],
): string | null {
  const series = getFeaturedSeries(book)
  if (!series) return null
  const label = `${series.name ?? ""}${series.position === null ? "" : ` #${series.position}`}`
  const current = progress.find((entry) => entry.uuid === series.uuid)
  return current?.state === "inProgress" && current.ahead.length > 0
    ? `${label} · ${seriesCardLabel(current)}`
    : label
}
