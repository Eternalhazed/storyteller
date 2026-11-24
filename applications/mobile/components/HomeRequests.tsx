import { skipToken } from "@reduxjs/toolkit/query"
import { View } from "react-native"

import { useRequestsEnabled } from "@/hooks/useBookRequests"
import { requestErrorStatus } from "@/store/requestErrors"
import { useListServersQuery } from "@/store/localApi"
import { serverApi } from "@/store/serverApi"
import { type UUID } from "@/uuid"

import { RequestSummary } from "./RequestSummary"

function ServerHomeRequests({
  serverUuid,
  focused,
}: {
  serverUuid: UUID
  focused: boolean
}) {
  const enabled = useRequestsEnabled(serverUuid)
  const { currentData: requests, error } = serverApi.useListRequestsQuery(
    enabled ? { serverUuid, open: true } : skipToken,
    { pollingInterval: focused ? 15_000 : 0, refetchOnMountOrArgChange: true },
  )
  const status = requestErrorStatus(error)
  if (
    !enabled ||
    !requests?.length ||
    status === 401 ||
    status === 403 ||
    status === 404
  ) {
    return null
  }

  return (
    <View className="mr-safe-or-6 w-auto max-w-2xl gap-3">
      {requests.map((request) => (
        <RequestSummary
          key={request.uuid}
          request={request}
          serverUuid={serverUuid}
          home
        />
      ))}
    </View>
  )
}

export function HomeRequests({ focused }: { focused: boolean }) {
  const { currentData: servers } = useListServersQuery()
  return (
    servers
      ?.filter((server) => server.username)
      .map((server) => (
        <ServerHomeRequests
          key={server.uuid}
          serverUuid={server.uuid}
          focused={focused}
        />
      )) ?? null
  )
}
