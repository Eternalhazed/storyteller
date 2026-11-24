import { skipToken } from "@reduxjs/toolkit/query"
import { Link, useLocalSearchParams } from "expo-router"
import { ChevronRight } from "lucide-react-native"
import { Pressable, View } from "react-native"

import { RequestError, RequestPage } from "@/components/RequestPage"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Text } from "@/components/ui/text"
import { useRequestConfig, useRequestServer } from "@/hooks/useBookRequests"
import { getRequestCard } from "@/store/requestCard"
import { requestDetailHref } from "@/store/requestNavigation"
import { serverApi } from "@/store/serverApi"

export default function RequestsScreen() {
  const params = useLocalSearchParams<{ serverUuid?: string }>()
  const { serverUuid, isLoading: loadingServer } = useRequestServer(
    params.serverUuid,
  )
  const { config, isFetching: fetchingConfig } = useRequestConfig(serverUuid)
  const enabled = config?.enabled === true
  const {
    currentData: requests,
    isLoading,
    isError,
    refetch,
  } = serverApi.useListRequestsQuery(
    enabled && serverUuid ? { serverUuid } : skipToken,
    { refetchOnMountOrArgChange: true },
  )

  return (
    <RequestPage>
      {loadingServer || (!config && fetchingConfig) || isLoading ? (
        <Text>Loading…</Text>
      ) : !serverUuid || !enabled ? (
        <Text>Book requests aren’t available on this server.</Text>
      ) : isError ? (
        <View className="items-start gap-2">
          <RequestError>Could not load requests.</RequestError>
          <Button variant="outline" onPress={() => refetch()}>
            <Text>Try again</Text>
          </Button>
        </View>
      ) : requests?.length ? (
        <View className="gap-2">
          {requests.map((request) => {
            const { primary, status, title } = getRequestCard(request)
            return (
              <Link
                key={request.uuid}
                href={requestDetailHref(serverUuid, request.uuid)}
                asChild
              >
                <Pressable
                  accessibilityRole="link"
                  className="border-border bg-card active:bg-accent flex-row items-center gap-3 rounded-lg border p-4"
                >
                  <View className="flex-1 gap-1">
                    <Text className="font-semibold">{title}</Text>
                    <Text className="text-muted-foreground text-sm">
                      {[primary, status].filter(Boolean).join(" · ") ||
                        "Requested"}
                    </Text>
                  </View>
                  <Icon
                    as={ChevronRight}
                    size={18}
                    className="text-muted-foreground"
                  />
                </Pressable>
              </Link>
            )
          })}
        </View>
      ) : (
        <Text>No book requests yet.</Text>
      )}
    </RequestPage>
  )
}
