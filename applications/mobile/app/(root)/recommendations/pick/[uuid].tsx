import { skipToken } from "@reduxjs/toolkit/query"
import {
  type NotForMeReason,
  type PickView,
  type ReaderPickState,
} from "@storyteller/web/src/recommendations/types"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useEffect, useState } from "react"
import { Pressable, View } from "react-native"

import {
  PickBadges,
  RecommendationCover,
} from "@/components/RecommendationCards"
import { ChoiceChips } from "@/components/RecommendationInterview"
import { RequestError, RequestPage } from "@/components/RequestPage"
import { Button } from "@/components/ui/button"
import { Text } from "@/components/ui/text"
import { useRequestServer } from "@/hooks/useBookRequests"
import { useIsFocused } from "@/hooks/useIsFocused"
import {
  blocksCachedRecommendations,
  useRecommendationConfig,
} from "@/hooks/useRecommendations"
import {
  recommendationLength,
  recommendationsHref,
  resolvedWorkHref,
  seriesLine,
} from "@/store/recommendations"
import { requestErrorMessage, requestErrorStatus } from "@/store/requestErrors"
import { parseRequestUuid } from "@/store/requestNavigation"
import { serverApi } from "@/store/serverApi"
import { type UUID } from "@/uuid"

const REASONS: readonly (readonly [NotForMeReason, string])[] = [
  ["not_my_thing", "Not my thing"],
  ["too_long", "Too long"],
  ["author", "Didn’t like the author"],
  ["other", "Other"],
]
const RATINGS = ["1", "2", "3", "4", "5"].map(
  (rating) => [rating, `${rating} ★`] as const,
)

function PickDetails({
  pick,
  serverUuid,
  requestsEnabled,
  offline,
}: {
  pick: PickView
  serverUuid: UUID
  requestsEnabled: boolean
  offline: boolean
}) {
  const router = useRouter()
  const [mode, setMode] = useState<"rating" | "reason" | null>(null)
  const [rating, setRating] = useState<string | null>(null)
  const [reason, setReason] = useState<NotForMeReason | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [update, { isLoading }] =
    serverApi.useSetRecommendationPickStateMutation()
  const busy = isLoading || offline
  const length = recommendationLength(pick.work)

  async function changeState(state: ReaderPickState) {
    setError(null)
    try {
      await update({
        serverUuid,
        recommendationUuid: pick.uuid,
        state,
        ...(state === "already_read" && rating
          ? { rating: Number(rating) }
          : {}),
        ...(state === "not_for_me" && reason ? { reason } : {}),
      }).unwrap()
      if (router.canGoBack()) router.back()
      else router.replace(recommendationsHref(serverUuid))
    } catch (cause) {
      setError(
        requestErrorMessage(cause, "Could not update this pick. Try again."),
      )
    }
  }

  return (
    <>
      <View className="flex-row items-start gap-4">
        <RecommendationCover url={pick.work.coverUrl} className="w-24" />
        <View className="flex-1 gap-1">
          <Text variant="h3">{pick.work.title}</Text>
          {!!pick.work.authors.length && (
            <Text>{pick.work.authors.join(", ")}</Text>
          )}
          {pick.series && (
            <Text className="text-muted-foreground">
              {seriesLine(pick.series)}
            </Text>
          )}
          {!pick.series && pick.work.series && (
            <Text className="text-muted-foreground">
              {pick.work.series.name}
              {pick.work.series.position === null ||
              !Number.isInteger(pick.work.series.position)
                ? ""
                : ` · Book ${pick.work.series.position}`}
            </Text>
          )}
          {!!length && <Text className="text-muted-foreground">{length}</Text>}
          <PickBadges pick={pick} />
        </View>
      </View>
      <View className="gap-2">
        <Text variant="h4">Why this book</Text>
        <Text>{pick.why || pick.reason}</Text>
        {pick.evidence.map(({ id, text }) => (
          <Text key={id} className="text-muted-foreground">
            • {text}
          </Text>
        ))}
        {pick.note && (
          <Text className="text-muted-foreground italic">{pick.note}</Text>
        )}
      </View>
      {pick.work.description && (
        <View className="gap-2">
          <Text variant="h4">About this book</Text>
          <Text numberOfLines={aboutOpen ? undefined : 4}>
            {pick.work.description}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setAboutOpen((open) => !open)
            }}
          >
            <Text className="text-primary text-sm">
              {aboutOpen ? "Less" : "More"}
            </Text>
          </Pressable>
        </View>
      )}
      {offline && (
        <Text className="text-muted-foreground">
          Server unavailable — showing your last pick.
        </Text>
      )}
      {error && <RequestError>{error}</RequestError>}
      {mode ? (
        <View className="gap-2">
          <Text variant="h4">
            {mode === "rating"
              ? "Rate this book (optional)"
              : "Tell us why (optional)"}
          </Text>
          {mode === "rating" ? (
            <ChoiceChips
              options={RATINGS}
              selected={rating}
              choose={(value) => setRating(rating === value ? null : value)}
              disabled={busy}
            />
          ) : (
            <ChoiceChips
              options={REASONS}
              selected={reason}
              choose={(value) => setReason(reason === value ? null : value)}
              disabled={busy}
            />
          )}
          <View className="flex-row flex-wrap gap-2">
            <Button
              size="flex"
              disabled={busy}
              onPress={() =>
                void changeState(
                  mode === "rating" ? "already_read" : "not_for_me",
                )
              }
            >
              <Text>
                {mode === "rating" ? "Mark already read" : "Confirm not for me"}
              </Text>
            </Button>
            <Button
              variant="ghost"
              disabled={isLoading}
              onPress={() => setMode(null)}
            >
              <Text>Cancel</Text>
            </Button>
          </View>
        </View>
      ) : (
        <View className="flex-row flex-wrap gap-2">
          {requestsEnabled && pick.state !== "requested" && (
            <Button
              disabled={busy}
              onPress={() =>
                router.replace(
                  resolvedWorkHref(serverUuid, pick.work, pick.uuid),
                )
              }
            >
              <Text>Get</Text>
            </Button>
          )}
          <Button
            variant="outline"
            disabled={busy}
            accessibilityLabel={
              pick.state === "saved" ? "Remove from Saved" : "Save"
            }
            onPress={() =>
              void changeState(pick.state === "saved" ? "new" : "saved")
            }
          >
            <Text>{pick.state === "saved" ? "Saved" : "Save"}</Text>
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onPress={() => setMode("rating")}
          >
            <Text>Already read</Text>
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onPress={() => void changeState("not_now")}
          >
            <Text>Not now</Text>
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onPress={() => setMode("reason")}
          >
            <Text>Not for me</Text>
          </Button>
        </View>
      )}
    </>
  )
}

export default function RecommendationPickScreen() {
  const {
    uuid,
    serverUuid: requestedServer,
    notification,
  } = useLocalSearchParams<{
    uuid: string
    serverUuid?: string
    notification?: string
  }>()
  const [openedAt] = useState(() => Date.now())
  const router = useRouter()
  const recommendationUuid = parseRequestUuid(uuid)
  const { serverUuid, isLoading } = useRequestServer(requestedServer)
  const focused = useIsFocused()
  const configQuery = useRecommendationConfig(serverUuid, focused)
  const config = configQuery.config
  const query = serverApi.useGetRecommendationPickQuery(
    serverUuid && recommendationUuid && config?.enabled
      ? { serverUuid, recommendationUuid }
      : skipToken,
    { refetchOnMountOrArgChange: true },
  )
  const { currentData: feed, error: feedError } =
    serverApi.endpoints.getRecommendations.useQueryState(
      serverUuid && notification !== "true" ? { serverUuid } : skipToken,
    )
  const status = requestErrorStatus(query.error)
  const fallback = notification === "true" && (status === 403 || status === 404)
  useEffect(() => {
    if (fallback) router.replace(recommendationsHref(serverUuid))
  }, [fallback, router, serverUuid])

  const cached =
    query.isError &&
    feed &&
    !blocksCachedRecommendations(feedError) &&
    (feed.forYou.find((pick) => pick.uuid === recommendationUuid) ??
      feed.saved.find((pick) => pick.uuid === recommendationUuid) ??
      feed.sections
        .flatMap((section) => section.picks)
        .find((pick) => pick.uuid === recommendationUuid))
  const forbidden = blocksCachedRecommendations(query.error)
  const freshTap =
    notification === "true" &&
    (query.isFetching ||
      !query.isSuccess ||
      (query.fulfilledTimeStamp ?? 0) < openedAt)
  const pick =
    forbidden || freshTap
      ? undefined
      : (query.currentData ?? (cached || undefined))
  return (
    <RequestPage>
      {isLoading ||
      configQuery.isLoading ||
      (query.isFetching && (!pick || freshTap)) ||
      fallback ? (
        <Text>Loading pick…</Text>
      ) : serverUuid && config?.enabled && pick ? (
        <PickDetails
          key={pick.uuid}
          pick={pick}
          serverUuid={serverUuid}
          requestsEnabled={config.requestsEnabled}
          offline={configQuery.isError || query.isError}
        />
      ) : (
        <Text>This pick isn’t available on this account.</Text>
      )}
    </RequestPage>
  )
}
