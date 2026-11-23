import { Link, useRouter } from "expo-router"
import { BookOpen, Flag, Headphones } from "lucide-react-native"
import { Pressable, View, type ViewStyle } from "react-native"

import { type BookWithRelations } from "@/database/books"
import { useAvailableFormats } from "@/hooks/useAvailableFormats"
import { useDownloadedFormats } from "@/hooks/useDownloadedFormats"
import { useSeriesCoverLabel } from "@/hooks/useSeriesCoverLabel"
import { useShortlist } from "@/hooks/useShortlist"
import { cn } from "@/lib/utils"
import { useAppSelector } from "@/store/appState"
import {
  useCancelDownloadMutation,
  useDownloadBookMutation,
  useListStatusesQuery,
  useUpdateStatusMutation,
} from "@/store/localApi"

import { AudiobookCover } from "./AudiobookCover"
import { DownloadingIndicator } from "./DownloadingIndicator"
import { EbookCover } from "./EbookCover"
import {
  DOWNLOAD_FORMAT_LABEL,
  getBookDownloadState,
} from "./bookDownloadState"
import { Stack } from "./ui/Stack"
import { Button } from "./ui/button"
import { Icon } from "./ui/icon"
import { ReadaloudIcon } from "./ui/icon-readaloud"
import { Menu, type MenuAction } from "./ui/menu"
import { Text } from "./ui/text"

const DEFAULT_THUMBNAIL_WIDTH = 116
const THUMBNAIL_HEIGHT_RATIO = 176 / 116

interface Props {
  book: BookWithRelations
  width?: number
  /** One line under the title saying why the book is shown here. */
  caption?: string | null | undefined
}

export function BookThumbnail({
  book,
  width = DEFAULT_THUMBNAIL_WIDTH,
  caption,
}: Props) {
  const router = useRouter()
  const height = Math.round(width * THUMBNAIL_HEIGHT_RATIO)
  const titleFontSize = Math.max(11, Math.min(16, Math.round(width * 0.11)))
  const authorFontSize = Math.max(10, Math.min(14, Math.round(width * 0.1)))

  const downloadedFormats = useDownloadedFormats(book)
  const availableFormats = useAvailableFormats(book)
  const downloadActivity = useAppSelector(
    (state) => state.transferFeedback.download,
  )

  const audioOnly =
    !downloadedFormats.includes("ebook") &&
    !downloadedFormats.includes("readaloud")

  const [downloadBook] = useDownloadBookMutation()
  const [cancelDownload] = useCancelDownloadMutation()

  const { data: statuses } = useListStatusesQuery()

  const [updateStatus] = useUpdateStatusMutation()
  const shortlist = useShortlist()
  const shortlisted = shortlist.isShortlisted(book.uuid)
  const seriesLabel = useSeriesCoverLabel(book)
  function openBookDetails() {
    router.push({
      pathname: "/book/[uuid]",
      params: { uuid: book.uuid },
    })
  }

  const statusActions: MenuAction[] =
    statuses
      ?.filter((status) => status.uuid !== book.status?.uuid)
      .map((status) => ({
        id: `status-${status.uuid}`,
        title: `Move to "${status.name}"`,
        onPress: () => {
          updateStatus({
            bookUuid: book.uuid,
            statusUuid: status.uuid,
          })
        },
      })) ?? []

  const menuActions: MenuAction[] = [
    {
      id: "book-details",
      title: "Book details",
      onPress: openBookDetails,
    },
    ...(downloadedFormats.length
      ? [
          {
            id: "open-book",
            title: audioOnly ? "Play audiobook" : "Open book",
            onPress: () => {
              router.push({
                pathname: audioOnly ? "/listen/[uuid]" : "/read/[uuid]",
                params: {
                  uuid: book.uuid,
                  format: audioOnly
                    ? "audiobook"
                    : downloadedFormats.includes("readaloud")
                      ? "readaloud"
                      : "ebook",
                },
              })
            },
          },
        ]
      : []),
    ...(shortlist.canShortlist(book) && book.status?.name !== "Read"
      ? [
          {
            id: "shortlist",
            title: shortlisted ? "Remove from Shortlist" : "Add to Shortlist",
            onPress: () => shortlist.toggle(book.uuid),
          },
        ]
      : []),
    ...(statusActions.length
      ? [
          {
            id: "reading-status",
            title: "Reading status",
            subactions: statusActions,
          },
        ]
      : []),
    ...(availableFormats.length
      ? [
          {
            id: "downloads",
            title: "Downloads",
            subactions: availableFormats.flatMap((format) => {
              const state = getBookDownloadState(book, format, downloadActivity)
              const actionLabel =
                state.action === "remove"
                  ? book.serverUuid
                    ? "Manage download"
                    : "Manage local book"
                  : state.actionLabel

              const action: MenuAction = {
                id: `download-${format}`,
                title: `${DOWNLOAD_FORMAT_LABEL[format]}: ${state.label}${actionLabel && state.status !== "download" ? ` — ${actionLabel}` : ""}`,
                ...(!state.action ? { attributes: { disabled: true } } : {}),
                onPress: () => {
                  if (state.action === "remove") {
                    openBookDetails()
                  } else if (state.action === "cancel") {
                    cancelDownload({ bookUuid: book.uuid, format })
                  } else if (state.action) {
                    downloadBook({ bookUuid: book.uuid, format })
                  }
                },
              }
              return state.canResume
                ? [
                    action,
                    {
                      id: `resume-${format}`,
                      title: `${DOWNLOAD_FORMAT_LABEL[format]}: Resume queue`,
                      onPress: () => {
                        downloadBook({ bookUuid: book.uuid, format })
                      },
                    },
                  ]
                : [action]
            }),
          },
        ]
      : []),
  ]

  const cover = (
    <Stack
      // should be a more elegant way to get the text a little closer
      className="relative -mb-3 flex-col justify-center"
      style={{ height, width }}
    >
      <View style={{ height, width }}>
        <BookThumbnailImage
          book={book}
          height={height}
          showActions={false}
          width={width}
        />
        {shortlisted && (
          <View
            className="bg-primary absolute top-1 left-1 z-50 rounded-full p-1"
            accessibilityLabel="On your Shortlist"
          >
            <Icon
              as={Flag}
              size={Math.max(12, Math.round(width / 10))}
              className="text-primary-foreground"
            />
          </View>
        )}
      </View>
    </Stack>
  )

  const renderMetadata = (maxWidth: number) => (
    <>
      <Text
        className="text-muted-foreground"
        numberOfLines={1}
        style={{ maxWidth, fontSize: authorFontSize }}
      >
        {book.authors[0]?.name}
      </Text>

      <Text
        className="leading-none font-semibold"
        numberOfLines={2}
        style={{ maxWidth, fontSize: titleFontSize }}
      >
        {book.title}
      </Text>
      {!!seriesLabel && (
        <Text
          className="text-muted-foreground"
          numberOfLines={1}
          style={{ maxWidth, fontSize: authorFontSize }}
        >
          {seriesLabel}
        </Text>
      )}
      {!!caption && (
        <Text
          className="text-primary"
          numberOfLines={2}
          style={{ maxWidth, fontSize: authorFontSize }}
        >
          {caption}
        </Text>
      )}
      {availableFormats.map((format) => {
        const state = getBookDownloadState(book, format, downloadActivity)
        if (state.status === "download") return null
        const label = `${state.label} · ${DOWNLOAD_FORMAT_LABEL[format]}`
        return (
          <Text
            key={format}
            className="text-muted-foreground"
            numberOfLines={2}
            accessibilityLabel={label}
            style={{ maxWidth, fontSize: authorFontSize }}
          >
            {label}
          </Text>
        )
      })}
    </>
  )

  return (
    <View className="overflow-visible" style={{ width }}>
      <Menu actions={menuActions} shouldOpenOnLongPress>
        {/* asChild + Pressable instead of Link alone for Boox device compat */}
        <Link asChild href={`/book/${book.uuid}`}>
          <Pressable
            accessibilityLabel={`Open details for ${book.title}`}
            accessibilityRole="link"
            className="overflow-visible"
            style={{ width }}
          >
            {cover}
            {renderMetadata(width)}
          </Pressable>
        </Link>
      </Menu>
      <BookThumbnailActionButtons book={book} height={height} width={width} />
    </View>
  )
}

export function BookThumbnailImage({
  className,
  book,
  height,
  showActions = true,
  width,
}: {
  className?: string | undefined
  book: BookWithRelations
  height: number
  showActions?: boolean
  width: number
}) {
  const downloadActivity = useAppSelector(
    (state) => state.transferFeedback.download,
  )
  const availableFormats = useAvailableFormats(book)
  const indicatorFormat =
    (downloadActivity?.bookUuid === book.uuid
      ? downloadActivity.format
      : null) ??
    availableFormats.find((format) =>
      ["QUEUED", "DOWNLOADING", "PAUSED", "ERROR"].includes(
        book[format]!.downloadStatus,
      ),
    )
  const downloadState = indicatorFormat
    ? getBookDownloadState(book, indicatorFormat, downloadActivity)
    : null

  const downloadedFormats = useDownloadedFormats(book)

  const hasBothCovers = book.readaloud || (book.ebook && book.audiobook)

  return (
    <View
      className={cn(
        "relative",
        !hasBothCovers && book.ebook && "items-start justify-start",
        className,
      )}
      style={{
        height,
        width,
      }}
    >
      {downloadState?.progress !== null &&
      downloadState?.progress !== undefined ? (
        <DownloadingIndicator
          className="absolute z-50"
          progress={downloadState.progress}
          accessibilityLabel={`${DOWNLOAD_FORMAT_LABEL[indicatorFormat!]}: ${downloadState.label}`}
          size={Math.ceil(height / 10)}
          style={{
            left: 0.98 * width - Math.ceil(height / 10),
            bottom: hasBothCovers ? 0.1 * height : 0.02 * height,
          }}
        />
      ) : (
        downloadState && (
          <Text
            className="bg-background text-foreground absolute bottom-0 left-0 z-50 rounded px-1 text-xs"
            accessibilityLabel={`${DOWNLOAD_FORMAT_LABEL[indicatorFormat!]}: ${downloadState.label}`}
          >
            {downloadState.label}
          </Text>
        )
      )}
      {(book.readaloud?.status === "ALIGNED" ||
        downloadedFormats.includes("readaloud")) && (
        <>
          <Icon
            className="text-primary absolute z-50"
            size={Math.ceil(height / 10)}
            as={ReadaloudIcon}
            style={{
              top: 0.12 * height,
              left: 0.96 * width - Math.ceil(height / 10),
            }}
          />
        </>
      )}
      {showActions && (
        <BookThumbnailActionButtons book={book} height={height} width={width} />
      )}
      {hasBothCovers ? (
        <>
          <AudiobookCoverImage
            book={book}
            height={width}
            width={width}
            className="absolute z-10 translate-x-[10%] scale-[0.8]"
            style={{
              top: (height - width) / 2,
            }}
          />
          <EbookCoverImage
            book={book}
            height={height}
            width={width}
            className="absolute z-20 -translate-x-[10%] scale-[0.8]"
          />
        </>
      ) : book.ebook ? (
        <EbookCoverImage
          book={book}
          height={height}
          width={width}
          className="-translate-x-[10%] scale-[0.8]"
        />
      ) : (
        <AudiobookCoverImage
          book={book}
          height={width}
          width={width}
          className="relative"
          style={{
            top: (height - width) / 2,
          }}
        />
      )}
    </View>
  )
}

function BookThumbnailActionButtons({
  book,
  height,
  width,
}: {
  book: BookWithRelations
  height: number
  width: number
}) {
  const downloadedFormats = useDownloadedFormats(book)
  const hasBothCovers = book.readaloud || (book.ebook && book.audiobook)

  return (
    <View
      pointerEvents="box-none"
      style={{
        height,
        width,
        position: "absolute",
        top: 0,
        left: 0,
        zIndex: 50,
      }}
    >
      <Stack
        className={cn(
          "absolute top-0 bottom-0 z-50 justify-center gap-4",
          hasBothCovers ? "right-2" : "right-1/2 translate-x-1/2",
        )}
        pointerEvents="box-none"
      >
        {(downloadedFormats.includes("ebook") ||
          downloadedFormats.includes("readaloud")) && (
          <Link
            href={{
              pathname: "/read/[uuid]",
              params: {
                uuid: book.uuid,
                format: downloadedFormats.includes("readaloud")
                  ? "readaloud"
                  : "ebook",
              },
            }}
            asChild
          >
            <Button
              accessibilityLabel={`Read ${book.title}`}
              className="bg-background rounded-full"
              style={{
                height: height / 5,
                width: height / 5,
              }}
            >
              <Icon
                className="text-foreground"
                as={BookOpen}
                size={height / 10}
              />
            </Button>
          </Link>
        )}
        {(downloadedFormats.includes("audiobook") ||
          downloadedFormats.includes("readaloud")) && (
          <Link
            href={{
              pathname: "/listen/[uuid]",
              params: {
                uuid: book.uuid,
                format: downloadedFormats.includes("readaloud")
                  ? "readaloud"
                  : "audiobook",
              },
            }}
            asChild
          >
            <Button
              accessibilityLabel={`Listen to ${book.title}`}
              className="bg-background rounded-full"
              style={{
                height: height / 5,
                width: height / 5,
              }}
            >
              <Icon
                as={Headphones}
                className="text-foreground"
                size={height / 10}
              />
            </Button>
          </Link>
        )}
      </Stack>
    </View>
  )
}

function EbookCoverImage({
  book,
  className,
  height,
  width,
  style,
}: {
  book: BookWithRelations
  className?: string | undefined
  height: number
  width: number
  style?: ViewStyle
}) {
  return (
    <Stack
      className={cn(
        "bg-secondary items-center justify-center overflow-hidden rounded-lg",
        className,
      )}
      style={{ height, width, ...style }}
    >
      <EbookCover book={book} />
    </Stack>
  )
}

function AudiobookCoverImage({
  book,
  className,
  height,
  width,
  style,
}: {
  book: BookWithRelations
  className?: string | undefined
  height: number
  width: number
  style?: ViewStyle
}) {
  return (
    <Stack
      className={cn(
        "bg-secondary items-center justify-center overflow-hidden rounded-lg",
        className,
      )}
      style={{ height, width, ...style }}
    >
      <AudiobookCover book={book} />
    </Stack>
  )
}
