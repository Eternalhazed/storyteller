export function filterNextUp<
  Book extends {
    status: { name: string } | null
    series: readonly { uuid: string; position: number | null }[]
  },
>(books: readonly Book[]): Book[] {
  const seriesToBooks = new Map<string, { position: number; book: Book }[]>()
  for (const book of books) {
    for (const series of book.series) {
      if (series.position === null) continue

      let seriesBooks = seriesToBooks.get(series.uuid)
      if (!seriesBooks) {
        seriesBooks = []
        seriesToBooks.set(series.uuid, seriesBooks)
      }
      seriesBooks.push({ position: series.position, book })
    }
  }

  const resultBooks = new Set<Book>()
  for (const seriesBooks of seriesToBooks.values()) {
    seriesBooks.sort((a, b) => a.position - b.position)
    const lastReadBook = seriesBooks.findLast(
      ({ book }) => book.status?.name === "Read",
    )
    if (!lastReadBook) continue

    const nextUnreadBook = seriesBooks.find(
      ({ position, book }) =>
        position > lastReadBook.position && book.status?.name !== "Read",
    )
    if (nextUnreadBook) resultBooks.add(nextUnreadBook.book)
  }

  return Array.from(resultBooks)
}
