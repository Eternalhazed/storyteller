import {
  type AskCard,
  type AskResult,
  type RoundView,
} from "@storyteller/web/src/recommendations/types"
import { Link, useLocalSearchParams } from "expo-router"
import { useEffect, useEffectEvent, useRef, useState } from "react"
import { View } from "react-native"

import {
  PickCard,
  RecommendationCover,
  RoundProgress,
} from "@/components/RecommendationCards"
import { RequestError, RequestPage } from "@/components/RequestPage"
import { OpenRequestedBook } from "@/components/RequestSummary"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { useRequestServer } from "@/hooks/useBookRequests"
import { useIsFocused } from "@/hooks/useIsFocused"
import {
  useRecommendationConfig,
  useRecommendationRound,
} from "@/hooks/useRecommendations"
import { useAppDispatch } from "@/store/appState"
import { useListStatusesQuery, useUpdateStatusMutation } from "@/store/localApi"
import { resolvedWorkHref, seriesLine } from "@/store/recommendations"
import { requestErrorMessage } from "@/store/requestErrors"
import { serverApi } from "@/store/serverApi"
import { type UUID } from "@/uuid"

function AskBookCard({
  card,
  serverUuid,
  requestsEnabled,
  offline,
}: {
  card: AskCard
  serverUuid: UUID
  requestsEnabled: boolean
  offline: boolean
}) {
  const { work, series, bookUuid, state } = card
  return (
    <View className="border-border bg-card flex-row items-start gap-3 rounded-lg border p-3">
      <RecommendationCover url={work.coverUrl} />
      <View className="min-w-0 flex-1 gap-1.5">
        <Text className="font-semibold">{work.title}</Text>
        {!!work.authors.length && <Text>{work.authors.join(", ")}</Text>}
        {(series || work.series) && (
          <Text className="text-muted-foreground text-sm">
            {series
              ? seriesLine(series)
              : `${work.series?.name}${work.series?.position == null ? "" : ` · #${work.series.position}`}`}
          </Text>
        )}
        {bookUuid && (state === "on_shelf" || state === "to_read") ? (
          <OpenRequestedBook
            serverUuid={serverUuid}
            bookUuid={bookUuid}
            label={
              state === "on_shelf"
                ? "On your shelf: read now"
                : "On your To read"
            }
          />
        ) : (state === "household" || state === "get") && requestsEnabled ? (
          <Link href={resolvedWorkHref(serverUuid, work)} asChild>
            <Button className="self-start" size="flex" disabled={offline}>
              <Text className="shrink">
                {state === "household"
                  ? "In the household library: add to my shelf"
                  : "Get"}
              </Text>
            </Button>
          </Link>
        ) : state === "household" ? (
          <Text className="text-muted-foreground">
            In the household library
          </Text>
        ) : null}
      </View>
    </View>
  )
}

function AskRound({
  initial,
  serverUuid,
  requestsEnabled,
  offline,
}: {
  initial: RoundView
  serverUuid: UUID
  requestsEnabled: boolean
  offline: boolean
}) {
  const focused = useIsFocused()
  const query = useRecommendationRound(
    serverUuid,
    initial.uuid,
    initial.status === "running",
    focused,
  )
  const round = query.currentData ?? initial
  const picks = query.currentData?.picks ?? []
  return (
    <View className="gap-2">
      <RoundProgress round={round} />
      {query.isError ? (
        <View className="items-start gap-2">
          <RequestError>Could not load this round.</RequestError>
          <Button variant="outline" onPress={() => query.refetch()}>
            <Text>Try again</Text>
          </Button>
        </View>
      ) : round.status === "done" && query.currentData && !picks.length ? (
        <Text className="text-muted-foreground">
          No picks this time. Try asking for something different.
        </Text>
      ) : (
        picks.map((pick) => (
          <PickCard
            key={pick.uuid}
            pick={pick}
            serverUuid={serverUuid}
            requestsEnabled={requestsEnabled}
            offline={offline}
          />
        ))
      )}
    </View>
  )
}

function AskAnchor({
  anchor,
  serverUuid,
  offline,
}: {
  anchor: Extract<AskResult, { intent: "next" }>["anchor"]
  serverUuid: UUID
  offline: boolean
}) {
  const dispatch = useAppDispatch()
  const { currentData: statuses } = useListStatusesQuery()
  const read = statuses?.find((status) => status.name === "Read")
  const [updateStatus] = useUpdateStatusMutation()
  const [marked, setMarked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const { bookUuid, title } = anchor
  if (anchor.read || !bookUuid) return null

  async function markRead() {
    if (!bookUuid || !read) return
    setBusy(true)
    setError(false)
    try {
      await dispatch(
        serverApi.endpoints.getBook.initiate(
          { serverUuid, bookUuid },
          { forceRefetch: true, subscribe: false },
        ),
      ).unwrap()
      await updateStatus({ bookUuid, statusUuid: read.uuid }).unwrap()
      setMarked(true)
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <View className="items-start gap-2">
      {marked ? (
        <Text>{title} was marked as read.</Text>
      ) : (
        <Button
          variant="outline"
          size="flex"
          disabled={!read || busy || offline}
          onPress={markRead}
        >
          <Text className="shrink">Mark {title} as read</Text>
        </Button>
      )}
      {error && (
        <RequestError>
          Could not mark this book as read. Try again.
        </RequestError>
      )}
    </View>
  )
}

function AskForm({
  serverUuid,
  initialText,
  autoSubmit,
  requestsEnabled,
  offline,
}: {
  serverUuid: UUID
  initialText: string
  autoSubmit: boolean
  requestsEnabled: boolean
  offline: boolean
}) {
  const [text, setText] = useState(initialText)
  const [choices, setChoices] = useState<Record<number, AskCard>>({})
  const [ask, { data: result, isLoading, error }] =
    serverApi.useAskForBooksMutation()
  const submitted = useRef(false)

  function submit() {
    if (!text.trim() || offline || isLoading) return
    setChoices({})
    void ask({ serverUuid, text: text.trim() })
  }
  const submitOnOpen = useEffectEvent(submit)
  useEffect(() => {
    if (!autoSubmit || offline || submitted.current) return
    submitted.current = true
    submitOnOpen()
  }, [autoSubmit, offline])

  const cardProps = { serverUuid, requestsEnabled, offline }
  return (
    <>
      <View className="gap-2">
        <Input
          accessibilityLabel="Ask for a book, or say what you’re after"
          placeholder="Name a book or series, or say what you’re after…"
          value={text}
          onChangeText={setText}
          onSubmitEditing={submit}
          returnKeyType="go"
          editable={!isLoading}
        />
        <Button
          className="self-start"
          disabled={offline || isLoading || !text.trim()}
          onPress={submit}
        >
          <Text>{isLoading ? "Looking…" : "Ask"}</Text>
        </Button>
      </View>
      {offline && (
        <Text className="text-muted-foreground">
          Reconnect to ask for books.
        </Text>
      )}
      {!!error && (
        <RequestError>
          {requestErrorMessage(error, "Could not answer right now. Try again.")}
        </RequestError>
      )}
      {result?.intent === "get" && (
        <>
          {result.cards.map((card) => (
            <AskBookCard key={card.work.key} card={card} {...cardProps} />
          ))}
          {result.questions.map((question, index) => {
            const chosen = choices[index]
            return chosen ? (
              <AskBookCard key={index} card={chosen} {...cardProps} />
            ) : (
              <View key={index} className="items-start gap-2">
                <Text variant="h4">Which one did you mean?</Text>
                <Text className="text-muted-foreground">{question.asked}</Text>
                {question.choices.slice(0, 4).map((card) => (
                  <Button
                    key={card.work.key}
                    variant="outline"
                    size="flex"
                    onPress={() => setChoices({ ...choices, [index]: card })}
                  >
                    <Text className="shrink">
                      {[
                        card.work.title,
                        card.work.authors.join(", "),
                        card.work.series?.name,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </Button>
                ))}
              </View>
            )
          })}
          {result.notFound.map((title, index) => (
            <Text key={index}>Not found: {title}</Text>
          ))}
        </>
      )}
      {result?.intent === "next" && (
        <AskAnchor
          key={result.anchor.bookUuid ?? result.anchor.title}
          anchor={result.anchor}
          serverUuid={serverUuid}
          offline={offline}
        />
      )}
      {(result?.intent === "next" || result?.intent === "wish") &&
        (result.round ? (
          <AskRound
            key={result.round.uuid}
            initial={result.round}
            {...cardProps}
          />
        ) : (
          <Text className="text-muted-foreground">
            No follow-up picks available right now.
          </Text>
        ))}
      {result?.intent === "unclear" && <Text>{result.message}</Text>}
    </>
  )
}

export default function AskScreen() {
  const {
    serverUuid: requestedServer,
    text,
    submit,
  } = useLocalSearchParams<{
    serverUuid?: string
    text?: string
    submit?: string
  }>()
  const { serverUuid, isLoading } = useRequestServer(requestedServer)
  const focused = useIsFocused()
  const query = useRecommendationConfig(serverUuid, focused)
  return (
    <RequestPage>
      {serverUuid && query.config?.enabled ? (
        <AskForm
          key={serverUuid}
          serverUuid={serverUuid}
          initialText={text ?? ""}
          autoSubmit={submit === "true"}
          requestsEnabled={query.config.requestsEnabled}
          offline={query.isError}
        />
      ) : isLoading || query.isLoading ? (
        <Text>Loading…</Text>
      ) : (
        <Text>Ask isn’t available on this account.</Text>
      )}
    </RequestPage>
  )
}
