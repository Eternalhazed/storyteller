import { skipToken } from "@reduxjs/toolkit/query"
import { withoutSubjects } from "@storyteller/web/src/recommendations/subjects"
import { type RecommendationPreferences } from "@storyteller/web/src/recommendations/types"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { View } from "react-native"

import {
  ChoiceChips,
  FORMATS,
  RecommendationToggle,
  SERIES_SHAPES,
  SeriesLengthChips,
  SubjectPicker,
} from "@/components/RecommendationInterview"
import { RequestError, RequestPage } from "@/components/RequestPage"
import { Button } from "@/components/ui/button"
import { Text } from "@/components/ui/text"
import { useRequestServer } from "@/hooks/useBookRequests"
import { recommendationsHref } from "@/store/recommendations"
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
  profileSubjects,
  serverUuid,
}: {
  initial: RecommendationPreferences
  profileSubjects: readonly string[]
  serverUuid: UUID
}) {
  const router = useRouter()
  const [values, setValues] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [update, { isLoading }] =
    serverApi.useSetRecommendationPreferencesMutation()

  async function save() {
    setError(null)
    try {
      await update({ serverUuid, ...values }).unwrap()
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
        {values.seriesShape !== "standalone" && (
          <SeriesLengthChips
            selected={values.seriesLength}
            onChange={(seriesLength) => setValues({ ...values, seriesLength })}
            disabled={isLoading}
          />
        )}
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
      <View className="gap-4">
        <View className="gap-1">
          <Text variant="h4">Subjects</Text>
          <Text className="text-muted-foreground text-sm">
            Selecting a subject to favor moves it out of Avoid, and vice versa.
          </Text>
        </View>
        <View className="gap-2">
          <Text className="font-semibold">Favor</Text>
          <SubjectPicker
            profile={profileSubjects}
            selected={values.favorSubjects}
            other={values.avoidSubjects}
            onChange={(favorSubjects) =>
              setValues((previous) => ({
                ...previous,
                favorSubjects,
                avoidSubjects: withoutSubjects(
                  previous.avoidSubjects,
                  favorSubjects,
                ),
              }))
            }
            inputLabel="Add a custom subject to favor"
            disabled={isLoading}
          />
        </View>
        <View className="gap-2">
          <Text className="font-semibold">Avoid</Text>
          <SubjectPicker
            profile={profileSubjects}
            selected={values.avoidSubjects}
            other={values.favorSubjects}
            onChange={(avoidSubjects) =>
              setValues((previous) => ({
                ...previous,
                avoidSubjects,
                favorSubjects: withoutSubjects(
                  previous.favorSubjects,
                  avoidSubjects,
                ),
              }))
            }
            inputLabel="Add a custom subject to avoid"
            disabled={isLoading}
          />
        </View>
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
        <Text numberOfLines={1}>
          {isLoading ? "Saving…" : "Save preferences"}
        </Text>
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
  const interview = serverApi.useGetRecommendationInterviewQuery(
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
          profileSubjects={interview.currentData?.subjects ?? []}
          serverUuid={serverUuid}
        />
      ) : (
        <Text>Recommendations aren’t available on this account.</Text>
      )}
    </RequestPage>
  )
}
