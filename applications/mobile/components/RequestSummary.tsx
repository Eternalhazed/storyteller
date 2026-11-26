import { type RequestView } from "@storyteller/web/src/requests/http"
import { Link, useRouter } from "expo-router"
import {
  BookOpen,
  Download,
  EllipsisVertical,
  Headphones,
  type LucideIcon,
} from "lucide-react-native"
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

import { HomeStripProgress } from "./HomeStripProgress"
import { homeRequestStatus } from "./homeRequestStatus"
import { Button } from "./ui/button"
import { Icon } from "./ui/icon"
import { Menu } from "./ui/menu"
import { Text } from "./ui/text"

export function OpenRequestedBook({
  bookUuid,
  serverUuid,
  label = "Open book",
  onOpened,
  compact,
}: {
  bookUuid: UUID
  serverUuid: UUID
  label?: string
  onOpened?: (() => void) | undefined
  compact?: { icon: LucideIcon; onError: (message: string | null) => void }
}) {
  const dispatch = useAppDispatch()
  const router = useRouter()
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState(false)

  async function openBook() {
    setOpening(true)
    setError(false)
    compact?.onError(null)
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
      if (compact) compact.onError("Could not open the book. Try again.")
      else setError(true)
    } finally {
      setOpening(false)
    }
  }

  if (compact) {
    return (
      <Button
        size="icon"
        className="min-h-11 min-w-11"
        accessibilityLabel={label}
        accessibilityState={{ busy: opening }}
        disabled={opening}
        onPress={openBook}
      >
        <Icon as={compact.icon} size={18} className="text-primary-foreground" />
      </Button>
    )
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

  const errorMessage = error ? (
    <Text className="text-destructive text-sm" accessibilityLiveRegion="polite">
      {error}
    </Text>
  ) : null

  if (home) {
    const stage = homeRequestStatus(request)
    return (
      <View className="border-border bg-card gap-1 rounded-xl border p-2">
        <View className="flex-row items-center gap-2">
          <View className="bg-secondary h-16 w-11 shrink-0 items-center justify-center rounded">
            <Icon as={Download} size={18} className="text-muted-foreground" />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <Text className="font-semibold" numberOfLines={1}>
              {request.work.title}
            </Text>
            <Text className="text-muted-foreground text-xs" numberOfLines={1}>
              {stage.label}
            </Text>
            {stage.percent !== undefined && (
              <HomeStripProgress label={stage.label} percent={stage.percent} />
            )}
          </View>
          <View className="shrink-0 flex-row items-center gap-1">
            {card.primary && (
              <OpenRequestedBook
                serverUuid={serverUuid}
                bookUuid={request.bookUuid}
                label={card.primary}
                compact={{
                  icon: card.primary === "Listen now" ? Headphones : BookOpen,
                  onError: setError,
                }}
                onOpened={
                  card.dismissOnOpen
                    ? () => {
                        void dismiss({ serverUuid, requestUuid })
                      }
                    : undefined
                }
              />
            )}
            <Menu
              actions={[
                ...card.pick.map((format) => ({
                  id: `pick-${format}`,
                  title: `${request[format].status === "choosing" ? "Pick" : "Pick another"} ${REQUEST_FORMAT_LABEL[format].toLowerCase()}`,
                  onPress: () =>
                    router.push(
                      requestPickerHref(serverUuid, { requestUuid, format }),
                    ),
                })),
                ...(card.retrySync
                  ? [
                      {
                        id: "retry",
                        title: "Retry narration sync",
                        attributes: { disabled: retrying },
                        onPress: retry,
                      },
                    ]
                  : []),
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
                className="min-h-11 min-w-11"
                accessibilityLabel={`Request options for ${request.work.title}`}
              >
                <Icon as={EllipsisVertical} size={22} />
              </Button>
            </Menu>
          </View>
        </View>
        {errorMessage}
      </View>
    )
  }

  return (
    <View className="border-border bg-card gap-2 rounded-lg border p-4">
      <Text className="font-semibold">{card.title}</Text>
      {card.primary && (
        <OpenRequestedBook
          serverUuid={serverUuid}
          bookUuid={request.bookUuid}
          label={card.primary}
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
                <Text numberOfLines={1}>
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
              <Text numberOfLines={1}>
                {retrying ? "Retrying…" : "Retry narration sync"}
              </Text>
            </Button>
          )}
        </View>
      )}
      {errorMessage}
    </View>
  )
}
