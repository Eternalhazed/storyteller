import {
  type BookWithRelations,
  getBooks,
  isBookVisibleTo,
} from "@/database/books"
import { addBooksToCollections } from "@/database/collections"
import { type UUID } from "@/uuid"

import { normalize } from "./ranking"
import { RequestError, getRequestCollection } from "./service"
import { type ChosenWork } from "./types"

function isWork(book: BookWithRelations, work: ChosenWork): boolean {
  const titles = new Set(
    [work.title, ...(work.altTitles ?? [])].map(normalize).filter(Boolean),
  )
  if (!titles.has(normalize(book.title))) return false
  if (!work.authors.length) return true
  const authors = new Set(work.authors.map(normalize))
  return book.authors.some((author) => authors.has(normalize(author.name)))
}

export type LibraryCopy = {
  bookUuid: UUID
  ebook: boolean
  audiobook: boolean
  readaloud: boolean
}

function copyOf(book: BookWithRelations): LibraryCopy {
  return {
    bookUuid: book.uuid,
    ebook: !!book.ebook?.filepath && !book.ebook.missing,
    audiobook: !!book.audiobook?.filepath && !book.audiobook.missing,
    readaloud: !!book.readaloud?.filepath && !book.readaloud.missing,
  }
}

/**
 * Copies of the confirmed work already in the library: on the reader's own
 * shelves, and on shelves they cannot see. Of the latter only the id and the
 * formats are returned, enough to offer "Add to my shelf".
 */
export async function findLibraryCopies(
  work: ChosenWork,
  userId: UUID,
): Promise<{ mine: LibraryCopy[]; elsewhere: LibraryCopy[] }> {
  const candidates = (
    await getBooks(null, undefined, { search: work.title })
  ).filter((book) => isWork(book, work))
  const mine: LibraryCopy[] = []
  const elsewhere: LibraryCopy[] = []
  for (const book of candidates) {
    if (await isBookVisibleTo(book.uuid, userId)) mine.push(copyOf(book))
    else elsewhere.push(copyOf(book))
  }
  return { mine, elsewhere }
}

/** Narrators of the reader's books in a series, to match their edition. */
export async function getEditionNarrators(
  userId: UUID,
  seriesUuid: UUID | null | undefined,
): Promise<string[]> {
  if (!seriesUuid) return []
  const books = await getBooks(null, userId, { series: seriesUuid })
  return [
    ...new Set(books.flatMap((book) => book.narrators.map((n) => n.name))),
  ]
}

/**
 * Put a copy of the confirmed work that is on another reader's shelf onto
 * the reader's own: the files are shared, nothing else of theirs is. Only a
 * copy that matches the work can be added this way.
 */
export async function addCopyToShelf(
  userId: UUID,
  work: ChosenWork,
  bookUuid: UUID,
): Promise<void> {
  const collection = await getRequestCollection(userId)
  if (!collection) {
    throw new RequestError(
      "Choose the shelf your requested books go on first",
      409,
      "no-collection",
    )
  }
  const { elsewhere, mine } = await findLibraryCopies(work, userId)
  if (mine.some((copy) => copy.bookUuid === bookUuid)) return
  if (!elsewhere.some((copy) => copy.bookUuid === bookUuid)) {
    throw new RequestError("No such copy of this book", 404, "not-found")
  }
  await addBooksToCollections([collection], [bookUuid])
}
