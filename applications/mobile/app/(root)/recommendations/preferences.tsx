import { skipToken } from "@reduxjs/toolkit/query"
import { type RecommendationPreferences } from "@storyteller/web/src/recommendations/types"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { View } from "react-native"

import {
  ChoiceChips,
  FORMATS,
  RecommendationToggle,
  SERIES_LENGTHS,
  SERIES_SHAPES,
} from "@/components/RecommendationInterview"
import { RequestError, RequestPage } from "@/components/RequestPage"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { useRequestServer } from "@/hooks/useBookRequests"
import { recommendationsHref, subjectList } from "@/store/recommendations"
import { requestErrorMessage } from "@/store/requestErrors"
import { serverApi } from "@/store/serverApi"
import { type UUID } from "@/uuid"

const TOGGLES = [
  ["useHistory", "Use my reading history for recommendations"],
  ["notifyNewInSeries", "New book in a series I’m reading"],
  ["notifyNewPicks", "New picks ready"],
] as const

function PreferencesForm({
  initial,
  serverUuid,
}: {
  initial: RecommendationPreferences
  serverUuid: UUID
}) {
  const router = useRouter()
  const [values, setValues] = useState(initial)
  const [favor, setFavor] = useState(() => initial.favorSubjects.join(", "))
  const [avoid, setAvoid] = useState(() => initial.avoidSubjects.join(", "))
  const [error, setError] = useState<string | null>(null)
  const [update, { isLoading }] =
    serverApi.useSetRecommendationPreferencesMutation()

  async function save() {
    setError(null)
    try {
      await update({
        serverUuid,
        ...values,
        favorSubjects: subjectList(favor),
        avoidSubjects: subjectList(avoid),
      }).unwrap()
      if (router.canGoBack()) router.back()
      else router.replace(recommendationsHref(serverUuid))
    } catch (cause) {
      setError(
        requestErrorMessage(
          cause,
          "Could not save your preferences. Try again.",
        ),
      )
    }
  }

  return (
    <>
      <View className="gap-2">
        <Text variant="h4">Series or standalone?</Text>
        <ChoiceChips
          options={SERIES_SHAPES}
          selected={values.seriesShape}
          choose={(seriesShape) => setValues({ ...values, seriesShape })}
          disabled={isLoading}
        />
        <Text>Series length</Text>
        <ChoiceChips
          options={SERIES_LENGTHS}
          selected={values.seriesLength}
          choose={(seriesLength) => setValues({ ...values, seriesLength })}
          disabled={isLoading}
        />
      </View>
      <View className="gap-2">
        <Text variant="h4">Format</Text>
        <ChoiceChips
          options={FORMATS}
          selected={values.format}
          choose={(format) => setValues({ ...values, format })}
          disabled={isLoading}
        />
      </View>
      <View className="gap-2">
        <Text variant="h4">Subjects</Text>
        <Text>Favor</Text>
        <Input
          accessibilityLabel="Subjects to favor"
          placeholder="Separate subjects with commas"
          value={favor}
          onChangeText={setFavor}
          editable={!isLoading}
        />
        <Text>Avoid</Text>
        <Input
          accessibilityLabel="Subjects to avoid"
          placeholder="Separate subjects with commas"
          value={avoid}
          onChangeText={setAvoid}
          editable={!isLoading}
        />
      </View>
      <View className="gap-2">
        <Text variant="h4">Reading history and notifications</Text>
        {TOGGLES.map(([key, label]) => (
          <RecommendationToggle
            key={key}
            label={label}
            checked={values[key]}
            onChange={(value) => setValues({ ...values, [key]: value })}
            disabled={isLoading}
          />
        ))}
        <Text className="text-muted-foreground text-sm">
          To import or manage reading history, open Storyteller on the web and
          choose Reading history in your account menu.
        </Text>
      </View>
      {error && <RequestError>{error}</RequestError>}
      <Button className="self-start" disabled={isLoading} onPress={save}>
        <Text>{isLoading ? "Saving…" : "Save preferences"}</Text>
      </Button>
    </>
  )
}

export default function RecommendationPreferencesScreen() {
  const { serverUuid: requestedServer } = useLocalSearchParams<{
    serverUuid?: string
  }>()
  const { serverUuid, isLoading } = useRequestServer(requestedServer)
  const query = serverApi.useGetRecommendationPreferencesQuery(
    serverUuid ? { serverUuid } : skipToken,
    { refetchOnMountOrArgChange: true },
  )
  return (
    <RequestPage>
      {isLoading || query.isLoading ? (
        <Text>Loading preferences…</Text>
      ) : query.isError ? (
        <View className="items-start gap-2">
          <RequestError>Could not load your preferences.</RequestError>
          <Button variant="outline" onPress={() => query.refetch()}>
            <Text>Try again</Text>
          </Button>
        </View>
      ) : serverUuid && query.currentData ? (
        <PreferencesForm
          key={serverUuid}
          initial={query.currentData}
          serverUuid={serverUuid}
        />
      ) : (
        <Text>Recommendations aren’t available on this account.</Text>
      )}
    </RequestPage>
  )
}
