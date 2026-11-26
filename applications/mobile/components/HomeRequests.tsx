import { skipToken } from "@reduxjs/toolkit/query"
import { useEffect, useRef } from "react"
import { View } from "react-native"

import { useRequestsEnabled } from "@/hooks/useBookRequests"
import { useIsNotBackground } from "@/hooks/useIsNotBackground"
import { useAppDispatch } from "@/store/appState"
import { useListServersQuery } from "@/store/localApi"
import { requestErrorStatus } from "@/store/requestErrors"
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
  const dispatch = useAppDispatch()
  const args = enabled ? { serverUuid, open: true as const } : skipToken
  const {
    currentData: requests,
    error,
    fulfilledTimeStamp,
  } = serverApi.endpoints.listRequests.useQueryState(args)
  const transfersActive = requests?.some(
    ({ ebook, audio }) =>
      ebook.status === "downloading" ||
      audio.status === "downloading" ||
      ebook.status === "importing" ||
      audio.status === "importing",
  )
  // Resubscribing on Home focus or app foreground refetches immediately,
  // without polling while the screen isn't visible.
  serverApi.endpoints.listRequests.useQuerySubscription(
    focused ? args : skipToken,
    {
      pollingInterval: transfersActive ? 5_000 : 15_000,
      refetchOnMountOrArgChange: true,
    },
  )
  const status = requestErrorStatus(error)
  const refreshed = useRef(new Map<UUID, string>())
  useEffect(() => {
    if (
      !focused ||
      !requests ||
      status === 401 ||
      status === 403 ||
      status === 404
    )
      return

    for (const { uuid, bookUuid, ebook, audio, sync } of requests) {
      const readyFormats = [
        ebook.status === "ready" && "ebook",
        audio.status === "ready" && "audio",
        sync.status === "done" && "read-along",
      ]
        .filter(Boolean)
        .join(",")
      if (!readyFormats || readyFormats === refreshed.current.get(uuid))
        continue
      refreshed.current.set(uuid, readyFormats)

      // This query upserts the book in SQLite and invalidates the local book
      // list. Invalidating the local list by itself would reread stale rows.
      void dispatch(
        serverApi.endpoints.getBook.initiate(
          { serverUuid, bookUuid },
          { forceRefetch: true, subscribe: false },
        ),
      ).then(({ isSuccess }) => {
        if (!isSuccess && refreshed.current.get(uuid) === readyFormats) {
          refreshed.current.delete(uuid)
        }
      })
    }
  }, [dispatch, focused, fulfilledTimeStamp, requests, serverUuid, status])
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
    <View className="mr-6 max-w-3xl gap-3">
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
  const foreground = useIsNotBackground()
  const { currentData: servers } = useListServersQuery()
  return (
    servers
      ?.filter((server) => server.username)
      .map((server) => (
        <ServerHomeRequests
          key={server.uuid}
          serverUuid={server.uuid}
          focused={focused && foreground}
        />
      )) ?? null
  )
}
