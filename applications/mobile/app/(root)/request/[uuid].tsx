import { skipToken } from "@reduxjs/toolkit/query"
import { useLocalSearchParams } from "expo-router"
import { View } from "react-native"

import {
  OtherRequestAccount,
  RequestError,
  RequestPage,
} from "@/components/RequestPage"
import { RequestSummary } from "@/components/RequestSummary"
import { Button } from "@/components/ui/button"
import { Text } from "@/components/ui/text"
import { useRequestConfig, useRequestServer } from "@/hooks/useBookRequests"
import { useIsFocused } from "@/hooks/useIsFocused"
import { requestErrorStatus } from "@/store/requestErrors"
import { parseRequestUuid } from "@/store/requestNavigation"
import { serverApi } from "@/store/serverApi"

export default function RequestDetailScreen() {
  const params = useLocalSearchParams<{ uuid: string; serverUuid?: string }>()
  const requestUuid = parseRequestUuid(params.uuid)
  const { serverUuid, isLoading: loadingServer } = useRequestServer(
    params.serverUuid,
  )
  const { config, isFetching: fetchingConfig } = useRequestConfig(serverUuid)
  const enabled = config?.enabled === true
  const focused = useIsFocused()
  const {
    currentData: request,
    isLoading,
    isError,
    error,
    refetch,
  } = serverApi.useGetRequestQuery(
    enabled && serverUuid && requestUuid
      ? { serverUuid, requestUuid }
      : skipToken,
    { pollingInterval: focused ? 15_000 : 0, refetchOnMountOrArgChange: true },
  )

  if (requestErrorStatus(error) === 403) return <OtherRequestAccount />

  return (
    <RequestPage>
      {loadingServer || (!config && fetchingConfig) || isLoading ? (
        <Text>Loading…</Text>
      ) : !serverUuid || !enabled ? (
        <Text>Book requests aren’t available on this server.</Text>
      ) : !requestUuid || requestErrorStatus(error) === 404 ? (
        <Text>Request not found.</Text>
      ) : isError ? (
        <View className="items-start gap-2">
          <RequestError>Could not load this request.</RequestError>
          <Button variant="outline" onPress={() => refetch()}>
            <Text>Try again</Text>
          </Button>
        </View>
      ) : (
        request && (
          <>
            <RequestSummary request={request} serverUuid={serverUuid} />
            <Text variant="h3">History</Text>
            {request.events.length ? (
              <View className="gap-3">
                {request.events.map(({ kind, message, createdAt }, index) => (
                  <View
                    key={`${createdAt}:${kind}:${index}`}
                    className="border-border gap-1 border-b pb-3"
                  >
                    <Text>{message}</Text>
                    <Text className="text-muted-foreground text-sm">
                      {new Date(createdAt).toLocaleString()}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text className="text-muted-foreground">No events yet.</Text>
            )}
          </>
        )
      )}
    </RequestPage>
  )
}
