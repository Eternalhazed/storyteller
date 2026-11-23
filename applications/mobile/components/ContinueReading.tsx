import { useRouter } from "expo-router"
import { BookOpen, Download, Headphones } from "lucide-react-native"
import { useEffect, useState } from "react"
import { Pressable, View } from "react-native"

import { type BookWithRelations } from "@/database/books"
import { useEffectEvent } from "@/hooks/useEffectEvent"
import { useAppSelector } from "@/store/appState"
import { type ReadingSession } from "@/store/continueReading"
import { useDownloadBookMutation, useGetBookQuery } from "@/store/localApi"

import { AudiobookCover } from "./AudiobookCover"
import { EbookCover } from "./EbookCover"
import { ProgressBar } from "./ProgressBar"
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
    chapter && chapter !== book.title ? chapter : null,
    hasProgress ? `${Math.round(progress * 100)}%` : null,
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

  return (
    <View className="border-border bg-card mr-safe-or-4 max-w-3xl flex-row gap-4 rounded-xl border p-4">
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Details for ${book.title}`}
        onPress={() =>
          router.push({ pathname: "/book/[uuid]", params: { uuid: book.uuid } })
        }
        className="bg-secondary h-40 w-28 items-center justify-center overflow-hidden rounded"
      >
        <Icon
          as={listening ? Headphones : BookOpen}
          size={24}
          className="text-muted-foreground absolute"
        />
        {listening || (!hasTextCover(book) && hasAudioCover(book)) ? (
          <AudiobookCover book={book} />
        ) : (
          <EbookCover book={book} />
        )}
      </Pressable>
      <View className="min-w-0 flex-1 justify-between gap-2">
        <View className="gap-0.5">
          <Text className="text-primary text-xs font-semibold tracking-wider uppercase">
            {listening ? "Continue listening" : "Continue reading"}
          </Text>
          <Text className="text-lg font-semibold" numberOfLines={2}>
            {book.title}
          </Text>
          {!!(author || seriesLabel) && (
            <Text className="text-muted-foreground text-sm" numberOfLines={1}>
              {[author, seriesLabel].filter(Boolean).join(" · ")}
            </Text>
          )}
        </View>
        {hasProgress && (
          <View className="gap-1">
            <ProgressBar
              progress={progress * 100}
              accessibilityLabel={`${Math.round(progress * 100)}% of ${book.title}`}
            />
            {!!details && (
              <Text className="text-muted-foreground text-sm" numberOfLines={1}>
                {details}
              </Text>
            )}
          </View>
        )}
        <View className="flex-row flex-wrap gap-2">
          {needsDownload ? (
            downloadState?.action !== "download" &&
            downloadState?.action !== "retry" ? (
              <Text className="text-muted-foreground py-2 text-sm">
                {downloadState?.label}
                {downloading && openWhenReady ? " — opens when ready" : ""}
              </Text>
            ) : (
              <Button
                accessibilityLabel={`Download and continue ${book.title}`}
                onPress={() => {
                  setOpenWhenReady(true)
                  void downloadBook({
                    bookUuid: book.uuid,
                    format: session.format,
                  })
                }}
              >
                <Icon
                  as={Download}
                  size={18}
                  className="text-primary-foreground"
                />
                <Text>Download & continue</Text>
              </Button>
            )
          ) : session.format === "readaloud" ? (
            <>
              <Button
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
                <Text>Listen</Text>
              </Button>
              <Button
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
                <Text>Read along</Text>
              </Button>
            </>
          ) : (
            <Button
              accessibilityLabel={`${listening ? "Listen to" : "Read"} ${book.title}`}
              onPress={() => open(session.mode)}
            >
              <Icon
                as={listening ? Headphones : BookOpen}
                size={18}
                className="text-primary-foreground"
              />
              <Text>{listening ? "Listen" : "Read"}</Text>
            </Button>
          )}
        </View>
      </View>
    </View>
  )
}
