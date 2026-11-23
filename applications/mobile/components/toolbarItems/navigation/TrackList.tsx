import { skipToken } from "@reduxjs/toolkit/query"
import { type RefObject, useRef } from "react"
import { type ScrollViewInstance, View, type ViewInstance } from "react-native"
import { ScrollView } from "react-native-gesture-handler"

import { useReaderFormSheetScrollPaddingBottom } from "@/components/toolbarItems/readerFormSheetLayout"
import { Button } from "@/components/ui/button"
import { Text } from "@/components/ui/text"
import { cn } from "@/lib/utils"
import {
  AUDIOBOOK_TOC_LOOKAHEAD_SECONDS,
  getAudiobookTocItemAtPosition,
} from "@/modules/readium"
import { type ReadiumLink } from "@/modules/readium/src/Readium.types"
import { useAppDispatch, useAppSelector } from "@/store/appState"
import { useGetBookQuery } from "@/store/localApi"
import {
  getCurrentTrackIndex,
  getCurrentlyPlayingFormat,
  getPosition,
  getTracks,
} from "@/store/selectors/bookshelfSelectors"
import { passageSlice } from "@/store/slices/passageSlice"
import { type UUID } from "@/uuid"

interface Props {
  bookUuid?: UUID | undefined
  format?: "readaloud" | "ebook" | "audiobook" | undefined
  onClose?: () => void
}

export function TrackLisk({
  bookUuid: bookUuidProp,
  format: formatProp,
  onClose,
}: Props) {
  const dispatch = useAppDispatch()
  const ref = useRef<null | ScrollViewInstance>(null)
  const currentItemRef = useRef<null | ViewInstance>(null)

  const selectedFormat = useAppSelector(getCurrentlyPlayingFormat)
  const bookUuid = bookUuidProp
  const format = formatProp ?? selectedFormat ?? "readaloud"

  const currentTrackIndex = useAppSelector(getCurrentTrackIndex)
  const position = useAppSelector(getPosition)

  const { data: book } = useGetBookQuery(
    bookUuid ? { uuid: bookUuid } : skipToken,
  )

  const tracks = useAppSelector(getTracks)

  const fromTracks = tracks.map(
    (track) =>
      ({
        href: track.relativeUri + "#t=0",
        title: track.title,
      }) as ReadiumLink,
  )

  const manifest =
    format === "audiobook"
      ? book?.audiobook?.manifest
      : book?.readaloud?.audioManifest

  const listing = manifest?.toc ?? fromTracks

  const paddingBottom = useReaderFormSheetScrollPaddingBottom()

  const currentTocItem = manifest?.toc
    ? getAudiobookTocItemAtPosition(
        manifest,
        currentTrackIndex,
        position + AUDIOBOOK_TOC_LOOKAHEAD_SECONDS,
      )
    : listing[currentTrackIndex]

  if (!book?.position || format === "ebook") return null
  const origin = book.position.locator

  function openChapter(link: ReadiumLink) {
    if (currentTocItem === link || !bookUuid) return
    const [relativeUri, start] = link.href.split("#t=")
    const seconds = Number.parseFloat(start ?? "0")
    if (!relativeUri || !Number.isFinite(seconds) || seconds < 0) return
    dispatch(
      passageSlice.actions.jump({
        bookUuid,
        format,
        surface: "audio",
        purpose: "chapter",
        origin,
        target: { audio: { relativeUri, seconds } },
      }),
    )
    onClose?.()
  }

  return (
    <ScrollView
      ref={ref}
      className="flex-1"
      contentContainerClassName="px-2 pt-2"
      contentContainerStyle={{ paddingBottom }}
      onLayout={() => {
        if (!ref.current) return
        currentItemRef.current?.measureLayout(ref.current, (_x, y) => {
          ref.current?.scrollTo({
            y: y - 40,
            animated: false,
          })
        })
      }}
    >
      <Sublist
        listing={listing}
        currentTocItem={currentTocItem ?? undefined}
        currentItemRef={currentItemRef}
        onChapter={openChapter}
      />
    </ScrollView>
  )
}

function Sublist({
  listing,
  currentTocItem,
  currentItemRef,
  onChapter,
}: {
  listing: ReadiumLink[]
  currentTocItem: ReadiumLink | undefined
  currentItemRef: RefObject<ViewInstance | null>
  onChapter: (link: ReadiumLink) => void
}) {
  return (
    <>
      {listing.map((link) => (
        <View
          collapsable={false}
          key={link.href}
          {...(link === currentTocItem && {
            ref: currentItemRef,
          })}
          className="py-0.5"
        >
          <Button
            variant={link === currentTocItem ? "secondary" : "ghost"}
            className={cn(
              "h-auto justify-start rounded-md border border-transparent px-3 py-3 sm:h-auto",
              {
                "border-border bg-secondary": link === currentTocItem,
              },
            )}
            onPress={() => onChapter(link)}
          >
            <Text className="text-sm font-bold">{link.title}</Text>
          </Button>
          <Sublist
            listing={link.children ?? []}
            currentTocItem={currentTocItem}
            currentItemRef={currentItemRef}
            onChapter={onChapter}
          />
        </View>
      ))}
    </>
  )
}
