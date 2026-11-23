import { useLocalSearchParams } from "expo-router"
import { useMemo } from "react"

import { BookGrid } from "@/components/BookGrid"
import { type BookWithRelations } from "@/database/books"
import { type Collection } from "@/database/collections"
import { useHomeSeriesInputs } from "@/hooks/useHomeSeriesInputs"
import { useServerShelves } from "@/hooks/useServerShelves"
import { buildHomeSections } from "@/store/homeSections"
import { useListBooksQuery, useListCollectionsQuery } from "@/store/localApi"

const EMPTY_BOOKS: BookWithRelations[] = []
const EMPTY_COLLECTIONS: Collection[] = []

/** The Home section each "View all" route shows, in full. */
const SECTION_FOR_TYPE: Record<string, string> = {
  "jump-back-in": "jumpBackIn",
  "nearly-done": "nearlyDone",
  "new-readalouds": "newReadalouds",
  "to-read": "toRead",
  "recently-added": "recentlyAdded",
  paused: "paused",
}

export default function ShelfScreen() {
  const { type, uuid } = useLocalSearchParams<{ type: string; uuid?: string }>()
  const { data: books = EMPTY_BOOKS } = useListBooksQuery()
  const { data: collections = EMPTY_COLLECTIONS } = useListCollectionsQuery()
  const shelves = useServerShelves()
  const { seriesNext, seriesStarts } = useHomeSeriesInputs(books)

  const sectionId =
    type === "shelf" && uuid ? `shelf:${uuid}` : SECTION_FOR_TYPE[type]

  const section = useMemo(() => {
    if (!sectionId) return null
    return (
      buildHomeSections({
        books,
        now: Date.now(),
        continueBookUuid: null,
        shortlist: [],
        seriesNext,
        seriesStarts,
        shelves,
        collections,
        order: [sectionId],
        hidden: [],
        dedupe: false,
      }).find((candidate) => candidate.id === sectionId) ?? null
    )
  }, [books, collections, sectionId, seriesNext, seriesStarts, shelves])

  return (
    <BookGrid
      title={section?.title ?? "Books"}
      books={section?.items.map(({ book }) => book) ?? EMPTY_BOOKS}
    />
  )
}
