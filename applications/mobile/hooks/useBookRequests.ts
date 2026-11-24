import { skipToken } from "@reduxjs/toolkit/query"

import { useListServersQuery } from "@/store/localApi"
import { serverApi } from "@/store/serverApi"
import { type UUID } from "@/uuid"

export function useRequestServer(serverUuid: string | undefined) {
  const { currentData: servers, isLoading } = useListServersQuery()
  const server = servers?.find(
    (candidate) =>
      candidate.username && (!serverUuid || candidate.uuid === serverUuid),
  )
  return { serverUuid: server?.uuid, isLoading }
}

export function useRequestConfig(serverUuid: UUID | null | undefined) {
  const query = serverApi.useGetRequestConfigQuery(
    serverUuid ? { serverUuid } : skipToken,
    { refetchOnMountOrArgChange: 30 },
  )
  return { ...query, config: query.isError ? undefined : query.currentData }
}

export function useRequestsEnabled(serverUuid: UUID | null | undefined) {
  return useRequestConfig(serverUuid).config?.enabled === true
}
