import { type RequestView } from "@storyteller/web/src/requests/http"
import { Link, useRouter } from "expo-router"
import { EllipsisVertical } from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"

import { useAppDispatch } from "@/store/appState"
import { getRequestCard, REQUEST_FORMAT_LABEL } from "@/store/requestCard"
import { requestErrorMessage } from "@/store/requestErrors"
import {
  requestDetailHref,
  requestListHref,
  requestPickerHref,
} from "@/store/requestNavigation"
import { serverApi } from "@/store/serverApi"
import { type UUID } from "@/uuid"

import { Button } from "./ui/button"
import { Icon } from "./ui/icon"
import { Menu } from "./ui/menu"
import { Text } from "./ui/text"

export function OpenRequestedBook({
  bookUuid,
  serverUuid,
  label = "Open book",
  onOpened,
}: {
  bookUuid: UUID
  serverUuid: UUID
  label?: string
  onOpened?: (() => void) | undefined
}) {
  const dispatch = useAppDispatch()
  const router = useRouter()
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState(false)

  async function openBook() {
    setOpening(true)
    setError(false)
    try {
      await dispatch(
        serverApi.endpoints.getBook.initiate(
          { serverUuid, bookUuid },
          {
            forceRefetch: true,
            subscribe: false,
          },
        ),
      ).unwrap()
      router.push({ pathname: "/book/[uuid]", params: { uuid: bookUuid } })
      onOpened?.()
    } catch {
      setError(true)
    } finally {
      setOpening(false)
    }
  }

  return (
    <View className="items-start gap-2">
      <Button disabled={opening} onPress={openBook}>
        <Text className="font-semibold">{opening ? "Opening…" : label}</Text>
      </Button>
      {error && (
        <Text
          className="text-destructive text-sm"
          accessibilityLiveRegion="polite"
        >
          Could not open the book. Try again.
        </Text>
      )}
    </View>
  )
}

export function RequestSummary({
  request,
  serverUuid,
  home = false,
}: {
  request: RequestView
  serverUuid: UUID
  home?: boolean
}) {
  const router = useRouter()
  const card = getRequestCard(request)
  const [retrySync, { isLoading: retrying }] =
    serverApi.useRetryRequestSyncMutation()
  const [dismiss, { isLoading: dismissing }] =
    serverApi.useDismissRequestMutation()
  const [error, setError] = useState<string | null>(null)
  const requestUuid = request.uuid

  async function retry() {
    setError(null)
    try {
      await retrySync({ serverUuid, requestUuid }).unwrap()
    } catch (cause) {
      setError(
        requestErrorMessage(
          cause,
          "Could not retry narration sync. Try again.",
        ),
      )
    }
  }

  async function dismissCard() {
    setError(null)
    try {
      await dismiss({ serverUuid, requestUuid }).unwrap()
    } catch (cause) {
      setError(
        requestErrorMessage(
          cause,
          "Could not dismiss this request. Try again.",
        ),
      )
    }
  }

  return (
    <View className="border-border bg-card gap-2 rounded-lg border p-4">
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 font-semibold">{card.title}</Text>
        {home && (
          <Menu
            actions={[
              {
                id: "details",
                title: "Request details",
                onPress: () =>
                  router.push(requestDetailHref(serverUuid, requestUuid)),
              },
              {
                id: "requests",
                title: "All requests",
                onPress: () => router.push(requestListHref(serverUuid)),
              },
              {
                id: "dismiss",
                title: "Dismiss from Home",
                attributes: { disabled: dismissing },
                onPress: dismissCard,
              },
            ]}
          >
            <Button
              variant="ghost"
              size="icon"
              accessibilityLabel={`Request options for ${request.work.title}`}
            >
              <Icon as={EllipsisVertical} size={22} />
            </Button>
          </Menu>
        )}
      </View>
      {card.primary && (
        <OpenRequestedBook
          serverUuid={serverUuid}
          bookUuid={request.bookUuid}
          label={card.primary}
          onOpened={
            home && card.dismissOnOpen
              ? () => {
                  void dismiss({ serverUuid, requestUuid })
                }
              : undefined
          }
        />
      )}
      {!!card.status && (
        <Text className="text-muted-foreground text-sm">{card.status}</Text>
      )}
      {(card.pick.length > 0 || card.retrySync) && (
        <View className="flex-row flex-wrap gap-2">
          {card.pick.map((format) => (
            <Link
              key={format}
              href={requestPickerHref(serverUuid, { requestUuid, format })}
              asChild
            >
              <Button variant="outline" size="flex">
                <Text>
                  {request[format].status === "choosing"
                    ? "Pick"
                    : "Pick another"}{" "}
                  {REQUEST_FORMAT_LABEL[format].toLowerCase()}
                </Text>
              </Button>
            </Link>
          ))}
          {card.retrySync && (
            <Button variant="outline" disabled={retrying} onPress={retry}>
              <Text>{retrying ? "Retrying…" : "Retry narration sync"}</Text>
            </Button>
          )}
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
  )
}
