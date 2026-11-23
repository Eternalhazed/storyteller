import { useLocalSearchParams, useSegments } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useEffect } from "react"

import { Epub } from "@/components/Epub"
import { LoadingView } from "@/components/LoadingView"
import { useIsFocused } from "@/hooks/useIsFocused"
import { useIsNotBackground } from "@/hooks/useIsNotBackground"
import { useClosePassageOnUnmount } from "@/hooks/usePassageSurface"
import { useRememberReadingSession } from "@/hooks/useReadingSession"
import { useSpansFold } from "@/lib/pose"
import { useAppDispatch, useAppSelector } from "@/store/appState"
import { useGetBookQuery } from "@/store/localApi"
import { bookshelfSlice } from "@/store/slices/bookshelfSlice"
import { type UUID } from "@/uuid"

export default function BookScreen() {
  const { uuid, format } = useLocalSearchParams() as {
    uuid: UUID
    format: "readaloud" | "ebook"
  }

  const dispatch = useAppDispatch()
  useClosePassageOnUnmount({ bookUuid: uuid, format, surface: "text" })

  const { data: book } = useGetBookQuery({ uuid })
  const locator = book?.position?.locator

  const isFocused = useIsFocused()
  const segments = useSegments()
  const isReaderSheetOpen =
    segments.includes("navigation-menu") ||
    segments.includes("speed-menu") ||
    segments.includes("reading-settings") ||
    segments.includes("footnote")
  const isNotBackground = useIsNotBackground()

  const isAudioLoading = useAppSelector(
    (state) => state.bookshelf.isAudioLoading,
  )
  const readerReadyForBook = useAppSelector(
    ({ bookshelf }) =>
      bookshelf.currentlyPlayingBookUuid === uuid &&
      bookshelf.currentlyPlayingFormat === format,
  )
  const showEpub =
    !!book &&
    !!locator &&
    (isFocused || isReaderSheetOpen) &&
    isNotBackground &&
    !isAudioLoading

  useRememberReadingSession(
    showEpub &&
      readerReadyForBook &&
      book[format]?.downloadStatus === "DOWNLOADED"
      ? { bookUuid: uuid, mode: "reading", format }
      : null,
  )

  useEffect(() => {
    dispatch(bookshelfSlice.actions.bookOpened({ bookUuid: uuid, format }))
  }, [dispatch, format, uuid])

  useEffect(() => {
    dispatch(
      bookshelfSlice.actions.playbackSpeedContextChanged({
        context: format === "readaloud" && showEpub ? "reading" : "listening",
      }),
    )

    return () => {
      dispatch(
        bookshelfSlice.actions.playbackSpeedContextChanged({
          context: "listening",
        }),
      )
    }
  }, [dispatch, format, showEpub])

  const spansFold = useSpansFold()

  return (
    <>
      <StatusBar
        verticalBarBehaviorIOS={spansFold ? "disabled" : "automatic"}
      />
      {!showEpub || !book || !locator ? (
        <LoadingView />
      ) : (
        <Epub key={book.uuid} format={format} book={book} locator={locator} />
      )}
    </>
  )
}
