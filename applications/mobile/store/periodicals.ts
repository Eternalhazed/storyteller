/**
 * Magazines and other periodicals arrive in batches and are read differently
 * from books, so they would otherwise fill the home screen's "Start reading"
 * and "Recently added" shelves. Books in a collection named "Magazines" are
 * kept off those shelves and shown on their own shelf, last, instead.
 */
export const PERIODICALS_COLLECTION = "magazines"

export function isPeriodicalsCollection(collection: { name: string }) {
  return collection.name.trim().toLowerCase() === PERIODICALS_COLLECTION
}

export function isPeriodical(book: {
  collections: readonly { name: string }[]
}) {
  return book.collections.some(isPeriodicalsCollection)
}

export function withoutPeriodicals<
  Book extends { collections: readonly { name: string }[] },
>(books: readonly Book[]): Book[] {
  return books.filter((book) => !isPeriodical(book))
}

/** Collections in their given order, with the periodicals shelf moved last. */
export function periodicalsLast<Collection extends { name: string }>(
  collections: readonly Collection[],
): Collection[] {
  return [
    ...collections.filter((collection) => !isPeriodicalsCollection(collection)),
    ...collections.filter(isPeriodicalsCollection),
  ]
}
