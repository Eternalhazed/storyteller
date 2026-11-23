import { useCallback, useMemo } from "react"

import { type BookWithRelations } from "@/database/books"
import {
  useListBooksQuery,
  useListShelvesQuery,
  useUpdateShortlistMutation,
} from "@/store/localApi"
import { type ShortlistChange, getShortlists } from "@/store/shortlist"
import { type UUID } from "@/uuid"

export function canShortlist(
  book: Pick<BookWithRelations, "serverUuid">,
): boolean {
  return book.serverUuid !== null
}

export function useShortlist() {
  const { data: shelves } = useListShelvesQuery()
  const { data: books } = useListBooksQuery()
  const [updateShortlist] = useUpdateShortlistMutation()
  const bookUuids = useMemo(
    () => getShortlists(shelves ?? []).flatMap((shelf) => shelf.bookUuids),
    [shelves],
  )
  const shortlisted = useMemo(() => new Set(bookUuids), [bookUuids])
  const isShortlisted = useCallback(
    (uuid: UUID) => shortlisted.has(uuid),
    [shortlisted],
  )

  const change = useCallback(
    async (bookUuid: UUID, operation: ShortlistChange) => {
      const book = books?.find((book) => book.uuid === bookUuid)
      if (!book?.serverUuid) {
        throw new Error("Only books on a configured server can be shortlisted.")
      }
      await updateShortlist({
        bookUuid,
        serverUuid: book.serverUuid,
        change: operation,
      }).unwrap()
    },
    [books, updateShortlist],
  )
  const toggle = useCallback((uuid: UUID) => change(uuid, "toggle"), [change])
  const add = useCallback((uuid: UUID) => change(uuid, "add"), [change])
  const remove = useCallback((uuid: UUID) => change(uuid, "remove"), [change])
  const move = useCallback(
    (uuid: UUID, direction: "up" | "down") => change(uuid, direction),
    [change],
  )

  return { bookUuids, isShortlisted, canShortlist, toggle, add, remove, move }
}
