import { skipToken } from "@reduxjs/toolkit/query"
import {
  SECTION_TITLES,
  type PickOutcome,
  type RoundTrigger,
} from "@storyteller/web/src/recommendations/types"
import { useLocalSearchParams } from "expo-router"
import { View } from "react-native"

import { PickCard } from "@/components/RecommendationCards"
import { RequestError, RequestPage } from "@/components/RequestPage"
import { Button } from "@/components/ui/button"
import { Text } from "@/components/ui/text"
import { useRequestServer } from "@/hooks/useBookRequests"
import { serverApi } from "@/store/serverApi"

const OUTCOMES: Record<NonNullable<PickOutcome>, string> = {
  requested: "Requested",
  finished: "Finished",
  rated: "Rated",
  turned_down: "Turned down",
  not_found: "Not found",
  saved: "Saved",
}
const TRIGGERS: Record<RoundTrigger, string> = {
  weekly: "Weekly picks",
  import: "From imported history",
  finished: "After a finished book",
  tune: "From Tune",
  wish: "From Ask",
  refresh: "Refreshed picks",
  first: "First picks",
}

export default function RecommendationHistoryScreen() {
  const { serverUuid: requestedServer } = useLocalSearchParams<{
    serverUuid?: string
  }>()
  const { serverUuid, isLoading } = useRequestServer(requestedServer)
  const query = serverApi.useGetRecommendationHistoryQuery(
    serverUuid ? { serverUuid } : skipToken,
    { refetchOnMountOrArgChange: true },
  )
  const history = query.isError ? undefined : query.currentData
  return (
    <RequestPage>
      {isLoading || query.isLoading ? (
        <Text>Loading earlier picks…</Text>
      ) : query.isError ? (
        <View className="items-start gap-2">
          <RequestError>Could not load earlier picks.</RequestError>
          <Button variant="outline" onPress={() => query.refetch()}>
            <Text>Try again</Text>
          </Button>
        </View>
      ) : serverUuid && history ? (
        <>
          {!!history.stats.length && (
            <View className="gap-2">
              <Text variant="h3">How your sections are doing</Text>
              {history.stats.map(
                ({
                  section,
                  shown,
                  requested,
                  finished,
                  ratedHigh,
                  notForMe,
                }) => (
                  <View
                    key={section}
                    className="border-border gap-1 border-b pb-2"
                  >
                    <Text className="font-semibold">
                      {SECTION_TITLES[section]}
                    </Text>
                    <Text className="text-muted-foreground text-sm">
                      {shown} shown · {requested} requested · {finished}{" "}
                      finished · {ratedHigh} rated 4★ or higher · {notForMe} not
                      for me
                    </Text>
                  </View>
                ),
              )}
            </View>
          )}
          {history.rounds.map((round) => (
            <View key={round.uuid} className="gap-2">
              <Text variant="h4">{TRIGGERS[round.trigger]}</Text>
              <Text className="text-muted-foreground text-sm">
                {new Date(round.createdAt).toLocaleDateString()}
              </Text>
              {round.picks.map((pick) => (
                <PickCard
                  key={pick.uuid}
                  pick={pick}
                  serverUuid={serverUuid}
                  outcome={`${pick.outcome ? OUTCOMES[pick.outcome] : "No action yet"}${pick.rating ? ` · ${pick.rating}★` : ""}`}
                />
              ))}
            </View>
          ))}
          {!history.rounds.length && (
            <Text className="text-muted-foreground">No earlier picks yet.</Text>
          )}
        </>
      ) : (
        <Text>Recommendations aren’t available on this account.</Text>
      )}
    </RequestPage>
  )
}
