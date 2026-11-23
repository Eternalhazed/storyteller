import { Link, Stack as RouterStack, useLocalSearchParams } from "expo-router"
import { useState } from "react"
import { FlatList, View } from "react-native"

import { BackButton } from "@/components/BackButton"
import { BookThumbnailImage } from "@/components/BookThumbnail"
import { LoadingView } from "@/components/LoadingView"
import { MiniPlayerWidget } from "@/components/MiniPlayerWidget"
import { ScreenBackButton } from "@/components/ScreenBackButton"
import { SeriesBookAction } from "@/components/SeriesProgressSection"
import { seriesCardLabel } from "@/components/seriesLabel"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Text } from "@/components/ui/text"
import type { BookWithRelations } from "@/database/books"
import { describeError } from "@/describeError"
import { useSeriesProgress } from "@/hooks/useSeriesProgress"
import { usesSystemHeader } from "@/lib/nativeChrome"
import { cn } from "@/lib/utils"
import {
  useGetSeriesQuery,
  useListBooksQuery,
  useListStatusesQuery,
  useUpdateStatusMutation,
} from "@/store/localApi"
import type { UUID } from "@/uuid"

export default function SeriesScreen() {
  const { uuid } = useLocalSearchParams() as { uuid: UUID }
  const allSeries = useSeriesProgress()
  const series = allSeries.find((entry) => entry.uuid === uuid)
  const { data: metadata } = useGetSeriesQuery({ uuid })
  const { isLoading } = useListBooksQuery()
  const { data: statuses } = useListStatusesQuery()
  const [updateStatus] = useUpdateStatusMutation()
  const [confirmBooks, setConfirmBooks] = useState<BookWithRelations[]>([])
  const [marking, setMarking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const readStatus = statuses?.find((status) => status.name === "Read")
  const title = series?.name ?? metadata?.name ?? "Series"

  async function markEarlierBooks() {
    if (!readStatus || marking) return
    const books = confirmBooks
    setConfirmBooks([])
    setError(null)
    setMarking(true)
    try {
      for (const book of books) {
        await updateStatus({
          bookUuid: book.uuid,
          statusUuid: readStatus.uuid,
        }).unwrap()
      }
    } catch (cause) {
      setError(
        `Could not mark all earlier books as read. ${describeError(cause)}`,
      )
    } finally {
      setMarking(false)
    }
  }

  if (isLoading) return <LoadingView />

  return (
    <View className={usesSystemHeader ? "flex-1" : "pt-safe flex-1"}>
      {usesSystemHeader ? (
        <>
          <RouterStack.Header style={{ shadowColor: "transparent" }} />
          <RouterStack.Title style={{ fontFamily: "YoungSerif" }}>
            {title}
          </RouterStack.Title>
          <ScreenBackButton />
        </>
      ) : (
        <View className="px-safe-or-2 flex-row items-center gap-2">
          <BackButton fallback="/series" />
          <Text className="font-youngserif my-2 flex-1" variant="h3">
            {title}
          </Text>
        </View>
      )}
      <FlatList
        data={series?.books ?? []}
        keyExtractor={(book) => book.uuid}
        contentContainerClassName="px-safe-or-4 gap-3 pb-40"
        contentInsetAdjustmentBehavior={
          usesSystemHeader ? "automatic" : "never"
        }
        ListHeaderComponent={
          series ? (
            <View className="gap-3 py-3">
              <Text className="text-primary font-semibold">
                {seriesCardLabel(series)}
              </Text>
              <Text className="text-muted-foreground text-sm">
                {series.owned} {series.owned === 1 ? "book" : "books"} owned
                {series.furthestRead === null
                  ? ""
                  : ` · Read through #${series.furthestRead}`}
              </Text>
              {series.missing.length > 0 && (
                <Text className="text-muted-foreground text-sm">
                  Not in your library:{" "}
                  {series.missing.map((position) => `#${position}`).join(", ")}
                </Text>
              )}
              {series.behind.length > 0 && (
                <View className="items-start gap-2">
                  <Text className="text-muted-foreground text-sm">
                    {series.behind.length} earlier{" "}
                    {series.behind.length === 1 ? "book is" : "books are"} not
                    marked read. They do not affect what is next.
                  </Text>
                  <Button
                    variant="outline"
                    disabled={marking || !readStatus}
                    onPress={() => setConfirmBooks(series.behind)}
                    accessibilityLabel="Mark earlier books as read"
                  >
                    <Text>
                      {marking ? "Marking…" : "Mark earlier books as read"}
                    </Text>
                  </Button>
                </View>
              )}
              {error && (
                <Text
                  className="text-destructive text-sm"
                  accessibilityLiveRegion="polite"
                >
                  {error}
                </Text>
              )}
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          <Text className="text-muted-foreground py-8">
            No books in this series.
          </Text>
        }
        renderItem={({ item: book }) => {
          const position = book.series.find(
            (entry) => entry.uuid === uuid,
          )?.position
          const isNext = series?.next?.uuid === book.uuid
          const isBehind = series?.behind.some(
            (entry) => entry.uuid === book.uuid,
          )
          const progression =
            book.position?.locator.locations?.totalProgression ?? 0
          const reading = book.status?.name === "Reading" || progression > 0
          const state =
            book.status?.name === "Read"
              ? "Read"
              : reading
                ? `Reading ${Math.round(Math.max(0, Math.min(1, progression)) * 100)}%`
                : "Not started"
          return (
            <View
              className={cn(
                "border-border flex-row gap-4 rounded-lg border p-4",
                isNext && "border-primary bg-primary/5",
                isBehind && "opacity-60",
              )}
            >
              <Link
                href={{ pathname: "/book/[uuid]", params: { uuid: book.uuid } }}
                asChild
              >
                <Button
                  variant="ghost"
                  className="h-auto p-0"
                  accessibilityLabel={`View ${book.title}`}
                >
                  <BookThumbnailImage
                    book={book}
                    width={72}
                    height={108}
                    showActions={false}
                  />
                </Button>
              </Link>
              <View className="min-w-0 flex-1 gap-2">
                <Text
                  className={cn(
                    "text-sm",
                    isNext
                      ? "text-primary font-semibold"
                      : "text-muted-foreground",
                  )}
                >
                  {position === null || position === undefined
                    ? "Unnumbered"
                    : `#${position}`}
                  {isNext ? " · Next in series" : ""}
                </Text>
                <Link
                  href={{
                    pathname: "/book/[uuid]",
                    params: { uuid: book.uuid },
                  }}
                >
                  <Text className="font-semibold">{book.title}</Text>
                </Link>
                <Text className="text-muted-foreground text-sm">{state}</Text>
                {isNext && <SeriesBookAction book={book} />}
              </View>
            </View>
          )
        }}
      />
      <MiniPlayerWidget />
      <AlertDialog
        open={confirmBooks.length > 0}
        onOpenChange={(open) => {
          if (!open) setConfirmBooks([])
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark earlier books as read?</AlertDialogTitle>
            <AlertDialogDescription>
              Mark {confirmBooks.length} earlier{" "}
              {confirmBooks.length === 1 ? "book" : "books"} in {title} as Read.
              Reading positions will not change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Text>Cancel</Text>
            </AlertDialogCancel>
            <AlertDialogAction
              onPress={() => {
                void markEarlierBooks()
              }}
            >
              <Text>Mark as read</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </View>
  )
}
