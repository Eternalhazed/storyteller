import { useLocalSearchParams, useRouter } from "expo-router"

import { RecommendationInterview } from "@/components/RecommendationInterview"
import { RequestPage } from "@/components/RequestPage"
import { Text } from "@/components/ui/text"
import { useRequestServer } from "@/hooks/useBookRequests"
import { recommendationsHref } from "@/store/recommendations"

export default function TuneRecommendationsScreen() {
  const { serverUuid: requestedServer } = useLocalSearchParams<{
    serverUuid?: string
  }>()
  const { serverUuid, isLoading } = useRequestServer(requestedServer)
  const router = useRouter()
  return (
    <RequestPage>
      {isLoading ? (
        <Text>Loading…</Text>
      ) : (
        <RecommendationInterview
          serverUuid={serverUuid}
          onStarted={() => {
            if (router.canGoBack()) router.back()
            else router.replace(recommendationsHref(serverUuid))
          }}
        />
      )}
    </RequestPage>
  )
}
