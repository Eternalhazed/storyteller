import { router } from "expo-router"
import { useEffect, useState } from "react"
import { Alert, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Button } from "@/components/ui/button"
import { Text } from "@/components/ui/text"
import { type BookWithRelations } from "@/database/books"
import { useNextAfterFinish } from "@/hooks/useNextAfterFinish"
import { useRecommendationConfig } from "@/hooks/useRecommendations"
import { useAppDispatch, useAppSelector } from "@/store/appState"
import { getProgress } from "@/store/finish"
import {
  useDownloadBookMutation,
  useGetBookQuery,
  useGetGlobalPreferencesQuery,
  useListStatusesQuery,
  useUpdateStatusMutation,
} from "@/store/localApi"
import { recommendationsHref } from "@/store/recommendations"
import { serverApi } from "@/store/serverApi"
import { finishSlice } from "@/store/slices/finishSlice"
import { type UUID } from "@/uuid"

export type FinishPromptProps = {
  bookUuid: UUID
  /** Reader: floats above its controls. Player: occupies space above playback. */
  placement?: "reader" | "player"
}

export function FinishPrompt({
  bookUuid,
  placement = "reader",
}: FinishPromptProps) {
  const dispatch = useAppDispatch()
  const insets = useSafeAreaInsets()
  const prompt = useAppSelector(
    (state) => state.finish.prompts[bookUuid] ?? null,
  )
  const { data: book } = useGetBookQuery({ uuid: bookUuid })
  const { data: preferences } = useGetGlobalPreferencesQuery()
  const { data: statuses } = useListStatusesQuery()
  const [updateStatus] = useUpdateStatusMutation()
  const [downloadBook] = useDownloadBookMutation()
  const next = useNextAfterFinish(bookUuid)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const readStatus = statuses?.find((status) => status.name === "Read")
  const expiresAt = prompt?.kind === "undo" ? prompt.expiresAt : undefined

  useEffect(() => {
    setError(null)
  }, [bookUuid])

  useEffect(() => {
    if (expiresAt === undefined) return
    const timeout = setTimeout(
      () => {
        dispatch(finishSlice.actions.promptCleared({ bookUuid }))
      },
      Math.max(0, expiresAt - Date.now()),
    )
    return () => clearTimeout(timeout)
  }, [bookUuid, dispatch, expiresAt])

  if (
    !prompt ||
    (prompt.kind === "ask" && preferences?.finishPrompt.mode !== "ask") ||
    (prompt.kind === "undo" && prompt.expiresAt <= Date.now())
  ) {
    return null
  }

  const dismissal = {
    bookUuid,
    progress: Math.max(prompt.progress, getProgress(book?.position?.locator)),
  }

  async function openNext(nextBook: BookWithRelations) {
    if (nextBook.readaloud?.downloadStatus === "DOWNLOADED") {
      router.replace({
        pathname: "/read/[uuid]",
        params: { uuid: nextBook.uuid, format: "readaloud" },
      })
      return
    }
    if (nextBook.ebook?.downloadStatus === "DOWNLOADED") {
      router.replace({
        pathname: "/read/[uuid]",
        params: { uuid: nextBook.uuid, format: "ebook" },
      })
      return
    }

    const format =
      nextBook.readaloud?.status === "ALIGNED"
        ? "readaloud"
        : nextBook.ebook
          ? "ebook"
          : nextBook.audiobook
            ? "audiobook"
            : null
    if (
      format === "audiobook" &&
      nextBook.audiobook?.downloadStatus === "DOWNLOADED"
    ) {
      router.replace({
        pathname: "/listen/[uuid]",
        params: { uuid: nextBook.uuid, format },
      })
      return
    }
    if (format) {
      await downloadBook({ bookUuid: nextBook.uuid, format }).unwrap()
    }
    router.replace({
      pathname: "/book/[uuid]",
      params: { uuid: nextBook.uuid },
    })
  }

  async function markRead(startNext: boolean) {
    if (!readStatus || busy) return
    setBusy(true)
    setError(null)
    try {
      await updateStatus({ bookUuid, statusUuid: readStatus.uuid }).unwrap()
    } catch {
      setError("Could not mark this book as read. Try again.")
      setBusy(false)
      return
    }
    dispatch(finishSlice.actions.promptCleared({ bookUuid }))
    if (startNext && next) {
      try {
        await openNext(next.book)
      } catch {
        Alert.alert(
          "Could not start the next book",
          "This book is marked as read. Open the next book from Home to try again.",
        )
      }
    }
    setBusy(false)
  }

  async function undo() {
    if (prompt?.kind !== "undo" || busy) return
    setBusy(true)
    setError(null)
    // Suppress another automatic finish before the restored status is persisted.
    dispatch(finishSlice.actions.dismissalRecorded(dismissal))
    try {
      await updateStatus({
        bookUuid,
        statusUuid: prompt.previousStatusUuid,
      }).unwrap()
      dispatch(finishSlice.actions.promptCleared({ bookUuid }))
    } catch {
      setError("Could not undo this change. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <View
      pointerEvents="box-none"
      className={placement === "reader" ? "absolute z-50" : "mt-2 w-full px-6"}
      style={
        placement === "reader"
          ? {
              left: insets.left + 16,
              right: insets.right + 16,
              bottom: insets.bottom + 100,
            }
          : undefined
      }
    >
      <View className="border-border bg-background rounded-xl border p-4 shadow-lg">
        <Text variant="h4" accessibilityLiveRegion="polite">
          {prompt.kind === "ask" ? "Finished?" : "Marked as read"}
        </Text>
        {error && (
          <Text className="text-destructive mt-2" accessibilityRole="alert">
            {error}
          </Text>
        )}
        <View className="mt-3 flex-row flex-wrap gap-2">
          {prompt.kind === "undo" ? (
            <Button
              size="flex"
              variant="secondary"
              accessibilityLabel="Undo marking this book as read"
              disabled={busy}
              onPress={() => void undo()}
            >
              <Text>Undo</Text>
            </Button>
          ) : (
            <>
              <Button
                size="flex"
                accessibilityLabel="Mark as read"
                disabled={busy || !readStatus}
                onPress={() => void markRead(false)}
              >
                <Text>Mark as read</Text>
              </Button>
              {next && (
                <Button
                  size="flex"
                  variant="secondary"
                  className="max-w-full"
                  accessibilityLabel={`Mark as read and start next: ${next.label}`}
                  disabled={busy || !readStatus}
                  onPress={() => void markRead(true)}
                >
                  <Text className="shrink">
                    Mark as read &amp; start next: {next.label}
                  </Text>
                </Button>
              )}
              <Button
                size="flex"
                variant="ghost"
                accessibilityLabel="Not yet"
                disabled={busy}
                onPress={() =>
                  dispatch(finishSlice.actions.promptDismissed(dismissal))
                }
              >
                <Text>Not yet</Text>
              </Button>
            </>
          )}
        </View>
      </View>
    </View>
  )
}
