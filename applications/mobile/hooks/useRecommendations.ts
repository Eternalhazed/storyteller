import { skipToken } from "@reduxjs/toolkit/query"
import { useEffect, useMemo } from "react"
import { shallowEqual } from "react-redux"

import {
  type RootState,
  useAppDispatch,
  useAppSelector,
} from "@/store/appState"
import { useListServersQuery } from "@/store/localApi"
import { requestErrorStatus } from "@/store/requestErrors"
import { serverApi } from "@/store/serverApi"
import { type UUID } from "@/uuid"

const RUNNING_POLL_INTERVAL = 3_000
const IDLE_POLL_INTERVAL = 15_000

export function blocksCachedRecommendations(error: unknown) {
  const status = requestErrorStatus(error)
  return status === 401 || status === 403 || status === 404
}

export function useRecommendationConfig(
  serverUuid: UUID | undefined,
  focused = false,
) {
  const query = serverApi.useGetRecommendationsConfigQuery(
    serverUuid ? { serverUuid } : skipToken,
    {
      refetchOnMountOrArgChange: true,
      pollingInterval: focused ? IDLE_POLL_INTERVAL : 0,
    },
  )
  return {
    ...query,
    config: blocksCachedRecommendations(query.error)
      ? undefined
      : query.currentData,
  }
}

/** The Home menu and Search need to discover enabled servers, not just the first account. */
export function useEnabledRecommendationServers(focused: boolean) {
  const { currentData: servers } = useListServersQuery()
  const dispatch = useAppDispatch()
  const signedIn = useMemo(
    () => servers?.filter((server) => server.username) ?? [],
    [servers],
  )
  const selectEnabled = useMemo(() => {
    const selectors = signedIn.map((server) =>
      serverApi.endpoints.getRecommendationsConfig.select({
        serverUuid: server.uuid,
      }),
    )
    return (state: RootState) =>
      signedIn.filter((_, index) => {
        const config = selectors[index]?.(state)
        return (
          config?.data?.enabled && !blocksCachedRecommendations(config.error)
        )
      })
  }, [signedIn])
  const enabled = useAppSelector(selectEnabled, shallowEqual)
  useEffect(() => {
    if (!focused) return
    const subscriptions = signedIn.map(({ uuid }) =>
      dispatch(
        serverApi.endpoints.getRecommendationsConfig.initiate(
          { serverUuid: uuid },
          {
            forceRefetch: 30,
            subscriptionOptions: { pollingInterval: 60_000 },
          },
        ),
      ),
    )
    return () =>
      subscriptions.forEach((subscription) => subscription.unsubscribe())
  }, [dispatch, focused, signedIn])
  return enabled
}

export function useRecommendationFeed(
  serverUuid: UUID | undefined,
  focused: boolean,
) {
  const arg = serverUuid ? { serverUuid } : skipToken
  const { currentData } =
    serverApi.endpoints.getRecommendations.useQueryState(arg)
  const query = serverApi.useGetRecommendationsQuery(arg, {
    refetchOnMountOrArgChange: true,
    pollingInterval: !focused
      ? 0
      : currentData?.running
        ? RUNNING_POLL_INTERVAL
        : IDLE_POLL_INTERVAL,
  })
  return {
    ...query,
    feed: blocksCachedRecommendations(query.error)
      ? undefined
      : query.currentData,
  }
}

export function useRecommendationRound(
  serverUuid: UUID,
  roundUuid: UUID,
  running: boolean,
  focused: boolean,
) {
  const arg = { serverUuid, roundUuid }
  const { currentData } =
    serverApi.endpoints.getRecommendationRound.useQueryState(arg)
  return serverApi.useGetRecommendationRoundQuery(arg, {
    refetchOnMountOrArgChange: true,
    pollingInterval:
      focused && (currentData ? currentData.status === "running" : running)
        ? RUNNING_POLL_INTERVAL
        : 0,
  })
}
