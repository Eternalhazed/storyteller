import { Link, useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { View } from "react-native"

import { PickCard, RoundProgress } from "@/components/RecommendationCards"
import { RecommendationInterview } from "@/components/RecommendationInterview"
import { RequestError, RequestPage } from "@/components/RequestPage"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { useRequestServer } from "@/hooks/useBookRequests"
import { useIsFocused } from "@/hooks/useIsFocused"
import {
  useRecommendationConfig,
  useRecommendationFeed,
} from "@/hooks/useRecommendations"
import { requestErrorCode, requestErrorStatus } from "@/store/requestErrors"
import { serverApi } from "@/store/serverApi"
import { type UUID } from "@/uuid"

function Recommendations({
  serverUuid,
  requestsEnabled,
  configOffline,
}: {
  serverUuid: UUID
  requestsEnabled: boolean
  configOffline: boolean
}) {
  const router = useRouter()
  const focused = useIsFocused()
  const query = useRecommendationFeed(serverUuid, focused)
  const [start, { isLoading: refreshing }] =
    serverApi.useStartRecommendationRoundMutation()
  const [askText, setAskText] = useState("")
  const [savedOpen, setSavedOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const data = query.feed
  const offline = configOffline || query.isError

  function ask() {
    router.push({
      pathname: "/ask",
      params: { serverUuid, text: askText.trim(), submit: "true" },
    })
  }

  async function refresh() {
    setError(null)
    try {
      await start({ serverUuid, refresh: true }).unwrap()
    } catch (cause) {
      setError(
        requestErrorStatus(cause) === 429 ||
          requestErrorCode(cause) === "refresh-limit"
          ? "You’ve used all your refreshes for today. Try again tomorrow."
          : "Could not refresh your picks. Try again.",
      )
    }
  }

  const roundStatus = data ? (data.running ?? data.failed) : null
  return (
    <>
      <View className="flex-row items-center gap-2">
        <Input
          className="min-w-0 flex-1"
          accessibilityLabel="Ask for a book, or say what you’re after"
          placeholder="Ask for a book…"
          value={askText}
          onChangeText={setAskText}
          onSubmitEditing={askText.trim() && !offline ? ask : undefined}
          returnKeyType="go"
        />
        <Button disabled={!askText.trim() || offline} onPress={ask}>
          <Text>Ask</Text>
        </Button>
      </View>
      <View className="flex-row flex-wrap gap-2">
        <Link
          href={{ pathname: "/recommendations/tune", params: { serverUuid } }}
          asChild
        >
          <Button variant="outline" disabled={offline}>
            <Text>Tune</Text>
          </Button>
        </Link>
        <Link
          href={{
            pathname: "/recommendations/preferences",
            params: { serverUuid },
          }}
          asChild
        >
          <Button variant="outline" disabled={offline}>
            <Text>Preferences</Text>
          </Button>
        </Link>
      </View>
      {data ? (
        <>
          {offline && (
            <Text className="text-muted-foreground">
              Server unavailable — showing your last picks.
            </Text>
          )}
          {roundStatus && <RoundProgress round={roundStatus} />}
          {data.budgetPaused && (
            <Text className="text-muted-foreground">
              Weekly picks paused until next month
            </Text>
          )}
          {data.coldStart &&
            !data.running &&
            !data.sections.some((section) => section.picks.length) &&
            !offline && (
              <RecommendationInterview
                serverUuid={serverUuid}
                onStarted={() => void query.refetch()}
              />
            )}
          {data.sections.map(
            ({ section, title, picks }) =>
              picks.length > 0 && (
                <View key={section} className="gap-2">
                  <Text variant="h3">
                    {section === "finished" && picks[0]?.anchorTitle
                      ? `Because you finished ${picks[0].anchorTitle}`
                      : title}
                  </Text>
                  {picks.map((pick) => (
                    <PickCard
                      key={pick.uuid}
                      pick={pick}
                      serverUuid={serverUuid}
                      requestsEnabled={requestsEnabled}
                      offline={offline}
                    />
                  ))}
                </View>
              ),
          )}
          {data.saved.length > 0 && (
            <View className="gap-2">
              <Button
                variant="outline"
                className="self-start"
                accessibilityState={{ expanded: savedOpen }}
                onPress={() => setSavedOpen(!savedOpen)}
              >
                <Text>
                  Saved ({data.saved.length}){savedOpen ? " −" : " +"}
                </Text>
              </Button>
              {savedOpen &&
                data.saved.map((pick) => (
                  <PickCard
                    key={pick.uuid}
                    pick={pick}
                    serverUuid={serverUuid}
                    requestsEnabled={requestsEnabled}
                    offline={offline}
                  />
                ))}
            </View>
          )}
          <Link
            href={{
              pathname: "/recommendations/history",
              params: { serverUuid },
            }}
            asChild
          >
            <Button variant="outline" className="self-start">
              <Text>Earlier picks</Text>
            </Button>
          </Link>
          <Button
            variant="outline"
            className="self-start"
            disabled={
              offline ||
              refreshing ||
              !!data.running ||
              data.refreshesLeft === 0
            }
            onPress={refresh}
          >
            <Text>
              {refreshing
                ? "Refreshing…"
                : `Refresh (${data.refreshesLeft} left today)`}
            </Text>
          </Button>
          {error && <RequestError>{error}</RequestError>}
        </>
      ) : query.isError ? (
        <View className="items-start gap-2">
          <RequestError>Could not load your recommendations.</RequestError>
          <Button variant="outline" onPress={() => query.refetch()}>
            <Text>Try again</Text>
          </Button>
        </View>
      ) : (
        <Text>Loading picks…</Text>
      )}
    </>
  )
}

export default function RecommendationsScreen() {
  const { serverUuid: requestedServer } = useLocalSearchParams<{
    serverUuid?: string
  }>()
  const { serverUuid, isLoading } = useRequestServer(requestedServer)
  const query = useRecommendationConfig(serverUuid)
  return (
    <RequestPage>
      {serverUuid && query.config?.enabled ? (
        <Recommendations
          key={serverUuid}
          serverUuid={serverUuid}
          requestsEnabled={query.config.requestsEnabled}
          configOffline={query.isError}
        />
      ) : isLoading || query.isLoading ? (
        <Text>Loading…</Text>
      ) : (
        <Text>Recommendations aren’t available on this account.</Text>
      )}
    </RequestPage>
  )
}
