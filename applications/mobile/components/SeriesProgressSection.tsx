import { Link } from "expo-router"
import { useState } from "react"
import { View } from "react-native"

import type { BookWithRelations } from "@/database/books"
import { describeError } from "@/describeError"
import { useAvailableFormats } from "@/hooks/useAvailableFormats"
import { useDownloadedFormats } from "@/hooks/useDownloadedFormats"
import { useSeriesProgress } from "@/hooks/useSeriesProgress"
import { useAppSelector } from "@/store/appState"
import { useDownloadBookMutation } from "@/store/localApi"
import { getFeaturedSeries } from "@/store/seriesProgress"

import { BookThumbnailImage } from "./BookThumbnail"
import { getBookDownloadState } from "./bookDownloadState"
import { seriesCardLabel } from "./seriesLabel"
import { Button } from "./ui/button"
import { Text } from "./ui/text"

/** The same offline-aware primary action on the series page and book page. */
export function SeriesBookAction({ book }: { book: BookWithRelations }) {
  const downloaded = useDownloadedFormats(book)
  const available = useAvailableFormats(book)
  const activity = useAppSelector((state) => state.transferFeedback.download)
  const [downloadBook, { isLoading }] = useDownloadBookMutation()
  const [error, setError] = useState<string | null>(null)
  const readFormat = downloaded.includes("readaloud")
    ? "readaloud"
    : downloaded.includes("ebook")
      ? "ebook"
      : null
  const listenFormat = downloaded.includes("readaloud")
    ? "readaloud"
    : downloaded.includes("audiobook")
      ? "audiobook"
      : null
  const format =
    available.find(
      (candidate) =>
        (candidate !== "readaloud" || book.readaloud?.status === "ALIGNED") &&
        ["QUEUED", "DOWNLOADING", "PAUSED", "ERROR"].includes(
          book[candidate]!.downloadStatus,
        ),
    ) ??
    (available.includes("readaloud") && book.readaloud?.status === "ALIGNED"
      ? "readaloud"
      : available.includes("ebook")
        ? "ebook"
        : available.includes("audiobook")
          ? "audiobook"
          : null)
  const downloadState = format
    ? getBookDownloadState(book, format, activity)
    : null
  const canDownload =
    downloadState?.action === "download" ||
    downloadState?.action === "retry" ||
    downloadState?.canResume

  return (
    <View className="gap-2">
      <View className="flex-row flex-wrap gap-2">
        {readFormat && (
          <Link
            href={{
              pathname: "/read/[uuid]",
              params: { uuid: book.uuid, format: readFormat },
            }}
            asChild
          >
            <Button accessibilityLabel={`Read ${book.title}`}>
              <Text>Read</Text>
            </Button>
          </Link>
        )}
        {listenFormat && (
          <Link
            href={{
              pathname: "/listen/[uuid]",
              params: { uuid: book.uuid, format: listenFormat },
            }}
            asChild
          >
            <Button
              variant={readFormat ? "outline" : "default"}
              accessibilityLabel={`Listen to ${book.title}`}
            >
              <Text>Listen</Text>
            </Button>
          </Link>
        )}
        {!readFormat && !listenFormat && (
          <Button
            disabled={isLoading || !canDownload}
            accessibilityLabel={`${downloadState?.canResume ? "Resume download for" : "Download"} ${book.title}`}
            onPress={async () => {
              if (!format || !canDownload) return
              setError(null)
              try {
                await downloadBook({ bookUuid: book.uuid, format }).unwrap()
              } catch (cause) {
                setError(describeError(cause))
              }
            }}
          >
            <Text>
              {isLoading
                ? "Queuing…"
                : downloadState?.canResume
                  ? "Resume download"
                  : downloadState?.action === "retry"
                    ? "Try again"
                    : canDownload
                      ? "Download"
                      : (downloadState?.label ?? "Not available")}
            </Text>
          </Button>
        )}
      </View>
      {error && (
        <Text
          className="text-destructive text-sm"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      )}
    </View>
  )
}

export function SeriesProgressSection({ book }: { book: BookWithRelations }) {
  const allSeries = useSeriesProgress()
  const membership = getFeaturedSeries(book)
  if (!membership) return null
  const series = allSeries.find((entry) => entry.uuid === membership.uuid)
  const showNext =
    book.status?.name === "Read" ||
    (membership.position !== null &&
      membership.position === series?.furthestRead)
  const next = showNext ? series?.next : null

  return (
    <View className="mb-4 gap-3 self-stretch">
      <Link
        href={{ pathname: "/series/[uuid]", params: { uuid: membership.uuid } }}
        asChild
      >
        <Button variant="link" className="h-auto justify-start px-0 py-2">
          <Text className="text-primary flex-1 text-left">
            {membership.position === null
              ? "In"
              : `Book ${membership.position} of`}{" "}
            {membership.name}
          </Text>
        </Button>
      </Link>
      {series && (
        <Text className="text-muted-foreground text-sm">
          {seriesCardLabel(series)}
        </Text>
      )}
      {next && (
        <View className="border-primary/30 bg-primary/5 flex-row gap-4 rounded-lg border p-4">
          <Link
            href={{ pathname: "/book/[uuid]", params: { uuid: next.uuid } }}
            asChild
          >
            <Button
              variant="ghost"
              className="h-auto p-0"
              accessibilityLabel={`View ${next.title}`}
            >
              <BookThumbnailImage
                book={next}
                width={64}
                height={96}
                showActions={false}
              />
            </Button>
          </Link>
          <View className="min-w-0 flex-1 gap-2">
            <Text className="text-muted-foreground text-sm">
              Next in series
            </Text>
            <Link
              href={{ pathname: "/book/[uuid]", params: { uuid: next.uuid } }}
            >
              <Text className="font-semibold">{next.title}</Text>
            </Link>
            <SeriesBookAction book={next} />
          </View>
        </View>
      )}
    </View>
  )
}
