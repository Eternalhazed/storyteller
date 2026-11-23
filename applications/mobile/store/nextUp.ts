import { getSeriesProgress } from "./seriesProgress"

export function filterNextUp<
  Book extends {
    status: { name: string } | null
    series: readonly { uuid: string; position: number | null }[]
  },
>(books: readonly Book[]): Book[] {
  const candidates = getSeriesProgress(books)
    .filter((series) => series.state === "inProgress")
    .sort((a, b) => b.lastActivity - a.lastActivity)
  const result = new Set<Book>()
  for (const series of candidates) {
    if (series.next) result.add(series.next)
  }
  return Array.from(result)
}
