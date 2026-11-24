import { Link } from "expo-router"
import { View } from "react-native"

import { type BookWithRelations } from "@/database/books"
import { useRequestsEnabled } from "@/hooks/useBookRequests"
import {
  parseRequestUuid,
  requestListHref,
  requestPickerHref,
} from "@/store/requestNavigation"
import { getFeaturedSeries, type SeriesProgress } from "@/store/seriesProgress"
import { type UUID } from "@/uuid"

import { Button } from "./ui/button"
import { Text } from "./ui/text"

export function RequestsSettingsLink({ serverUuid }: { serverUuid: UUID }) {
  const enabled = useRequestsEnabled(serverUuid)
  return (
    enabled && (
      <Link href={requestListHref(serverUuid)} asChild>
        <Button variant="outline" size="flex" className="my-2">
          <Text>Requests</Text>
        </Button>
      </Link>
    )
  )
}

export function SeriesRequestActions({
  seriesUuid: rawSeriesUuid,
  series,
  book,
}: {
  seriesUuid: string
  series: SeriesProgress
  book?: BookWithRelations
}) {
  const seriesUuid = parseRequestUuid(rawSeriesUuid)
  const last =
    series.books.findLast((entry) =>
      entry.series.some(
        (membership) =>
          membership.uuid === seriesUuid && membership.position !== null,
      ),
    ) ?? (series.books.length === 1 ? series.books[0] : undefined)
  const serverUuid = (book ?? last ?? series.books[0])?.serverUuid
  const enabled = useRequestsEnabled(serverUuid)
  if (!seriesUuid || !serverUuid || !enabled) return null

  const gaps = book
    ? series.missing.filter((position) => position === series.nextMissing)
    : series.missing
  const showSuccessor =
    last?.serverUuid === serverUuid && (!book || book.uuid === last.uuid)
  if (!gaps.length && !showSuccessor) return null

  const authors = gaps.length
    ? [
        ...new Set(
          series.books.flatMap((entry) =>
            entry.authors.map(({ name }) => name),
          ),
        ),
      ]
    : []
  const seriesName = series.name
  return (
    <View className="flex-row flex-wrap gap-2">
      {gaps.map((position) => (
        <Link
          key={position}
          href={requestPickerHref(serverUuid, {
            kind: "gap",
            input: { seriesUuid, seriesName, position },
            work: {
              title: `${seriesName} #${position}`,
              authors,
              series: { name: seriesName, position },
            },
          })}
          asChild
        >
          <Button variant="outline" size="sm">
            <Text>Get #{position}</Text>
          </Button>
        </Link>
      ))}
      {showSuccessor && (
        <Link
          href={requestPickerHref(serverUuid, {
            kind: "successor",
            input: { seriesUuid, sourceBookUuid: last.uuid },
            work: {
              title: seriesName,
              authors: last.authors.map(({ name }) => name),
              series: { name: seriesName, position: null },
            },
          })}
          asChild
        >
          <Button variant="outline" size="sm">
            <Text>Get next book</Text>
          </Button>
        </Link>
      )}
    </View>
  )
}

export function MissingFormatRequestAction({
  book,
}: {
  book: BookWithRelations
}) {
  const { serverUuid } = book
  const enabled = useRequestsEnabled(serverUuid)
  if (!serverUuid || !enabled || !!book.ebook === !!book.audiobook) return null

  const format = book.ebook ? "audio" : "ebook"
  const series = getFeaturedSeries(book)
  const seriesUuid = parseRequestUuid(series?.uuid)
  return (
    <Link
      href={requestPickerHref(serverUuid, {
        kind: "add_format",
        input: seriesUuid ? { seriesUuid } : {},
        bookUuid: book.uuid,
        format,
        work: {
          title: book.title,
          authors: book.authors.map(({ name }) => name),
          language: book.language,
          series: series?.name
            ? { name: series.name, position: series.position }
            : null,
        },
      })}
      asChild
    >
      <Button variant="outline" className="self-start">
        <Text>{format === "audio" ? "Add narration" : "Add ebook"}</Text>
      </Button>
    </Link>
  )
}
