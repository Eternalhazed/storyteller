import AsyncStorage from "@react-native-async-storage/async-storage"
import { useCallback, useEffect, useState } from "react"
import { View } from "react-native"

import { Button } from "@/components/ui/button"
import { Text } from "@/components/ui/text"
import { cn } from "@/lib/utils"
import { logger } from "@/logger"
import { looksFinished } from "@/store/finish"
import {
  useListBooksQuery,
  useListStatusesQuery,
  useUpdateStatusMutation,
} from "@/store/localApi"
import { type UUID } from "@/uuid"

const STORAGE_KEY = "storyteller.looks-finished-dismissed"

export type LooksFinishedCardProps = {
  className?: string
}

/** One-time cleanup of old Reading statuses; it is not a recurring Home shelf. */
export function LooksFinishedCard({ className }: LooksFinishedCardProps = {}) {
  const { data: books, isFetching } = useListBooksQuery()
  const { data: statuses } = useListStatusesQuery()
  const [updateStatus] = useUpdateStatusMutation()
  const [dismissed, setDismissed] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const candidates = books ? looksFinished(books, 0.9) : []
  const readStatus = statuses?.find((status) => status.name === "Read")

  const dismiss = useCallback(() => {
    setDismissed(true)
    void AsyncStorage.setItem(STORAGE_KEY, "true").catch(() => {
      logger.error("Could not remember the finished-book cleanup dismissal")
    })
  }, [])

  useEffect(() => {
    let active = true
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        if (active) setDismissed(value !== null)
      })
      .catch(() => {
        logger.error("Could not read the finished-book cleanup dismissal")
        if (active) setDismissed(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (
      dismissed === false &&
      books &&
      !isFetching &&
      candidates.length === 0
    ) {
      dismiss()
    }
  }, [books, candidates.length, dismiss, dismissed, isFetching])

  if (dismissed !== false || !candidates.length) return null

  async function markRead(bookUuids: UUID[]) {
    if (!readStatus || busy) return
    setBusy(true)
    setError(null)
    try {
      for (const bookUuid of bookUuids) {
        await updateStatus({ bookUuid, statusUuid: readStatus.uuid }).unwrap()
      }
    } catch {
      setError("Could not mark every book as read. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <View
      className={cn(
        "border-border bg-card mr-safe-or-4 max-w-3xl rounded-xl border p-4",
        className,
      )}
    >
      <Text variant="h3">Looks finished</Text>
      <Text className="text-muted-foreground mt-1">
        These books are at least 90% through. Mark the ones you have finished.
      </Text>
      <View className="mt-3 gap-3">
        {candidates.map((book) => (
          <View
            key={book.uuid}
            className="flex-row flex-wrap items-center justify-between gap-2"
          >
            <Text className="min-w-0 grow basis-40" numberOfLines={2}>
              {book.title}
            </Text>
            <Button
              size="flex"
              variant="secondary"
              accessibilityLabel={`Mark ${book.title} as read`}
              disabled={busy || !readStatus}
              onPress={() => void markRead([book.uuid])}
            >
              <Text>Mark as read</Text>
            </Button>
          </View>
        ))}
      </View>
      {error && (
        <Text className="text-destructive mt-3" accessibilityRole="alert">
          {error}
        </Text>
      )}
      <View className="mt-4 flex-row flex-wrap gap-2">
        <Button
          size="flex"
          accessibilityLabel="Mark all as read"
          disabled={busy || !readStatus}
          onPress={() => void markRead(candidates.map((book) => book.uuid))}
        >
          <Text>Mark all as read</Text>
        </Button>
        <Button
          size="flex"
          variant="ghost"
          accessibilityLabel="Not now"
          disabled={busy}
          onPress={dismiss}
        >
          <Text>Not now</Text>
        </Button>
      </View>
    </View>
  )
}
