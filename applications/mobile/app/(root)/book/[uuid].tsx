import { Link, useLocalSearchParams, useRouter } from "expo-router"
import {
  ChevronLeft,
  ChevronRight,
  LibraryBig,
  LibrarySquare,
  Tag,
} from "lucide-react-native"
import { Fragment, useState } from "react"
import { RefreshControl, ScrollView, View } from "react-native"

import { BackButton } from "@/components/BackButton"
import BookDescription from "@/components/BookDescription"
import { BookThumbnailImage } from "@/components/BookThumbnail"
import { LoadingView } from "@/components/LoadingView"
import { MiniPlayerWidget } from "@/components/MiniPlayerWidget"
import { MissingFormatRequestAction } from "@/components/RequestEntryActions"
import { SeriesProgressSection } from "@/components/SeriesProgressSection"
import { ShortlistToggle } from "@/components/ShortlistToggle"
import { ScreenBackButton } from "@/components/ScreenBackButton"
import {
  DOWNLOAD_FORMAT_LABEL,
  getBookDownloadState,
} from "@/components/bookDownloadState"
import { Group } from "@/components/ui/Group"
import { Stack } from "@/components/ui/Stack"
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
import { Icon } from "@/components/ui/icon"
import {
  Select,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Text } from "@/components/ui/text"
import { describeError } from "@/describeError"
import { useAvailableFormats } from "@/hooks/useAvailableFormats"
import { useColorTheme } from "@/hooks/useColorTheme"
import { useListAllServerBooks } from "@/hooks/useListAllServerBooks"
import { usesSystemHeader } from "@/lib/nativeChrome"
import { useShortlist } from "@/hooks/useShortlist"
import { useAppSelector } from "@/store/appState"
import {
  useCancelDownloadMutation,
  useDeleteBookMutation,
  useDownloadBookMutation,
  useGetBookQuery,
  useListStatusesQuery,
  useUpdateStatusMutation,
} from "@/store/localApi"
import { useLazyGetBookQuery as useLazyGetServerBookQuery } from "@/store/serverApi"
import type { UUID } from "@/uuid"

/** The status picker's extra choice: "To read", and on the Shortlist. */
const SHORTLIST_OPTION = "shortlist"

export default function BookDetailsScreen() {
  const router = useRouter()
  const { uuid } = useLocalSearchParams() as { uuid: UUID }
  const { foreground } = useColorTheme()

  const [downloadBook] = useDownloadBookMutation()
  const [cancelDownload] = useCancelDownloadMutation()
  const [deleteBook] = useDeleteBookMutation()
  const { data: book, isLoading, isUninitialized } = useGetBookQuery({ uuid })

  const { data: statuses } = useListStatusesQuery()

  const [updateStatus] = useUpdateStatusMutation()
  const shortlist = useShortlist()
  const shortlisted = shortlist.isShortlisted(uuid)

  const [getServerBook, { isLoading: isServerLoading }] =
    useLazyGetServerBookQuery()

  const [showTagsMore, setShowTagsMore] = useState(false)
  const [showCollectionsMore, setShowCollectionsMore] = useState(false)
  const [pendingDeleteFormat, setPendingDeleteFormat] = useState<
    "readaloud" | "ebook" | "audiobook" | null
  >(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  const downloadActivity = useAppSelector(
    (state) => state.transferFeedback.download,
  )
  const availableFormats = useAvailableFormats(book)

  const { refetch } = useListAllServerBooks()

  if (isLoading || isUninitialized) return <LoadingView />

  if (!book) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text>Book not found</Text>
        <Button
          accessibilityLabel="Go back"
          onPress={() => {
            if (router.canGoBack()) {
              router.back()
            } else {
              router.replace("/")
            }
          }}
        >
          <Text>Go back</Text>
        </Button>
      </View>
    )
  }

  const numberOfTagsToShow = 6
  const tagsMoreNeeded = book.tags.length > numberOfTagsToShow
  const tagsToShow = showTagsMore
    ? book.tags
    : book.tags.slice(0, numberOfTagsToShow)
  const numTagsHidden = book.tags.length - tagsToShow.length

  const numberOfCollectionsToShow = 6
  const collectionsMoreNeeded =
    book.collections.length > numberOfCollectionsToShow
  const collectionsToShow = showCollectionsMore
    ? book.collections
    : book.collections.slice(0, numberOfCollectionsToShow)
  const numCollectionsHidden =
    book.collections.length - collectionsToShow.length

  return (
    <View className="flex-1">
      {/* Contributes header options, it does not render a view. */}
      <ScreenBackButton />
      <ScrollView
        contentInsetAdjustmentBehavior={
          usesSystemHeader ? "automatic" : "never"
        }
        refreshControl={
          book.serverUuid ? (
            <RefreshControl
              refreshing={isServerLoading}
              onRefresh={() => {
                getServerBook({
                  serverUuid: book.serverUuid!,
                  bookUuid: book.uuid,
                })
              }}
            />
          ) : undefined
        }
      >
        <Stack className={usesSystemHeader ? "" : "pt-safe"}>
          {!usesSystemHeader && (
            <View className="px-safe-or-2 flex-row justify-between">
              <BackButton />
            </View>
          )}
          <Stack className="px-safe-or-8 items-start">
            <BookThumbnailImage
              className="self-center"
              book={book}
              height={352}
              width={232}
            />
            <Text className="font-youngserif mt-4 mb-1 text-2xl" variant="h1">
              {book.title}
            </Text>
            {book.subtitle && (
              <Text className="mb-4 text-base italic">{book.subtitle}</Text>
            )}
            <Stack className="mb-4 gap-1 pl-0">
              <Group>
                <Text className="text-muted-foreground text-sm">
                  by{" "}
                  {book.authors.map((author, index) => (
                    <Fragment key={author.uuid}>
                      <Link
                        href={{
                          pathname: "/author/[uuid]",
                          params: {
                            uuid: author.uuid,
                          },
                        }}
                        className="active:text-primary active:underline"
                      >
                        <Text className="text-primary text-sm">
                          {author.name}
                        </Text>
                      </Link>
                      <Text className="text-sm">
                        {index < book.authors.length - 1 && ", "}
                      </Text>
                    </Fragment>
                  ))}
                </Text>
              </Group>
              {!!book.narrators.length && (
                <Text className="text-muted-foreground text-sm">
                  narrated by{" "}
                  {book.narrators.map((narrator, index) => (
                    <Fragment key={narrator.uuid}>
                      <Link
                        href={{
                          pathname: "/narrator/[uuid]",
                          params: {
                            uuid: narrator.uuid,
                          },
                        }}
                        className="active:text-primary active:underline"
                      >
                        <Text className="text-primary text-sm">
                          {narrator.name}
                        </Text>
                      </Link>
                      <Text className="text-sm">
                        {index < book.narrators.length - 1 && ", "}
                      </Text>
                    </Fragment>
                  ))}
                </Text>
              )}
            </Stack>
            {/* Group forces a row; this block stacks status and formats. */}
            <View className="mb-4 items-stretch gap-3 self-stretch">
              <View className="flex-row flex-wrap items-center gap-3">
                {book.status && (
                  <Select
                    value={
                      shortlisted && book.status.name === "To read"
                        ? { value: SHORTLIST_OPTION, label: "Shortlist" }
                        : { value: book.status.uuid, label: book.status.name }
                    }
                    onValueChange={(option) => {
                      if (!option) return
                      if (option.value === SHORTLIST_OPTION) {
                        // Shortlisted books stay "To read" until they're started.
                        const toRead = statuses?.find(
                          (status) => status.name === "To read",
                        )
                        if (toRead && book.status?.uuid !== toRead.uuid) {
                          updateStatus({
                            bookUuid: book.uuid,
                            statusUuid: toRead.uuid,
                          })
                        }
                        shortlist.add(book.uuid)
                        return
                      }
                      // Leaving "Shortlist" for plain "To read" unflags the book;
                      // Reading and Read follow the Shortlist setting instead.
                      const chosen = statuses?.find(
                        (status) => status.uuid === option.value,
                      )
                      if (shortlisted && chosen?.name === "To read") {
                        shortlist.remove(book.uuid)
                      }
                      updateStatus({
                        bookUuid: book.uuid,
                        statusUuid: option.value as UUID,
                      })
                    }}
                  >
                    <SelectTrigger
                      accessibilityLabel={`Reading status, ${
                        shortlisted && book.status.name === "To read"
                          ? "Shortlist"
                          : book.status.name
                      }`}
                    >
                      <SelectValue placeholder="" />
                    </SelectTrigger>
                    {statuses?.flatMap((status) => [
                      <SelectItem
                        key={status.uuid}
                        label={status.name}
                        value={status.uuid}
                      />,
                      ...(status.name === "To read" &&
                      shortlist.canShortlist(book)
                        ? [
                            <SelectItem
                              key={SHORTLIST_OPTION}
                              label="Shortlist"
                              value={SHORTLIST_OPTION}
                            />,
                          ]
                        : []),
                    ])}
                  </Select>
                )}
                <ShortlistToggle book={book} />
              </View>
              <Stack className="gap-3">
                {availableFormats.map((format) => {
                  const state = getBookDownloadState(
                    book,
                    format,
                    downloadActivity,
                  )
                  const formatLabel = DOWNLOAD_FORMAT_LABEL[format]
                  const progress = state.progress
                  const progressValue =
                    progress === null
                      ? undefined
                      : { min: 0, max: 100, now: progress }
                  return (
                    <Group
                      key={format}
                      className="flex-wrap items-center justify-between gap-3"
                    >
                      <Stack className="min-w-24 flex-1 gap-1">
                        <Text className="font-semibold">{formatLabel}</Text>
                        <Text
                          className="text-muted-foreground text-sm"
                          accessibilityLabel={`${formatLabel}: ${state.label}`}
                          accessibilityLiveRegion={
                            state.progress === null ? "polite" : "none"
                          }
                          accessibilityRole={
                            state.progress === null ? "text" : "progressbar"
                          }
                          accessibilityValue={progressValue}
                        >
                          {state.label}
                        </Text>
                      </Stack>
                      {state.canResume && (
                        <Button
                          variant="outline"
                          accessibilityLabel="Resume download queue"
                          onPress={() => {
                            downloadBook({ bookUuid: book.uuid, format })
                          }}
                        >
                          <Text>Resume queue</Text>
                        </Button>
                      )}
                      {state.action && (
                        <Button
                          variant="outline"
                          accessibilityLabel={`${state.actionLabel}: ${formatLabel}`}
                          onPress={() => {
                            if (state.action === "cancel") {
                              cancelDownload({ bookUuid: book.uuid, format })
                            } else if (state.action === "remove") {
                              setRemoveError(null)
                              setPendingDeleteFormat(format)
                            } else {
                              downloadBook({ bookUuid: book.uuid, format })
                            }
                          }}
                        >
                          <Text>
                            {state.action === "cancel"
                              ? "Cancel"
                              : state.actionLabel}
                          </Text>
                        </Button>
                      )}
                    </Group>
                  )
                })}
                <MissingFormatRequestAction book={book} />
                {removeError && (
                  <Text
                    className="text-destructive text-sm"
                    accessibilityLiveRegion="polite"
                  >
                    {removeError}
                  </Text>
                )}
              </Stack>
            </View>
            {!!book.series.length && (
              <>
                <Group className="mb-2 flex-row items-center gap-1">
                  <Icon
                    as={LibrarySquare}
                    size={16}
                    className="text-muted-foreground"
                  />
                  <Text className="text-muted-foreground text-sm">Series</Text>
                </Group>
                <Group className="flex-stretch mb-4 flex-wrap">
                  {book.series.map((series) => (
                    <Link
                      href={{
                        pathname: "/series/[uuid]",
                        params: { uuid: series.uuid },
                      }}
                      key={series.uuid}
                      asChild
                      className="w-full justify-start"
                    >
                      <Button
                        accessibilityLabel={`Open series ${series.name}, book ${series.position}`}
                        variant="link"
                        className="y-0 mt-[-5px] flex flex-row items-center gap-1 px-0"
                      >
                        <Text className="text-primary">{series.name}</Text>
                        <Text className="text-muted-foreground font-normal">
                          #{series.position}
                        </Text>
                      </Button>
                    </Link>
                  ))}
                </Group>
              </>
            )}
            <SeriesProgressSection book={book} />
            {!!book.tags.length && (
              <>
                <Group className="mb-2 flex-row items-center gap-1">
                  <Icon as={Tag} size={16} className="text-muted-foreground" />
                  <Text className="text-muted-foreground text-sm">Tags</Text>
                </Group>
                <Group className="mb-4 flex-wrap gap-2">
                  {tagsToShow.map((tag) => (
                    <Link
                      href={{
                        pathname: "/tag/[uuid]",
                        params: {
                          uuid: tag.uuid,
                        },
                      }}
                      key={tag.uuid}
                      asChild
                    >
                      <Button
                        accessibilityLabel={`Open tag ${tag.name}`}
                        variant="secondary"
                        size="sm"
                        className="flex flex-row items-center gap-2 rounded-full px-3"
                      >
                        {/* <Icon as={Tag} size={12} /> */}
                        <Text>{tag.name}</Text>
                      </Button>
                    </Link>
                  ))}
                  {tagsMoreNeeded && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex flex-row items-center gap-2 rounded-full px-3"
                      accessibilityLabel={
                        showTagsMore
                          ? "Show fewer tags"
                          : `Show ${numTagsHidden} more tags`
                      }
                      onPress={() => {
                        setShowTagsMore(!showTagsMore)
                      }}
                    >
                      <Icon
                        as={showTagsMore ? ChevronLeft : ChevronRight}
                        size={12}
                      />
                      <Text>
                        {showTagsMore ? "Less" : "More (" + numTagsHidden + ")"}
                      </Text>
                    </Button>
                  )}
                </Group>
              </>
            )}
            {!!book.collections.length && (
              <>
                <Group className="mb-2 flex-row items-center gap-1">
                  <Icon
                    as={LibraryBig}
                    size={16}
                    className="text-muted-foreground"
                  />
                  <Text className="text-muted-foreground text-sm">
                    Collections
                  </Text>
                </Group>
                <Group className="flex-stretch mb-4 flex-wrap gap-2">
                  {collectionsToShow.map((collection) => (
                    <Link
                      href={{
                        pathname: `/collection/[uuid]`,
                        params: { uuid: collection.uuid },
                      }}
                      key={collection.uuid}
                      asChild
                    >
                      <Button
                        accessibilityLabel={`Open collection ${collection.name}`}
                        variant="secondary"
                        className="flex flex-row items-center gap-2 rounded-md px-4 py-0"
                      >
                        <Text>{collection.name}</Text>
                      </Button>
                    </Link>
                  ))}
                  {collectionsMoreNeeded && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex flex-row items-center gap-2 rounded-full px-3"
                      accessibilityLabel={
                        showCollectionsMore
                          ? "Show fewer collections"
                          : `Show ${numCollectionsHidden} more collections`
                      }
                      onPress={() => {
                        setShowCollectionsMore(!showCollectionsMore)
                      }}
                    >
                      <Icon
                        as={showCollectionsMore ? ChevronLeft : ChevronRight}
                        size={12}
                      />
                      <Text>
                        {showCollectionsMore
                          ? "Less"
                          : "More (" + numCollectionsHidden + ")"}
                      </Text>
                    </Button>
                  )}
                </Group>
              </>
            )}
          </Stack>
          <View className="pb-safe px-safe-or-8">
            <BookDescription
              description={book.description}
              textColor={foreground}
              dom={{ matchContents: true }}
            />
          </View>
        </Stack>
        {/* Spacer for the miniplayer */}
        <View className="h-40 w-full" />
      </ScrollView>
      <MiniPlayerWidget />
      <AlertDialog
        open={pendingDeleteFormat !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteFormat(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {book.serverUuid
                ? `Remove ${pendingDeleteFormat} from device`
                : "Delete local book"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {book.serverUuid
                ? `This will remove the downloaded ${pendingDeleteFormat} files from your device. The book will remain in your server library.`
                : "This will delete this locally imported book from your library, not just remove its download. Keep your original file if you want to import it again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Text>Cancel</Text>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                accessibilityLabel={
                  book.serverUuid
                    ? `Remove ${pendingDeleteFormat} from device`
                    : "Delete local book"
                }
                onPress={() => {
                  if (!pendingDeleteFormat) return
                  deleteBook({
                    bookUuid: book.uuid,
                    format: pendingDeleteFormat,
                    deleteRecord: book.serverUuid === null,
                  })
                    .unwrap()
                    .then(
                      () => {
                        router.replace("/")
                        refetch()
                      },
                      (error) => setRemoveError(describeError(error)),
                    )
                  setPendingDeleteFormat(null)
                }}
              >
                <Text>{book.serverUuid ? "Remove" : "Delete book"}</Text>
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </View>
  )
}
