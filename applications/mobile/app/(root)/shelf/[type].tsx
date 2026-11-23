import { useLocalSearchParams } from "expo-router"
import { useMemo } from "react"

import { BookGrid } from "@/components/BookGrid"
import { type BookWithRelations } from "@/database/books"
import { useListBooksQuery } from "@/store/localApi"
import { filterNextUp } from "@/store/nextUp"
import { withoutPeriodicals } from "@/store/periodicals"

const EMPTY_BOOKS: BookWithRelations[] = []

type ShelfType =
  | "on-device"
  | "currently-reading"
  | "next-up"
  | "start-reading"
  | "recently-added"

const SHELF_TITLES: Record<ShelfType, string> = {
  "on-device": "On this device",
  "currently-reading": "Currently reading",
  "next-up": "Next up",
  "start-reading": "Start reading",
  "recently-added": "Recently added",
}

export function filterOnDevice(books: BookWithRelations[]) {
  return books
    .filter(
      (book) =>
        book.audiobook?.downloadStatus === "DOWNLOADED" ||
        book.ebook?.downloadStatus === "DOWNLOADED" ||
        book.readaloud?.downloadStatus === "DOWNLOADED",
    )
    .sort(
      (a, b) =>
        new Date(b.createdAt).valueOf() - new Date(a.createdAt).valueOf(),
    )
}

export function filterCurrentlyReading(books: BookWithRelations[]) {
  return books
    .filter((book) => book.status?.name === "Reading")
    .sort((a, b) => (b.position?.timestamp ?? 0) - (a.position?.timestamp ?? 0))
}

export function filterStartReading(books: BookWithRelations[]) {
  return withoutPeriodicals(books)
    .filter((book) => book.status?.name === "To read")
    .sort(
      (a, b) =>
        new Date(b.createdAt).valueOf() - new Date(a.createdAt).valueOf(),
    )
}

export function filterRecentlyAdded(books: BookWithRelations[]) {
  return withoutPeriodicals(books).sort(
    (a, b) => new Date(b.createdAt).valueOf() - new Date(a.createdAt).valueOf(),
  )
}

const SHELF_FILTERS: Record<
  ShelfType,
  (books: BookWithRelations[]) => BookWithRelations[]
> = {
  "on-device": filterOnDevice,
  "currently-reading": filterCurrentlyReading,
  "next-up": filterNextUp,
  "start-reading": filterStartReading,
  "recently-added": filterRecentlyAdded,
}

export default function ShelfScreen() {
  const { type } = useLocalSearchParams() as { type: ShelfType }
  const { data: books = EMPTY_BOOKS } = useListBooksQuery()

  const title = SHELF_TITLES[type] ?? type
  const filterFn = SHELF_FILTERS[type]

  const filteredBooks = useMemo(
    () => (filterFn ? filterFn(books) : []),
    [filterFn, books],
  )

  return <BookGrid title={title} books={filteredBooks} />
}
