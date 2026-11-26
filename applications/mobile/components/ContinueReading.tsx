import { useRouter } from "expo-router"
import { BookOpen, Download, Headphones, RotateCcw } from "lucide-react-native"
import { useEffect, useState } from "react"
import { Pressable, View } from "react-native"

import { type BookWithRelations } from "@/database/books"
import { useEffectEvent } from "@/hooks/useEffectEvent"
import { useAppSelector } from "@/store/appState"
import { type ReadingSession } from "@/store/continueReading"
import { useDownloadBookMutation, useGetBookQuery } from "@/store/localApi"

import { AudiobookCover } from "./AudiobookCover"
import { EbookCover } from "./EbookCover"
import { HomeStripProgress } from "./HomeStripProgress"
import { getBookDownloadState } from "./bookDownloadState"
import { Button } from "./ui/button"
import { Icon } from "./ui/icon"
import { Text } from "./ui/text"

type Props = {
  book: BookWithRelations
  session: ReadingSession
  /** The format to continue in has to be downloaded to this device first. */
  needsDownload: boolean
  /** e.g. "Sharpe #21 · 3 ahead" */
  seriesLabel?: string | null
}

// Some ebooks ship without a cover image; show the audiobook art instead of an
// empty frame.
function hasTextCover(book: BookWithRelations) {
  return Boolean(book.ebookCoverUrl ?? book.textCoverSha256)
}

function hasAudioCover(book: BookWithRelations) {
  return Boolean(book.audiobookCoverUrl ?? book.audioCoverSha256)
}

export function ContinueReading({
  book,
  session,
  needsDownload,
  seriesLabel,
}: Props) {
  const router = useRouter()
  const { currentData } = useGetBookQuery({ uuid: book.uuid })
  const current = currentData ?? book
  const locator = current.position?.locator
  const progress = locator?.locations?.totalProgression
  const chapter = locator?.title?.trim()
  const hasProgress = progress !== undefined && progress >= 0 && progress <= 1
  const details = [
    hasProgress ? `${Math.round(progress * 100)}%` : null,
    chapter && chapter !== book.title ? chapter : null,
  ]
    .filter(Boolean)
    .join(" · ")
  const listening = session.mode === "listening"
  const author = book.authors[0]?.name

  const [downloadBook] = useDownloadBookMutation()
  const activity = useAppSelector((state) => state.transferFeedback.download)
  const downloadState = needsDownload
    ? getBookDownloadState(current, session.format, activity)
    : null
  // Open the book once a download started from this card has finished.
  const [openWhenReady, setOpenWhenReady] = useState(false)

  function openDetails() {
    router.push({ pathname: "/book/[uuid]", params: { uuid: book.uuid } })
  }

  function open(mode: ReadingSession["mode"]) {
    router.push({
      pathname: mode === "listening" ? "/listen/[uuid]" : "/read/[uuid]",
      params: { uuid: book.uuid, format: session.format },
    })
  }

  const openWhenDownloaded = useEffectEvent(() => {
    setOpenWhenReady(false)
    open(session.mode)
  })

  useEffect(() => {
    if (openWhenReady && !needsDownload) openWhenDownloaded()
  }, [openWhenReady, needsDownload])

  const downloading =
    downloadState &&
    ["queued", "downloading", "preparing"].includes(downloadState.status)
  const canDownload =
    downloadState?.action === "download" || downloadState?.action === "retry"
  const showReadingProgress =
    !needsDownload || downloadState?.status === "download"
  const stripProgress =
    showReadingProgress && hasProgress
      ? progress * 100
      : (downloadState?.progress ?? null)
  const status =
    downloadState && (!showReadingProgress || !details)
      ? `${downloadState.label}${downloading && openWhenReady ? " — opens when ready" : ""}`
      : details

  return (
    <View className="border-border bg-card mr-6 max-w-3xl flex-row items-center gap-2 rounded-xl border p-2">
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Details for ${book.title}`}
        onPress={openDetails}
        className="bg-secondary h-16 w-11 shrink-0 items-center justify-center overflow-hidden rounded"
      >
        <Icon
          as={listening ? Headphones : BookOpen}
          size={18}
          className="text-muted-foreground absolute"
        />
        {listening || (!hasTextCover(book) && hasAudioCover(book)) ? (
          <AudiobookCover book={book} />
        ) : (
          <EbookCover book={book} />
        )}
      </Pressable>
      <View className="min-w-0 flex-1 gap-1">
        <Pressable accessibilityRole="link" onPress={openDetails}>
          <Text className="font-semibold" numberOfLines={1}>
            {book.title}
          </Text>
          {!!(author || seriesLabel) && (
            <Text className="text-muted-foreground text-xs" numberOfLines={1}>
              {[author, seriesLabel].filter(Boolean).join(" · ")}
            </Text>
          )}
        </Pressable>
        {stripProgress !== null && (
          <HomeStripProgress
            percent={stripProgress}
            label={
              showReadingProgress ? "Reading progress" : "Download progress"
            }
          />
        )}
        {!!status && (
          <Text className="text-muted-foreground text-xs" numberOfLines={1}>
            {status}
          </Text>
        )}
      </View>
      <View className="shrink-0 flex-row items-center gap-1">
        {needsDownload ? (
          canDownload && (
            <Button
              size="icon"
              className="min-h-11 min-w-11"
              accessibilityLabel={
                downloadState.action === "retry"
                  ? `Retry download and continue ${book.title}`
                  : `Download and continue ${book.title}`
              }
              onPress={() => {
                setOpenWhenReady(true)
                void downloadBook({
                  bookUuid: book.uuid,
                  format: session.format,
                })
              }}
            >
              <Icon
                as={downloadState.action === "retry" ? RotateCcw : Download}
                size={18}
                className="text-primary-foreground"
              />
            </Button>
          )
        ) : session.format === "readaloud" ? (
          <>
            <Button
              size="icon"
              className="min-h-11 min-w-11"
              variant={listening ? "default" : "secondary"}
              accessibilityLabel={`Listen to ${book.title}`}
              onPress={() => open("listening")}
            >
              <Icon
                as={Headphones}
                size={18}
                className={
                  listening ? "text-primary-foreground" : "text-foreground"
                }
              />
            </Button>
            <Button
              size="icon"
              className="min-h-11 min-w-11"
              variant={listening ? "secondary" : "default"}
              accessibilityLabel={`Read along with ${book.title}`}
              onPress={() => open("reading")}
            >
              <Icon
                as={BookOpen}
                size={18}
                className={
                  listening ? "text-foreground" : "text-primary-foreground"
                }
              />
            </Button>
          </>
        ) : (
          <Button
            size="icon"
            className="min-h-11 min-w-11"
            accessibilityLabel={`${listening ? "Listen to" : "Read"} ${book.title}`}
            onPress={() => open(session.mode)}
          >
            <Icon
              as={listening ? Headphones : BookOpen}
              size={18}
              className="text-primary-foreground"
            />
          </Button>
        )}
      </View>
    </View>
  )
}
